import { randomUUID } from 'node:crypto'
import { execute, queryOne, withTransaction } from '../db/pool.js'
import { badRequest, notFound } from '../utils/errors.js'

export function parseWordbook(text) {
  const entries = new Map()
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    const fields = line.split('\t').map(field => field.trim())
    const [spelling, definition] = fields
    if (fields.length !== 2 || !/^[a-z]+(?:[ '\-][a-z]+)*$/i.test(spelling) || spelling.length > 64 || !definition || definition.length > 500) {
      throw badRequest(`第 ${index + 1} 行格式有误，请填写英文单词和释义，中间用 Tab 分隔`)
    }
    const key = spelling.toLowerCase()
    if (!entries.has(key)) entries.set(key, { spelling, definitions: new Set() })
    entries.get(key).definitions.add(definition)
    if (entries.size > 5000 || entries.get(key).definitions.size > 20) {
      throw badRequest('每本词书最多 5000 个单词，每个单词最多 20 条释义')
    }
  }
  if (!entries.size) throw badRequest('词书中没有可导入的单词')
  return entries
}

export async function importWordbook(userId, { name, text }) {
  const entries = parseWordbook(text)
  return withTransaction(async conn => {
    const [book] = await conn.execute(
      "INSERT INTO wordbooks (code, name, scope, is_builtin, word_count, owner_user_id) VALUES (?, ?, '自定义', 0, ?, ?)",
      [`user-${randomUUID()}`, name, entries.size, userId]
    )
    const rows = [...entries].map(([key, { spelling, definitions }]) =>
      [book.insertId, spelling, key, JSON.stringify([...definitions]), '[]'])
    for (let offset = 0; offset < rows.length; offset += 250) {
      await conn.query(
        'INSERT INTO words (wordbook_id, spelling, spelling_norm, definitions, examples) VALUES ?',
        [rows.slice(offset, offset + 250)]
      )
    }
    return { id: Number(book.insertId), name, wordCount: entries.size }
  })
}

export async function selectWordbook(userId, wordbookId) {
  const book = await queryOne(
    'SELECT id FROM wordbooks WHERE id=? AND word_count>0 AND (owner_user_id IS NULL OR owner_user_id=?)',
    [wordbookId, userId]
  )
  if (!book) throw notFound('词书不存在或没有可学习的单词')
  await execute('UPDATE user_profiles SET wordbook_id=? WHERE user_id=?', [wordbookId, userId])
}
