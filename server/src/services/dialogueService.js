import { randomUUID } from 'node:crypto'
import { query, queryOne, execute, withTransaction } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { ApiError, badRequest, conflict, notFound, quotaExceeded } from '../utils/errors.js'
import { todayKey, businessDayStartUtc } from '../utils/time.js'
import { getWordById, resolveWordbookForUser } from './wordService.js'
import { resolveProvider } from './ai/apiKeyService.js'
import { chat } from './ai/aiProvider.js'
import { resolveLimits } from './ai/aiSettingsService.js'
import { emptyUsage, addUsage, usageReport } from './ai/usage.js'
import { parseJsonResponse } from './ai/promptTemplates.js'
import { reviewItem, computeMemoryStrength } from './srs.js'
import { DIALOGUE_SCENES, sceneFor, validateTurn, validateReport, buildTurnMessages,
  buildReportMessages, updateTargetUsage, buildHelp, buildEvidence, containsWord } from './dialogueEngine.js'
import { buildScenarioMessages, validateScenario } from './scenarioEngine.js'

const reportJobs = new Map()
const MAX_CALLS = 200
const MAX_SESSIONS = 10
const MAX_HELP = 16

function fromRow(row) {
  if (!row) throw notFound('这轮情境对话不存在')
  return { ...parseJson(row.state, {}), id: Number(row.id), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }
}
async function rowFor(userId, id) {
  return queryOne('SELECT * FROM dialogue_sessions WHERE id = ? AND user_id = ?', [id, userId])
}

function savedSceneFromRow(row) {
  if (!row) throw notFound('这个场景不存在或不属于当前账号')
  return { ...parseJson(row.scene, {}), id: `custom-${row.id}`, saved: true, source: row.source,
    sourceSceneId: row.source_scene_id || null, variant: row.variant || null,
    difficulty: row.difficulty, usage: parseJson(row.generation_usage, null),
    createdAt: row.created_at, updatedAt: row.updated_at }
}

async function savedSceneFor(userId, sceneId) {
  return savedSceneFromRow(await queryOne('SELECT * FROM dialogue_scenes WHERE id = ? AND user_id = ?', [sceneId.slice(7), userId]))
}

async function resolveScene(userId, sceneId, difficulty, variant) {
  if (/^custom-[1-9]\d*$/.test(sceneId)) {
    const scene = await savedSceneFor(userId, sceneId)
    return withDifficulty(scene, difficulty)
  }
  const classic = DIALOGUE_SCENES.find(item => item.id === sceneId)
  if (!classic) throw badRequest('请选择可用的场景')
  if (variant && classic.variants && !classic.variants.some(item => item.id === variant)) throw badRequest('请选择可用的场景版本')
  return { ...sceneFor(sceneId, difficulty, variant), source: 'classic', saved: false }
}

function withDifficulty(scene, difficulty) {
  const level = { beginner: 1, intermediate: 2, advanced: 3 }[difficulty]
  return { ...scene, difficulty, difficultyLevel: level, speechRate: [0.8, 0.95, 1.1][level - 1],
    showTranslation: level === 1, chineseTolerance: level === 1 ? 'high' : level === 2 ? 'medium' : 'low' }
}

