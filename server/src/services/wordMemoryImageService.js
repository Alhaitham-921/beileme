import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { config } from '../config.js'
import { execute, query, queryOne, withTransaction } from '../db/pool.js'
import { ApiError, badRequest, forbidden, notFound, quotaExceeded } from '../utils/errors.js'
import { parseJson } from '../utils/json.js'
import { todayKey } from '../utils/time.js'
import { resolveProvider } from './ai/apiKeyService.js'
import { chat } from './ai/aiProvider.js'
import { parseJsonResponse } from './ai/promptTemplates.js'
import { hasMistake } from './collectionService.js'
import { getWordById } from './wordService.js'
import { MEMORY_SCENE_PROMPT } from './wordMemoryScenePrompt.js'
import { IMAGE_RECALL_EXAMPLES } from '../../../src/data/imageRecallExamples.js'

const GENERATION_TIMEOUT_MS = 120_000
const SCENE_TIMEOUT_MS = 45_000
const LEASE_MS = SCENE_TIMEOUT_MS + GENERATION_TIMEOUT_MS + 15_000
const MAX_IMAGE_BYTES = 1024 * 1024
const MAX_DOWNLOAD_BYTES = 8 * MAX_IMAGE_BYTES
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex')
const ILLUSTRATION_STYLE = [
  'Create a square, minimalist flat vector-style illustration for an English vocabulary flashcard series.',
  'Use a solid warm greige background (#E9E1D7). Fill most of the square with the key action or object, leaving a small margin.',
  'Use muted Morandi colors: choose two or three accents from sage green (#A5AD99), dusty rose (#C5A5A2), muted blue (#8F9EAB), and soft terracotta (#BF9D88).',
  'Use warm charcoal (#514B47) outlines thick enough to read at thumbnail size, and flat fills. Give the key clue the strongest contrast.',
  'Show one focal object or one everyday action with at most two people and two essential props. Make the action and direction obvious through posture and placement.',
  'Use a single scene, suitable for students. Keep the artwork free of letters, numbers, captions, logos, gradients, textures and decorative borders.',
].join(' ')
const NEGATIVE_PROMPT = 'photorealism, 3D render, high saturation, neon colors, gradients, glossy surfaces, grain, heavy shadows, ' +
  'busy background, collage, extra objects, multiple panels, typography, letters, captions, logos, decorative frame'
const hashSense = sense => createHash('sha256').update(sense).digest()
const imageEnabled = () => Boolean(config.wordImages.apiKey && config.wordImages.model && config.wordImages.dailyQuota)
const stateSql = `CASE WHEN lease_until > UTC_TIMESTAMP(3) THEN 'pending'
  WHEN image_revision IS NOT NULL THEN 'ready' ELSE 'failed' END AS status`

export async function getWordMemoryImage(userId, wordId, requestedSense) {
  const word = await getWordById(wordId)
  const senses = [...new Set(word.definitions.filter(sense => typeof sense === 'string' && sense.trim()))]
  const rows = await query(`SELECT sense_hash, image_revision, explanation, generation_error, ${stateSql}
    FROM word_memory_images WHERE user_id=? AND word_id=?`, [userId, wordId])
  const states = new Map(rows.map(row => [row.sense_hash.toString('hex'), row]))
  const options = senses.map(sense => {
    const row = states.get(hashSense(sense).toString('hex'))
    return { sense, status: row?.status || 'empty', hasImage: Boolean(row?.image_revision), generationError: row?.generation_error || null }
  })
  const selected = options.find(item => item.sense === requestedSense) || options.find(item => item.status === 'ready') ||
    options.find(item => item.status !== 'empty') || options[0]
  const key = selected && hashSense(selected.sense).toString('hex')
  const saved = key && states.get(key)
  return { enabled: imageEnabled(), options, selected: selected || null,
    imagePath: memoryImagePath(wordId, key, saved?.image_revision),
    explanation: saved?.explanation || null }
}

export function memoryImagePath(wordId, senseHash, revision) {
  return revision ? `/words/${wordId}/memory-image/${senseHash}/${revision.toString('hex')}` : null
}

export async function readWordMemoryImage(userId, wordId, senseHash, revision, tile) {
  const row = await queryOne(`SELECT image FROM word_memory_images
    WHERE user_id=? AND word_id=? AND sense_hash=UNHEX(?) AND image_revision=UNHEX(?)`,
  [userId, wordId, senseHash, revision])
  if (!row?.image) throw notFound('找不到这张记忆图。')
  if (!tile) return row.image
  return makeTile(row.image)
}

