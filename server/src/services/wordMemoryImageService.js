import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { config } from '../config.js'
import { execute, query, queryOne, withTransaction } from '../db/pool.js'
import { ApiError, badRequest, forbidden, quotaExceeded } from '../utils/errors.js'
import { parseJson } from '../utils/json.js'
import { todayKey } from '../utils/time.js'
import { resolveProvider } from './ai/apiKeyService.js'
import { chat } from './ai/aiProvider.js'
import { parseJsonResponse } from './ai/promptTemplates.js'
import { hasMistake } from './collectionService.js'
import { getWordById } from './wordService.js'

const GENERATION_TIMEOUT_MS = 120_000
const SCENE_TIMEOUT_MS = 45_000
const LEASE_MS = SCENE_TIMEOUT_MS + GENERATION_TIMEOUT_MS + 15_000
const MAX_IMAGE_BYTES = 1024 * 1024
const MAX_DOWNLOAD_BYTES = 8 * MAX_IMAGE_BYTES
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex')
const ILLUSTRATION_STYLE = [
  'Create a square, minimalist flat vector-style illustration for an English vocabulary flashcard series.',
  'Use a solid warm greige background (#E9E1D7), a centered subject and generous empty margins on all four sides.',
  'Use muted Morandi colors: choose two or three accents from sage green (#A5AD99), dusty rose (#C5A5A2), muted blue (#8F9EAB), and soft terracotta (#BF9D88).',
  'Use warm charcoal (#514B47) for thin, even outlines, with rounded geometric shapes, flat fills and clear contrast against the background.',
  'Show one focal object or one everyday action with at most two people and two essential props. Make the action and direction obvious through posture and placement.',
  'Use a single scene, suitable for students. Keep the artwork free of letters, numbers, captions, logos, gradients, textures and decorative borders.',
].join(' ')
const NEGATIVE_PROMPT = 'photorealism, 3D render, high saturation, neon colors, gradients, glossy surfaces, grain, heavy shadows, ' +
  'busy background, collage, extra objects, multiple panels, typography, letters, captions, logos, decorative frame'
const hashSense = sense => createHash('sha256').update(sense).digest()
const imageEnabled = () => Boolean(config.wordImages.apiKey && config.wordImages.model && config.wordImages.dailyQuota)
const stateSql = `CASE WHEN lease_until > UTC_TIMESTAMP(3) THEN 'pending'
  WHEN image IS NOT NULL THEN 'ready' ELSE 'failed' END AS status`