export async function generateScenario(userId, { description, difficulty = 'beginner', wordIds = [] }) {
  const words = await Promise.all([...new Set(wordIds)].map(getWordById))
  const targetWords = [...new Set(words.map(w => w.spelling.toLowerCase()))]
  if (targetWords.some(w => !/^[a-z]+(?:['-][a-z]+)*$/.test(w))) throw badRequest('请选择单个英文单词作为情景目标词')
  const request = { description, difficulty, ...(targetWords.length ? { targetWords } : {}) }
  const generation = {}
  const { value, usage } = await generateValidated(userId, generation,
    buildScenarioMessages(request), raw => validateScenario(raw, request), true)
  const saved = await execute(`INSERT INTO dialogue_scenes (user_id,source,difficulty,scene,generation_usage)
    VALUES (?,'custom',?,?,?)`, [userId, difficulty, JSON.stringify({ ...value, description }), JSON.stringify(usage)])
  const scene = await savedSceneFor(userId, `custom-${saved.insertId}`)
  return { scene, usage }
}

export async function saveScenario(userId, { sceneId, difficulty = 'beginner', variant }) {
  if (/^custom-[1-9]\d*$/.test(sceneId)) return { scene: await savedSceneFor(userId, sceneId) }
  const scene = await resolveScene(userId, sceneId, difficulty, variant)
  const { variants, ...snapshot } = scene
  // The unique key makes repeated saves from multiple tabs create one library entry.
  const saved = await execute(`INSERT INTO dialogue_scenes (user_id,source,source_scene_id,variant,difficulty,scene)
    VALUES (?,'classic',?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
  [userId, sceneId, scene.variant || '', difficulty, JSON.stringify(snapshot)])
  return { scene: await savedSceneFor(userId, `custom-${saved.insertId}`) }
}

export async function listDialogues(userId) {
  const [rows, learned, profile, assessed, savedScenes] = await Promise.all([
    query('SELECT * FROM dialogue_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 20', [userId]),
    query(`SELECT w.spelling_norm, p.memory_strength, p.first_learned_at FROM user_word_progress p
      JOIN words w ON w.id = p.word_id WHERE p.user_id = ?
      AND (p.first_learned_at >= ? OR p.memory_strength < 45) ORDER BY p.updated_at DESC LIMIT 200`, [userId, businessDayStartUtc(todayKey())]),
    queryOne('SELECT self_level FROM user_profiles WHERE user_id = ?', [userId]),
    queryOne('SELECT state FROM assessment_sessions WHERE user_id = ? AND completed_at IS NOT NULL ORDER BY id DESC LIMIT 1', [userId]),
    query('SELECT * FROM dialogue_scenes WHERE user_id = ? ORDER BY id DESC', [userId]),
  ])
  const scores = DIALOGUE_SCENES.map(scene => {
    const matches = learned.filter(w => scene.words.includes(w.spelling_norm))
    return { ...scene, recommendationScore: matches.reduce((n, w) => n + (Number(w.memory_strength) < 45 ? 2 : 1), 0),
      recommendationReason: matches.length ? `练习最近学过或仍薄弱的 ${matches.map(w => w.spelling_norm).join('、')}` : '练习常用生活表达' }
  }).sort((a, b) => b.recommendationScore - a.recommendationScore)
  const assessment = parseJson(assessed?.state, {})
  // Assessment bands measure this book, so use demonstrated band mastery rather than treating
  // estimatedKnown as a total vocabulary or spoken-language level.
  const masteredBand = assessment.result?.total >= 10
    ? Math.max(0, ...assessment.result.bands.filter(b => b.tested >= 3 && b.mastery >= 0.6).map(b => b.band)) : 0
  const level = Number(String(profile?.self_level || '0').match(/\d+/)?.[0] || 0)
  return { scenes: DIALOGUE_SCENES, recommendations: scores.slice(0, 3),
    recommendedDifficulty: masteredBand ? (masteredBand >= 4 ? 'advanced' : masteredBand >= 3 ? 'intermediate' : 'beginner')
      : level >= 6000 ? 'advanced' : level >= 3000 ? 'intermediate' : 'beginner',
    sessions: rows.map(fromRow), savedScenes: savedScenes.map(savedSceneFromRow) }
}

async function configuredProvider(userId) {
  const provider = await resolveProvider(userId)
  if (provider.source === 'none') throw new ApiError(503, 'AI_NOT_CONFIGURED', '请先在 AI 设置中配置文字模型，再开始情境对话')
  return provider
}

export async function startDialogue(userId, { sceneId, strictness = 'standard', difficulty = 'beginner', variant, mode = 'task', maxTurns = 8 }) {
  const scene = await resolveScene(userId, sceneId, difficulty, variant)
  return createDialogue(userId, scene, { sceneId, strictness, difficulty, variant: scene.variant, mode, maxTurns })
}

export async function repeatDialogue(userId, id, options = {}) {
  const previous = fromRow(await rowFor(userId, id))
  const difficulty = options.difficulty || previous.difficulty || 'beginner'
  const scene = withDifficulty(structuredClone(previous.scene), difficulty)
  return createDialogue(userId, scene, { sceneId: previous.sceneId, difficulty, variant: previous.variant,
    strictness: options.strictness || previous.strictness || 'standard',
    mode: options.mode || previous.mode || 'task', maxTurns: options.maxTurns || previous.maxTurns || 8 })
}

async function createDialogue(userId, scene, { sceneId, strictness, difficulty, variant, mode, maxTurns }) {
  await configuredProvider(userId)
  const limits = await resolveLimits(userId)
  const state = { sceneId, scene: { ...scene, maxTurns }, strictness, difficulty, variant: variant || null, mode, maxTurns, turnCount: 0,
    messages: [{ role: 'assistant', text: scene.opening, translation: difficulty === 'beginner' ? (scene.openingTranslation || scene.task) : '' }],
    targetUsage: scene.targets.map(t => ({ ...t, status: 'unused', helpLevel: 0 })), help: null, helpEvents: [], report: null, reportAttempts: 0 }
  const id = await withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId])
    const [rows] = await conn.execute('SELECT COUNT(*) n FROM dialogue_sessions WHERE user_id = ? AND created_at >= ?', [userId, businessDayStartUtc(todayKey())])
    if (!limits.unlimited && Number(rows[0].n) >= MAX_SESSIONS) throw quotaExceeded('今日已开始 10 轮情境对话，可以继续未完成的对话或查看小结')
    const [saved] = await conn.execute('INSERT INTO dialogue_sessions (user_id, scene, state, created_at, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())', [userId, sceneId, JSON.stringify(state)])
    return Number(saved.insertId)
  })
  return getDialogue(userId, id)
}

// A durable lease prevents double submissions from tabs or different server processes.
async function claim(userId, id, expectedTurn, allowed = ['active']) {
  const token = randomUUID()
  const session = await withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT * FROM dialogue_sessions WHERE id = ? AND user_id = ? FOR UPDATE', [id, userId])
    const row = rows[0], session = fromRow(row)
    if (!allowed.includes(row.status)) throw conflict('这轮对话已结束，请查看小结')
    if (expectedTurn != null && session.turnCount !== expectedTurn) throw conflict('对话已更新，请刷新后继续')
    if (row.lease_until && new Date(row.lease_until).getTime() > Date.now()) throw conflict('上一条还在处理中，请稍候')
    await conn.execute('UPDATE dialogue_sessions SET operation_token = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE), updated_at=UTC_TIMESTAMP() WHERE id = ?', [token, id])
    return session
  })
  return { token, session }
}
async function release(id, token) {
  await execute('UPDATE dialogue_sessions SET operation_token = NULL, lease_until = NULL, updated_at=UTC_TIMESTAMP() WHERE id = ? AND operation_token = ?', [id, token])
}
async function saveClaimed(session, token, status = 'active') {
  const saved = await execute('UPDATE dialogue_sessions SET state = ?, status = ?, operation_token = NULL, lease_until = NULL, updated_at=UTC_TIMESTAMP() WHERE id = ? AND operation_token = ?',
    [JSON.stringify(session), status, session.id, token])
  if (!saved.affectedRows) throw conflict('对话已更新，请重新加载')
}

async function generateValidated(userId, session, messages, validator, report = false) {
  const provider = await configuredProvider(userId)
  const limits = await resolveLimits(userId)
  const total = emptyUsage()
  let jsonMode = true
  let maxTokens = limits.unlimited ? undefined : report ? Math.max(4096, limits.errorCardTokens) : Math.max(2048, limits.quizTokens)
  for (let attempt = 0; attempt < 2; attempt++) {
    await execute('INSERT IGNORE INTO dialogue_daily_usage (user_id, usage_date) VALUES (?, ?)', [userId, todayKey()])
    const reserved = await execute(`UPDATE dialogue_daily_usage SET calls = calls + 1 WHERE user_id = ? AND usage_date = ?${limits.unlimited ? '' : ' AND calls < ?'}`,
      limits.unlimited ? [userId, todayKey()] : [userId, todayKey(), MAX_CALLS])
    if (!reserved.affectedRows) throw quotaExceeded('今日情境 AI 调用已达上限，可在 AI 设置选择不限额度；已有对话已保存')
    let received
    const before = { ...total }
    try {
      const result = await chat({ ...provider, messages, maxTokens, temperature: 0.4, jsonMode, disableThinking: !limits.allowThinking })
      received = result.usage
      addUsage(total, received, result.model)
      if (result.finishReason === 'length') throw Object.assign(new Error('模型输出达到上限，回复被截断'), { kind: 'truncated' })
      const value = validator(parseJsonResponse(result.content))
      if (session.lastAiError) session.lastAiError.recovered = true
      return { value, usage: usageReport(total, provider) }
    } catch (error) {
      if (!received) addUsage(total, error.diagnostics?.usage, provider.model)
      const diagnostics = error.diagnostics || {}
      session.lastAiError = { reason: error.kind || 'validation_failed', finishReason: diagnostics.finishReason || null,
        emptyContent: Boolean(diagnostics.emptyContent), whitespaceOnly: Boolean(diagnostics.whitespaceOnly),
        contentLength: diagnostics.contentLength ?? null, jsonMode, attempt: attempt + 1 }
      // Some endpoints finish JSON mode with whitespace only. Change the transport
      // option on retry; the prompt and validator still require the same JSON schema.
      if (error.kind === 'bad_response' && diagnostics.emptyContent && !diagnostics.hasReasoning) jsonMode = false
      const retryable = !error.kind || ['truncated', 'bad_response', 'reasoning_exhausted'].includes(error.kind)
      if (attempt === 1 || !retryable) {
        const usage = usageReport(total, provider)
        const label = { truncated: '模型输出被截断', timeout: 'AI 请求超时', rate_limited: '服务商限流或额度不足', reasoning_exhausted: '模型将输出额度用于内部思考' }[error.kind] || (error.kind ? error.message : 'AI 返回内容未通过格式或证据校验')
        throw new ApiError(error.status === 429 ? 429 : 503, 'PRACTICE_AI_FAILED', `${label}，请重试；${session.id ? '对话和输入已保留' : '场景尚未生成，你可以保留需求再试一次'}`, { reason: error.kind || 'validation_failed', usage })
      }
      total.retried = true
      total.retryReason = diagnostics.emptyContent ? 'empty_content' : error.kind || 'validation_failed'
      if (maxTokens != null) maxTokens = Math.min(maxTokens * 2, 32000)
    } finally {
      // Empty responses can still contain billable usage, already included in total.
      session.lastUsage = usageReport(total, provider)
      session.usage = { ...usageReport({
        promptTokens: Number(session.usage?.promptTokens || 0) + total.promptTokens - before.promptTokens,
        completionTokens: Number(session.usage?.completionTokens || 0) + total.completionTokens - before.completionTokens,
        calls: Number(session.usage?.calls || 0) + total.calls - before.calls,
        unknownCalls: Number(session.usage?.unknownCalls || 0) + total.unknownCalls - before.unknownCalls,
      }, provider) }
      await execute('UPDATE dialogue_daily_usage SET prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ? WHERE user_id = ? AND usage_date = ?',
        [total.promptTokens - before.promptTokens, total.completionTokens - before.completionTokens, userId, todayKey()])
      // Persist charged attempts even when validation fails; the lease remains held.
      if (session.id) await execute('UPDATE dialogue_sessions SET state = ? WHERE id = ? AND user_id = ?', [JSON.stringify(session), session.id, userId])
    }
  }
}

export async function addDialogueTurn(userId, id, { text, expectedTurn }) {
  const { token, session } = await claim(userId, id, expectedTurn)
  try {
    if (session.turnCount >= session.maxTurns) throw conflict('已达到本轮上限，请结束并查看小结')
    const { value: turn, usage } = await generateValidated(userId, session, buildTurnMessages(session, text), raw => validateTurn(raw, text, session.scene))
    const helpLevel = Math.max(session.help?.level || 0, turn.mixedLanguage ? 3 : 0)
    const assistanceWords = session.help?.example
      ? session.scene.targets.filter(t => containsWord(session.help.example, t.word)).map(t => t.word)
      : [session.help?.word || turn.helpWord].filter(Boolean)
    session.targetUsage = updateTargetUsage(session.targetUsage, { ...turn, assistanceWords }, text, helpLevel)
    session.messages.push({ role: 'user', text, corrections: turn.corrections, helpLevel, usedTargets: turn.usedTargets, mixedLanguage: turn.mixedLanguage })
    session.messages.push({ role: 'assistant', text: turn.reply, translation: turn.translation || '', corrections: [], usage })
    session.turnCount += 1
    // Chinese assistance is explicitly a demonstration awaiting a separate user turn.
    session.help = turn.mixedLanguage && turn.helpEnglish
      ? { level: 3, word: turn.helpWord || session.scene.targets.find(t => containsWord(turn.helpEnglish, t.word))?.word || null,
        hint: '试着把这句英文说一遍', example: turn.helpEnglish, translation: text }
      : null
    if (session.help) {
      session.helpEvents.push({ ...session.help, turn: session.turnCount })
      session.targetUsage = session.targetUsage.map(t => t.word === session.help.word
        ? { ...t, helpLevel: Math.max(t.helpLevel || 0, 3), weak: true, status: t.status === 'unused' ? 'weak' : t.status, tags: [...new Set([...(t.tags || []), 'chinese_help'])] } : t)
    }
    const done = session.turnCount >= session.maxTurns || (session.mode !== 'free' && session.turnCount >= 6 && turn.taskComplete)
    await saveClaimed(session, token, done ? 'analyzing' : 'active')
    if (done) scheduleReport(userId, id)
    return getDialogue(userId, id)
  } finally { await release(id, token) }
}

export async function requestDialogueHelp(userId, id, options) {
  const { token, session } = await claim(userId, id, options.expectedTurn)
  try {
    const maxHelp = Math.max(MAX_HELP, (session.maxTurns || 8) * 2)
    if (session.helpEvents.length >= maxHelp) throw badRequest(`本轮帮助已达 ${maxHelp} 次，可以复述已有示范或结束练习`)
    if (options.word && !session.scene.words.includes(options.word)) throw badRequest('请选择本轮目标词')
    let help = buildHelp(session, options)
    if (options.level === 3 && options.text?.trim()) {
      const { value: turn } = await generateValidated(userId, session, buildTurnMessages(session, options.text), raw => validateTurn(raw, options.text, session.scene))
      const example = turn.helpEnglish || turn.reply
      help = { ...help, word: turn.helpWord || session.scene.targets.find(t => containsWord(example, t.word))?.word || null,
        example, translation: options.text }
    }
    session.help = help
    session.helpEvents.push({ ...help, turn: session.turnCount })
    session.targetUsage = session.targetUsage.map(t => t.word === help.word ? { ...t, helpLevel: Math.max(t.helpLevel || 0, help.level), status: t.status === 'unused' ? 'weak' : t.status } : t)
    await saveClaimed(session, token)
    return getDialogue(userId, id)
  } finally { await release(id, token) }
}

export async function finishDialogue(userId, id, retry = false) {
  const previous = fromRow(await rowFor(userId, id))
  if (previous.status === 'finished' || previous.status === 'analyzing') return getDialogue(userId, id)
  const { token, session } = await claim(userId, id, null, retry ? ['report_failed'] : ['active'])
  try {
    if (session.reportAttempts >= 3) throw badRequest('小结已尝试 3 次，完整对话仍可查看，请稍后联系管理员')
    await saveClaimed(session, token, 'analyzing')
    scheduleReport(userId, id)
    return getDialogue(userId, id)
  } finally { await release(id, token) }
}

function scheduleReport(userId, id) {
  if (reportJobs.has(id)) return
  const task = Promise.resolve().then(() => generateReport(userId, id)).catch(error => {
    console.error('[dialogue report]', error.code || error.name)
  }).finally(() => reportJobs.delete(id))
  reportJobs.set(id, task)
}
export async function getDialogue(userId, id) {
  const row = await rowFor(userId, id), session = fromRow(row)
  // Resume after a process restart; a live worker retains its lease until it commits.
  if (session.status === 'analyzing' && (!row.lease_until || new Date(row.lease_until).getTime() <= Date.now())) scheduleReport(userId, id)
  return session
}

async function generateReport(userId, id) {
  let claimed
  try { claimed = await claim(userId, id, null, ['analyzing']) }
  catch (error) { if (error.status === 409) return; throw error }
  const { token, session } = claimed
  session.reportAttempts = (session.reportAttempts || 0) + 1
  try {
    const report = session.turnCount || session.helpEvents.length
      ? (await generateValidated(userId, session, buildReportMessages(session), raw => validateReport(raw, session), true)).value
      : { summary: '这轮还没有作答，未更改任何单词的复习安排。', corrections: [], weakWords: [], reinforcement: [], grammarWeaknesses: [] }
    const evidence = buildEvidence(session, report)
    await finalizeReport(userId, session, report, evidence, token)
  } catch (error) {
    session.reportError = error.status === 429 ? error.message : '小结暂时生成失败，对话已保存。可以重试生成。'
    await saveClaimed(session, token, 'report_failed')
  } finally { await release(id, token) }
}

async function finalizeReport(userId, session, report, evidence, token) {
  const book = await resolveWordbookForUser(userId)
  const candidates = [...new Set(evidence.map(e => e.word.toLowerCase()))]
  const matches = candidates.length ? await query(`SELECT w.id, w.wordbook_id, w.spelling, w.spelling_norm FROM words w
    JOIN wordbooks b ON b.id = w.wordbook_id WHERE w.spelling_norm IN (${candidates.map(() => '?').join(',')})
    ORDER BY (w.wordbook_id = ?) DESC, (b.code = 'dialogue-core') DESC, w.id ASC`, [...candidates, book.id]) : []
  const words = [...new Map(matches.toReversed().map(w => [w.spelling_norm, w])).values()]
  await withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT status, operation_token FROM dialogue_sessions WHERE id = ? AND user_id = ? FOR UPDATE', [session.id, userId])
    if (rows[0]?.status !== 'analyzing' || rows[0].operation_token !== token) throw conflict('小结已更新')
    // Serialize SRS writes with studyService's row locks, then commit report and evidence together.
    const reviewWords = [], strengthenedWords = []
    const combined = new Map()
    for (const e of evidence) {
      const word = words.find(w => w.spelling_norm === e.word.toLowerCase())
      await conn.execute(`INSERT INTO dialogue_word_evidence (session_id,user_id,word_id,spelling,sense,result,help_level,weight,tags,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`, [session.id, userId, word?.id || null, e.word, e.sense || '', e.status, e.helpLevel || 0, e.weight || 1, JSON.stringify(e.tags)])
      if (!word) continue
      const prior = combined.get(Number(word.id))
      if (!prior || e.status !== 'independent') combined.set(Number(word.id), { ...e, word })
    }
    for (const e of combined.values()) {
      const word = e.word, success = e.status === 'independent'
      await conn.execute(`INSERT IGNORE INTO user_word_progress (user_id,word_id,wordbook_id,first_learned_at) VALUES (?,?,?,UTC_TIMESTAMP())`, [userId, word.id, word.wordbook_id])
      const [progressRows] = await conn.execute('SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ? FOR UPDATE', [userId, word.id])
      const p = progressRows[0]
      const next = reviewItem({ ef: p.ef, repetitions: p.repetitions, intervalDays: p.interval_days }, success ? 5 : 1, Date.now(), { relearnDays: Math.max(0.25, 1 / (e.weight || 1)) })
      if (success) {
        // Strong production evidence must never shorten an existing review interval.
        next.intervalDays = Math.min(365, Math.max(next.intervalDays, Number(p.interval_days) * 1.2))
        const due = Math.max(Date.now() + next.intervalDays * 86400000, p.next_review_at ? new Date(p.next_review_at).getTime() : 0)
        next.nextReviewAt = new Date(due)
        next.state = next.intervalDays >= 21 ? 'mastered' : 'reviewing'
      }
      const strength = computeMemoryStrength({ repetitions: next.repetitions, ef: next.ef, timesSeen: Number(p.times_seen) + 1,
        timesCorrect: Number(p.times_correct) + Number(success), lastResult: success, lastHesitationMs: success ? 2000 : 6000 })
      await conn.execute(`UPDATE user_word_progress SET state=?,ef=?,repetitions=?,interval_days=?,memory_strength=?,next_review_at=IF(?, ?, UTC_TIMESTAMP()),
        last_review_at=UTC_TIMESTAMP(),times_seen=times_seen+1,times_correct=times_correct+?,times_wrong=times_wrong+?,
        streak_correct=?,last_result=? WHERE user_id=? AND word_id=?`,
      [next.state, next.ef, next.repetitions, next.intervalDays, strength, Number(success), next.nextReviewAt, Number(success), Number(!success), success ? Number(p.streak_correct) + 1 : 0, Number(success), userId, word.id])
      ;(success ? strengthenedWords : reviewWords).push({ id: Number(word.id), spelling: word.spelling, tags: e.tags, weight: e.weight })
    }
    session.report = { ...report, usage: session.lastUsage, targetUsage: session.targetUsage, reviewWords, strengthenedWords,
      unmatchedWords: candidates.filter(w => !words.some(m => m.spelling_norm === w)), evidence }
    session.reportError = null
    await conn.execute(`UPDATE dialogue_sessions SET state=?,status='finished',operation_token=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP() WHERE id=? AND operation_token=?`, [JSON.stringify(session), session.id, token])
  })
}