function makeTile(image) {
  return sharp(image, { limitInputPixels: 4096 * 4096 })
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
}

function exampleState(row) {
  return {
    exampleKey: row.example_key,
    imagePath: row.image_revision ? `/words/memory-images/examples/${row.example_key}/${row.image_revision.toString('hex')}` : null,
    explanation: row.explanation || null,
    status: row.status,
    generationError: row.generation_error || null,
  }
}

export async function listRecallExampleReplacements(userId) {
  const rows = await query(`SELECT example_key, image_revision, explanation, generation_error, ${stateSql}
    FROM image_recall_example_replacements WHERE user_id=? AND image_revision IS NOT NULL`, [userId])
  return rows.map(exampleState)
}

export async function getRecallExampleReplacement(userId, exampleKey) {
  if (!IMAGE_RECALL_EXAMPLES.some(item => item.key === exampleKey)) throw notFound('找不到这张内置练习图。')
  const row = await queryOne(`SELECT example_key, image_revision, explanation, generation_error, ${stateSql}
    FROM image_recall_example_replacements WHERE user_id=? AND example_key=?`, [userId, exampleKey])
  return row ? exampleState(row) : { exampleKey, status: 'empty', imagePath: null }
}

export async function readRecallExampleReplacement(userId, exampleKey, revision) {
  const row = await queryOne(`SELECT image FROM image_recall_example_replacements
    WHERE user_id=? AND example_key=? AND image_revision=UNHEX(?)`, [userId, exampleKey, revision])
  if (!row?.image) throw notFound('找不到这张练习图。')
  return makeTile(row.image)
}

export async function listWordMemoryImages(userId) {
  const rows = await query(`SELECT m.word_id, m.sense_hash, m.image_revision, m.explanation, w.spelling, w.definitions
    FROM word_memory_images m JOIN words w ON w.id=m.word_id
    WHERE m.user_id=? AND m.image_revision IS NOT NULL
    ORDER BY m.attempt_day DESC, m.word_id DESC, m.sense_hash LIMIT 150`, [userId])
  return rows.flatMap(row => {
    const definitions = parseJson(row.definitions, []).filter(value => typeof value === 'string' && value.trim())
    const sense = definitions.find(value => hashSense(value).equals(row.sense_hash))
    return sense ? [{
      wordId: Number(row.word_id), spelling: row.spelling, sense, definitions, explanation: row.explanation,
      imagePath: memoryImagePath(row.word_id, row.sense_hash.toString('hex'), row.image_revision) + '/tile',
    }] : []
  })
}

async function getWrongChoice(userId, wordId, sessionId) {
  const answer = await queryOne(`SELECT a.wrong_option, s.queue FROM answer_logs a
    LEFT JOIN study_sessions s ON s.id=a.session_id AND s.user_id=a.user_id
    WHERE a.user_id=? AND a.word_id=? AND a.result=0${sessionId ? ' AND a.session_id=?' : ''}
    ORDER BY a.id DESC LIMIT 1`, sessionId ? [userId, wordId, sessionId] : [userId, wordId])
  if (sessionId && !answer) throw badRequest('找不到这次答错的记录，请从错题本重新打开。')
  const item = parseJson(answer?.queue, []).find(entry => Number(entry.wordId) === wordId)
  const option = item?.options?.find(entry => entry.index === item.selectedOptionIndex && !entry.correct)
  if (!option?.wordId && !option?.text && !answer?.wrong_option) return null
  const distractor = option?.wordId ? await queryOne('SELECT spelling FROM words WHERE id=?', [option.wordId]) : null
  return { spelling: distractor?.spelling || null, meaning: option?.text || answer?.wrong_option || null }
}