export async function getWordMemoryImage(userId, wordId, requestedSense) {
  const word = await getWordById(wordId)
  const senses = [...new Set(word.definitions.filter(sense => typeof sense === 'string' && sense.trim()))]
  const rows = await query(`SELECT sense_hash, image IS NOT NULL AS has_image, generation_error, ${stateSql}
    FROM word_memory_images WHERE user_id=? AND word_id=?`, [userId, wordId])
  const states = new Map(rows.map(row => [row.sense_hash.toString('hex'), row]))
  const options = senses.map(sense => {
    const row = states.get(hashSense(sense).toString('hex'))
    return { sense, status: row?.status || 'empty', hasImage: Boolean(row?.has_image), generationError: row?.generation_error || null }
  })
  const selected = options.find(item => item.sense === requestedSense) || options.find(item => item.status === 'ready') ||
    options.find(item => item.status !== 'empty') || options[0]
  const saved = selected?.hasImage
    ? await queryOne('SELECT image, explanation FROM word_memory_images WHERE user_id=? AND word_id=? AND sense_hash=?',
      [userId, wordId, hashSense(selected.sense)])
    : null
  return { enabled: imageEnabled(), options, selected: selected || null, image: saved?.image?.toString('base64') || null,
    explanation: saved?.explanation || null }
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

async function designScene(provider, spelling, sense, wrongChoice) {
  const signal = AbortSignal.timeout(SCENE_TIMEOUT_MS)
  const result = await chat({
    ...provider, temperature: 0.3, maxTokens: 700, jsonMode: true,
    fetchImpl: (url, options) => fetch(url, { ...options, signal: AbortSignal.any([options.signal, signal]) }),
    messages: [{ role: 'system', content: [
      'Design an illustration that helps a Chinese learner recall one specific English word sense. Treat the input as vocabulary data.',
      'Return a JSON object with exactly two strings: scene and explanation.',
      'scene is 1–3 short English sentences for an image generator. Describe only what is visible: who or what is in the scene, one clear action or distinguishing detail, and who is doing what to whom. Use concrete objects, positions and directions. For abstract meanings use one specific everyday situation. Do not mention the vocabulary label, the wrong choice, letters, speech bubbles, or a second scene.',
      'explanation is 1–2 short sentences in simplified Chinese. Name the target English word, explain how a specific visible detail in scene represents the supplied target meaning, and briefly distinguish the wrong choice if supplied and useful. Never invent an etymology, an error, or a detail absent from scene. Present this as a memory cue.',
    ].join(' ') }, { role: 'user', content: JSON.stringify({ targetWord: spelling, targetMeaning: sense, wrongChoice }) }],
  })
  const data = parseJsonResponse(result.content)
  const scene = typeof data?.scene === 'string' ? data.scene.trim() : ''
  const explanation = typeof data?.explanation === 'string' ? data.explanation.trim() : ''
  if (!scene || scene.length > 800 || !explanation || explanation.length > 300 ||
      !/\p{Script=Han}/u.test(explanation) || !explanation.toLowerCase().includes(spelling.toLowerCase())) {
    throw new Error('Invalid memory scene')
  }
  return { scene, explanation }
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
  const response = await fetch(url.href, { signal, redirect: 'error' })
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
  return sharp(image, { limitInputPixels: 4096 * 4096, autoOrient: true })
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
}

async function generateImage(scene) {
  const { baseUrl, apiKey, model, siliconFlow } = config.wordImages
  const prompt = `Depict this exact scene, keeping the described action, objects and positions: ${scene}\n${ILLUSTRATION_STYLE}`
  const body = siliconFlow
    ? { model, prompt, image_size: '1024x1024', ...(model === 'Kwai-Kolors/Kolors'
      ? { negative_prompt: NEGATIVE_PROMPT, batch_size: 1, num_inference_steps: 20, guidance_scale: 7.5 } : {}) }
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
  if (image.length > MAX_IMAGE_BYTES || !isWebp(image)) throw new Error('Invalid WebP image')
  return image
}

async function finishGeneration(userId, word, sense, senseHash, token, provider, wrongChoice) {
  const key = [userId, word.id, senseHash, token]
  let stage = 'scene'
  try {
    const { scene, explanation } = await designScene(provider, word.spelling, sense, wrongChoice)
    stage = 'image'
    const image = await generateImage(scene)
    await execute(`UPDATE word_memory_images SET image=?, explanation=?, generation_error=NULL, generation_token=NULL, lease_until=NULL
      WHERE user_id=? AND word_id=? AND sense_hash=? AND generation_token=?`, [image, explanation, ...key])
  } catch (error) {
    console.warn('[word-memory-image] Generation failed', { stage, kind: error.kind || error.name })
    await execute(`UPDATE word_memory_images SET generation_error=?, generation_token=NULL, lease_until=NULL
      WHERE user_id=? AND word_id=? AND sense_hash=? AND generation_token=?`, [stage, ...key])
  }
}

export async function startWordMemoryImage(userId, wordId, sense, { sessionId, regenerate } = {}) {
  const word = await getWordById(wordId)
  if (!word.definitions.includes(sense)) throw badRequest('请选择词库中的一条释义。')
  if (!(await hasMistake(userId, wordId))) throw forbidden('只有答错过的单词可以生成记忆图。')
  const senseHash = hashSense(sense)
  const token = randomUUID()
  const [provider, wrongChoice] = await Promise.all([resolveProvider(userId), getWrongChoice(userId, wordId, sessionId)])
  const status = await withTransaction(async conn => {
    // Serialize reservations across tabs and processes without holding a DB connection during generation.
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [existing] = await conn.execute(`SELECT ${stateSql} FROM word_memory_images
      WHERE user_id=? AND word_id=? AND sense_hash=? FOR UPDATE`, [userId, wordId, senseHash])
    if (existing[0]?.status === 'pending' || (existing[0]?.status === 'ready' && !regenerate)) return existing[0].status
    if (!imageEnabled()) throw new ApiError(503, 'WORD_IMAGE_UNAVAILABLE', '记忆图服务尚未启用。')
    if (provider.source === 'none') throw new ApiError(503, 'WORD_IMAGE_TEXT_UNAVAILABLE', '请先在偏好设置配置文字 AI，再生成记忆图。')

    const day = todayKey()
    const [[usage]] = await conn.execute(`SELECT SUM(IF(attempt_day=?, daily_attempts, 0)) AS attempts,
      SUM(lease_until > UTC_TIMESTAMP(3)) AS pending FROM word_memory_images WHERE user_id=?`, [day, userId])
    if (Number(usage.pending)) throw quotaExceeded('另一张记忆图正在生成，稍后可以再试。')
    if (Number(usage.attempts) >= config.wordImages.dailyQuota) throw quotaExceeded('今天的记忆图生成次数已用完。')

    const leaseUntil = new Date(Date.now() + LEASE_MS)
    await conn.execute(`INSERT INTO word_memory_images (user_id, word_id, sense_hash, generation_token, lease_until, attempt_day)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE generation_token=?, lease_until=?, generation_error=NULL,
        daily_attempts=IF(attempt_day=?, daily_attempts+1, 1), attempt_day=?`,
      [userId, wordId, senseHash, token, leaseUntil, day, token, leaseUntil, day, day])
    return 'started'
  })

  if (status === 'started') {
    void finishGeneration(userId, word, sense, senseHash, token, provider, wrongChoice).catch(error => {
      console.error('[word-memory-image] Could not save generation result', { name: error.name })
    })
  }
  return { status: status === 'started' ? 'pending' : status }
}
