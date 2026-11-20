import { createHash, randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { query, queryOne, execute, withTransaction } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { badRequest, conflict, notFound, quotaExceeded } from '../utils/errors.js'
import { todayKey } from '../utils/time.js'
import { generateImage } from './wordMemoryImageService.js'
import { COMIC_STYLE, canAddPanel, castFor, openingPanel } from './dialogueIllustrationEngine.js'

export const illustrationsAvailable = () => config.dialogueComicEnabled &&
  Boolean(config.wordImages.apiKey && config.wordImages.model && config.wordImages.dailyQuota)
const statusSql = `CASE WHEN generation_token IS NOT NULL AND lease_until > UTC_TIMESTAMP(3) THEN 'pending'
 WHEN image_revision IS NOT NULL THEN 'ready' ELSE 'failed' END AS status`
const publicColumns = `id,scene_id,session_id,turn_number,topic_key,caption,description,cast_description,image_revision,generation_error,${statusSql}`
const keyFor = (sceneId, sessionId, turn) => createHash('sha256').update(JSON.stringify([sceneId, sessionId || null, turn])).digest('hex')

export async function imagePreferences(userId) {
  const row = await queryOne('SELECT auto_images FROM dialogue_image_preferences WHERE user_id=?', [userId])
  return { autoImages: row ? Number(row.auto_images) === 1 : false, available: illustrationsAvailable() }
}
export async function saveImagePreferences(userId, autoImages) {
  await execute('INSERT INTO dialogue_image_preferences (user_id,auto_images) VALUES (?,?) ON DUPLICATE KEY UPDATE auto_images=VALUES(auto_images)', [userId, Number(autoImages)])
  return imagePreferences(userId)
}
async function ownedScene(userId, sceneId) {
  if (!/^custom-[1-9]\d*$/.test(sceneId)) throw badRequest('请选择已生成的情境。')
  const row = await queryOne('SELECT scene FROM dialogue_scenes WHERE id=? AND user_id=?', [sceneId.slice(7), userId])
  if (!row) throw notFound('这个情境不存在。')
  return { ...parseJson(row.scene, {}), id: sceneId }
}
function present(row) {
  return { id: Number(row.id), turn: Number(row.turn_number), caption: row.caption, status: row.status,
    error: row.generation_error || (row.status === 'failed' ? 'interrupted' : null),
    imagePath: row.image_revision ? `/practice/illustrations/${row.id}/${row.image_revision.toString('hex')}` : null }
}
export async function illustrationContext(userId, scene, sessionId) {
  if (!illustrationsAvailable() || scene.memoryImage || !scene.id?.startsWith('custom-')) return { enabled: false }
  const prefs = await imagePreferences(userId)
  if (!prefs.autoImages) return { enabled: false }
  const rows = await query(`SELECT ${publicColumns} FROM dialogue_illustrations WHERE user_id=? AND scene_id=?
    AND (session_id IS NULL OR session_id=?) ORDER BY turn_number,id`, [userId, scene.id, sessionId])
  const last = rows.at(-1)
  return { enabled: true, count: rows.length, lastTurn: Number(last?.turn_number || 0), topicKey: last?.topic_key || 'opening',
    description: last?.description || scene.task, cast: last?.cast_description || castFor(scene) }
}
export async function listIllustrations(userId, { sceneId, sessionId }) {
  if (sessionId) {
    const row = await queryOne('SELECT scene,state FROM dialogue_sessions WHERE id=? AND user_id=?', [sessionId,userId])
    if (!row) throw notFound('这轮对话不存在。')
    sceneId = row.scene
  } else await ownedScene(userId, sceneId)
  const [preferences, rows] = await Promise.all([imagePreferences(userId), query(`SELECT ${publicColumns}
    FROM dialogue_illustrations WHERE user_id=? AND scene_id=? AND (session_id IS NULL OR session_id=?)
    ORDER BY turn_number,id`, [userId,sceneId,sessionId || null])])
  return { ...preferences, items: rows.map(present) }
}
export async function readIllustration(userId, id, revision) {
  const row = await queryOne('SELECT image FROM dialogue_illustrations WHERE user_id=? AND id=? AND image_revision=UNHEX(?)', [userId,id,revision])
  if (!row?.image) throw notFound('这张情境图片不存在。')
  return row.image
}

async function finishPanel(row, token) {
  try {
    // Re-check immediately before a paid request: disabling the setting stops queued work.
    const preferences = await imagePreferences(row.userId)
    if (!preferences.autoImages || !preferences.available) {
      await execute("UPDATE dialogue_illustrations SET generation_token=NULL,lease_until=NULL,generation_error='disabled',daily_attempts=GREATEST(daily_attempts-1,0) WHERE id=? AND generation_token=?", [row.id,token])
      return
    }
    const image = await generateImage(`${row.cast}\nScene: ${row.description}`, {}, COMIC_STYLE)
    const revision = createHash('sha256').update(image).digest()
    await execute('UPDATE dialogue_illustrations SET image=?,image_revision=?,generation_token=NULL,lease_until=NULL,generation_error=NULL WHERE id=? AND generation_token=?', [image,revision,row.id,token])
  } catch (error) {
    await execute("UPDATE dialogue_illustrations SET generation_token=NULL,lease_until=NULL,generation_error='provider' WHERE id=? AND generation_token=?", [row.id,token])
    console.warn('[dialogue-image]', { name: error.name })
  }
}

async function reservePanel(userId, scene, sessionId, turn, panel, { retry = false } = {}) {
  if (!illustrationsAvailable() || scene.memoryImage) return null
  const prefs = await imagePreferences(userId)
  if (!prefs.autoImages || !prefs.available) return null
  const token = randomUUID(), key = keyFor(scene.id,sessionId,turn), day = todayKey()
  const id = await withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[existing]] = await conn.execute(`SELECT id,${statusSql} FROM dialogue_illustrations WHERE user_id=? AND context_key=? FOR UPDATE`, [userId,key])
    if (existing && (!retry || existing.status !== 'failed')) return null
    const [[usage]] = await conn.execute(`SELECT SUM(IF(attempt_day=?,daily_attempts,0)) attempts, SUM(lease_until>UTC_TIMESTAMP(3)) pending FROM (
      SELECT attempt_day,daily_attempts,lease_until FROM word_memory_images WHERE user_id=? UNION ALL
      SELECT attempt_day,daily_attempts,lease_until FROM image_recall_example_replacements WHERE user_id=? UNION ALL
      SELECT attempt_day,daily_attempts,lease_until FROM dialogue_illustrations WHERE user_id=? UNION ALL
      SELECT attempt_day,daily_attempts,lease_until FROM dialogue_scene_images WHERE user_id=?
    ) image_usage`, [day,userId,userId,userId,userId])
    if (Number(usage.attempts) >= config.wordImages.dailyQuota) throw quotaExceeded('今天的图片生成次数已用完，仍可继续对话。')
    if (sessionId) {
      const [[pending]] = await conn.execute('SELECT COUNT(*) n FROM dialogue_illustrations WHERE user_id=? AND session_id=? AND lease_until>UTC_TIMESTAMP(3)', [userId,sessionId])
      if (Number(pending.n)) return null
    }
    const [result] = await conn.execute(`INSERT INTO dialogue_illustrations
      (user_id,scene_id,session_id,turn_number,context_key,topic_key,caption,description,cast_description,generation_token,lease_until,attempt_day,daily_attempts)
      VALUES (?,?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 150 SECOND),?,1)
      ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),generation_token=VALUES(generation_token),lease_until=VALUES(lease_until),generation_error=NULL,
      daily_attempts=IF(attempt_day=VALUES(attempt_day),daily_attempts+1,1),attempt_day=VALUES(attempt_day)`,
    [userId,scene.id,sessionId || null,turn,key,panel.topicKey,panel.caption,panel.description,castFor(scene),token,day])
    return Number(result.insertId)
  })
  if (id) void finishPanel({id,userId,description:panel.description,cast:castFor(scene)},token).catch(e => console.warn('[dialogue-image-save]',e.name))
  return id
}
export async function queueOpeningIllustration(userId, scene) {
  if (!scene.id?.startsWith('custom-') || scene.memoryImage) return
  try { await reservePanel(userId, scene, null, 0, openingPanel(scene)) }
  catch (e) { console.warn('[dialogue-image-opening]',e.code || e.name) }
}
export async function queueTurnIllustration(userId, session, update) {
  if (!canAddPanel(session.illustrationContext, update, session.turnCount)) return
  try { await reservePanel(userId, session.scene, session.id, session.turnCount, update) }
  catch (e) { console.warn('[dialogue-image-turn]',e.code || e.name) }
}
export async function retryIllustration(userId, { id, sceneId }) {
  if (!config.dialogueComicEnabled) throw conflict('情境分镜已暂停生成。')
  if (!id) {
    const scene = await ownedScene(userId,sceneId)
    await reservePanel(userId,scene,null,0,openingPanel(scene),{retry:true})
  } else {
    const row = await queryOne(`SELECT ${publicColumns} FROM dialogue_illustrations WHERE id=? AND user_id=?`, [id,userId])
    if (!row) throw notFound('这张情境图片不存在。')
    const scene = await ownedScene(userId,row.scene_id)
    await reservePanel(userId,scene,row.session_id,Number(row.turn_number),{topicKey:row.topic_key,caption:row.caption,description:row.description},{retry:true})
  }
  return { accepted: true }
}