async function designScene(provider, word, sense, { wrongChoice, learnerCue, previousClue, redraw }) {
  const signal = AbortSignal.timeout(SCENE_TIMEOUT_MS)
  const result = await chat({
    ...provider, temperature: 0.2, maxTokens: 400, jsonMode: true,
    fetchImpl: (url, options) => fetch(url, { ...options, signal: AbortSignal.any([options.signal, signal]) }),
    messages: [{ role: 'system', content: MEMORY_SCENE_PROMPT }, { role: 'user', content: JSON.stringify({
      targetWord: word.spelling, targetMeaning: sense, partOfSpeech: word.pos, dictionaryExample: word.example,
      wrongChoice, learnerCue, previousClue, redraw,
    }) }],
  })
  const data = parseJsonResponse(result.content)
  const scene = typeof data?.scene === 'string' ? data.scene.trim() : ''
  const explanation = typeof data?.explanation === 'string' ? data.explanation.trim() : ''
  if (!scene || scene.length > 800) throw new Error('Invalid memory scene')
  const usefulExplanation = explanation.length <= 300 && /\p{Script=Han}/u.test(explanation) &&
    explanation.toLowerCase().includes(word.spelling.toLowerCase())
  return { scene, explanation: usefulExplanation ? explanation : null }
}

function isWebp(image) {
  return image.length >= 20 && image.toString('ascii', 0, 4) === 'RIFF' &&
    image.toString('ascii', 8, 12) === 'WEBP' && image.readUInt32LE(4) + 8 === image.length
}

async function downloadSiliconFlowImage(value, signal) {
  const url = typeof value === 'string' ? URL.parse(value) : null
  const trustedHost = url && (url.hostname.endsWith('.siliconflow.cn') ||
    /^(sc-maas|sf-maas-uat-prod|sf-maas-prod)\.oss-cn-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname))
  if (!trustedHost || url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new Error('Unexpected SiliconFlow image host')
  }

  // The signed download URL authorizes the request. Keep the API key on the generation endpoint.
  let response
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(url.href, { signal, redirect: 'error' })
    } catch (error) {
      if (attempt || signal.aborted) throw error
      continue
    }
    if (attempt || response.status < 500) break
    await response.body?.cancel()
  }
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel()
    throw new Error(`Invalid SiliconFlow download (${response.status})`)
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > MAX_DOWNLOAD_BYTES) throw new Error('SiliconFlow image exceeds the download limit')
    chunks.push(chunk)
  }
  const image = Buffer.concat(chunks, size)
  if (!image.subarray(0, 8).equals(PNG_SIGNATURE) && !image.subarray(0, 3).equals(JPEG_SIGNATURE) && !isWebp(image)) {
    throw new Error('Unsupported SiliconFlow image format')
  }
  return image
}

async function generateImage(scene) {
  const { baseUrl, apiKey, model, siliconFlow } = config.wordImages
  const prompt = `Depict this exact scene, keeping the described action, objects and positions: ${scene}\n${ILLUSTRATION_STYLE}`
  const body = siliconFlow
    ? { model, prompt, image_size: '1024x1024', ...(model === 'Kwai-Kolors/Kolors'
      ? { negative_prompt: NEGATIVE_PROMPT, num_inference_steps: 20, guidance_scale: 7.5 } : {}) }
    : { model, prompt, n: 1, size: '1024x1024', quality: 'low', output_format: 'webp', output_compression: 75 }
  const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Image provider HTTP ${response.status}`)
  }
  const payload = await response.json()
  let image
  if (siliconFlow) {
    image = await downloadSiliconFlowImage(payload?.images?.[0]?.url, signal)
  } else {
    const encoded = payload?.data?.[0]?.b64_json
    if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
      throw new Error('Invalid image payload')
    }
    image = Buffer.from(encoded, 'base64')
    if (image.toString('base64') !== encoded) throw new Error('Invalid base64 image')
  }
  const normalized = await sharp(image, { limitInputPixels: 4096 * 4096, autoOrient: true })
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  if (normalized.length > MAX_IMAGE_BYTES || !isWebp(normalized)) throw new Error('Invalid WebP image')
  return normalized
}

async function finishGeneration(target, word, sense, token, provider, sceneOptions) {
  const { table, where, values } = target
  const key = [...values, token]
  let stage = 'scene'
  try {
    const { scene, explanation } = await designScene(provider, word, sense, sceneOptions)
    stage = 'image'
    const image = await generateImage(scene)
    const revision = createHash('sha256').update(image).digest()
    await execute(`UPDATE ${table} SET image=?, image_revision=?, explanation=?, generation_error=NULL, generation_token=NULL, lease_until=NULL
      WHERE ${where} AND generation_token=?`, [image, revision, explanation, ...key])
  } catch (error) {
    console.warn('[word-memory-image] Generation failed', { stage, kind: error.kind || error.name })
    await execute(`UPDATE ${table} SET generation_error=?, generation_token=NULL, lease_until=NULL
      WHERE ${where} AND generation_token=?`, [stage, ...key])
  }
}

export async function startWordMemoryImage(userId, wordId, sense, { sessionId, regenerate, learnerCue } = {}) {
  const word = await getWordById(wordId)
  if (!word.definitions.includes(sense)) throw badRequest('请选择词库中的一条释义。')
  if (!(await hasMistake(userId, wordId))) throw forbidden('只有答错过的单词可以生成记忆图。')
  const [provider, wrongChoice] = await Promise.all([resolveProvider(userId), getWrongChoice(userId, wordId, sessionId)])
  return reserveGeneration(userId, {
    table: 'word_memory_images', where: 'user_id=? AND word_id=? AND sense_hash=?',
    columns: 'user_id, word_id, sense_hash', values: [userId, wordId, hashSense(sense)],
  }, word, sense, provider, { regenerate, learnerCue, wrongChoice })
}

export async function startRecallExampleReplacement(userId, exampleKey, learnerCue) {
  const example = IMAGE_RECALL_EXAMPLES.find(item => item.key === exampleKey)
  if (!example) throw notFound('找不到这张内置练习图。')
  return reserveGeneration(userId, {
    table: 'image_recall_example_replacements', where: 'user_id=? AND example_key=?',
    columns: 'user_id, example_key', values: [userId, exampleKey],
  }, example, example.sense, await resolveProvider(userId), {
    regenerate: true, learnerCue, previousClue: example.explanation,
  })
}

async function reserveGeneration(userId, target, word, sense, provider, options) {
  const { table, where, columns, values } = target
  const token = randomUUID()
  const reservation = await withTransaction(async conn => {
    // Serialize reservations across tabs and processes without holding a DB connection during generation.
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[existing]] = await conn.execute(`SELECT explanation, ${stateSql} FROM ${table}
      WHERE ${where} FOR UPDATE`, values)
    if (existing?.status === 'pending' || (existing?.status === 'ready' && !options.regenerate)) return { status: existing.status }
    if (!imageEnabled()) throw new ApiError(503, 'WORD_IMAGE_UNAVAILABLE', '记忆图服务尚未启用。')
    if (provider.source === 'none') throw new ApiError(503, 'WORD_IMAGE_TEXT_UNAVAILABLE', '请先在偏好设置配置文字 AI，再生成记忆图。')

    const day = todayKey()
    const [[usage]] = await conn.execute(`SELECT SUM(IF(attempt_day=?, daily_attempts, 0)) AS attempts,
      SUM(lease_until > UTC_TIMESTAMP(3)) AS pending FROM (
        SELECT attempt_day, daily_attempts, lease_until FROM word_memory_images WHERE user_id=?
        UNION ALL
        SELECT attempt_day, daily_attempts, lease_until FROM image_recall_example_replacements WHERE user_id=?
      ) attempts`, [day, userId, userId])
    if (Number(usage.pending)) throw quotaExceeded('另一张记忆图正在生成，稍后可以再试。')
    if (Number(usage.attempts) >= config.wordImages.dailyQuota) throw quotaExceeded('今天的记忆图生成次数已用完。')

    const leaseUntil = new Date(Date.now() + LEASE_MS)
    const placeholders = values.map(() => '?').join(', ')
    await conn.execute(`INSERT INTO ${table} (${columns}, generation_token, lease_until, attempt_day)
      VALUES (${placeholders}, ?, ?, ?)
      ON DUPLICATE KEY UPDATE generation_token=?, lease_until=?, generation_error=NULL,
        daily_attempts=IF(attempt_day=?, daily_attempts+1, 1), attempt_day=?`,
      [...values, token, leaseUntil, day, token, leaseUntil, day, day])
    return { status: 'started', previousClue: existing?.explanation || options.previousClue }
  })

  if (reservation.status === 'started') {
    void finishGeneration(target, word, sense, token, provider, {
      wrongChoice: options.wrongChoice, learnerCue: options.learnerCue,
      previousClue: reservation.previousClue, redraw: Boolean(options.regenerate),
    }).catch(error => {
      console.error('[word-memory-image] Could not save generation result', { name: error.name })
    })
  }
  return { status: reservation.status === 'started' ? 'pending' : reservation.status }
}
