import { query, queryOne, execute } from '../db/pool.js'
import { notFound, conflict } from '../utils/errors.js'
import { getWordById, mapWordRow } from './wordService.js'

// The existing favorites table is the default notebook (id 0), preserving all saved words.
export async function listNotebooks(userId, wordId = 0) {
  const defaults = await queryOne('SELECT COUNT(*) AS wordCount, COALESCE(MAX(word_id=?),0) AS containsWord FROM user_favorite_words WHERE user_id=?', [wordId, userId])
  const books = await query(`SELECT b.id,b.name,COUNT(w.word_id) AS wordCount,COALESCE(MAX(w.word_id=?),0) AS containsWord
    FROM user_notebooks b LEFT JOIN user_notebook_words w ON w.notebook_id=b.id
    WHERE b.user_id=? GROUP BY b.id,b.name ORDER BY b.created_at,b.id`, [wordId, userId])
  return [{ id: 0, name: '默认单词本', isDefault: true, ...defaults }, ...books].map(b => ({ ...b, containsWord: Boolean(b.containsWord) }))
}

export async function requireNotebook(userId, id) {
  if (id === 0) return { id: 0, name: '默认单词本' }
  const book = await queryOne('SELECT id,name FROM user_notebooks WHERE id=? AND user_id=?', [id, userId])
  if (!book) throw notFound('单词本不存在')
  return book
}

export async function createNotebook(userId, name) {
  if (name === '默认单词本') throw conflict('请使用其他单词本名称')
  try {
    const result = await execute('INSERT INTO user_notebooks (user_id,name) VALUES (?,?)', [userId, name])
    return { id: result.insertId, name, wordCount: 0, containsWord: false }
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw conflict('已经有同名的单词本了')
    throw error
  }
}

export async function notebookWords(userId, notebookId) {
  await requireNotebook(userId, notebookId)
  const rows = notebookId === 0
    ? await query('SELECT w.* FROM user_favorite_words f JOIN words w ON w.id=f.word_id WHERE f.user_id=? ORDER BY f.created_at DESC,f.word_id DESC', [userId])
    : await query('SELECT w.* FROM user_notebook_words f JOIN words w ON w.id=f.word_id WHERE f.notebook_id=? ORDER BY f.created_at DESC,f.word_id DESC', [notebookId])
  return rows.map(mapWordRow)
}

export async function allFavorites(userId) {
  const rows = await query(`SELECT w.* FROM words w JOIN (
    SELECT word_id,created_at FROM user_favorite_words WHERE user_id=?
    UNION ALL SELECT f.word_id,f.created_at FROM user_notebook_words f JOIN user_notebooks b ON b.id=f.notebook_id WHERE b.user_id=?
  ) f ON f.word_id=w.id GROUP BY w.id ORDER BY MAX(f.created_at) DESC,w.id DESC`, [userId, userId])
  return rows.map(mapWordRow)
}

export async function setNotebookWord(userId, notebookId, wordId, saved) {
  await requireNotebook(userId, notebookId)
  if (saved) await getWordById(wordId)
  if (notebookId === 0) {
    await execute(saved ? 'INSERT IGNORE INTO user_favorite_words (user_id,word_id) VALUES (?,?)' : 'DELETE FROM user_favorite_words WHERE user_id=? AND word_id=?', [userId, wordId])
  } else {
    await execute(saved ? 'INSERT IGNORE INTO user_notebook_words (notebook_id,word_id) VALUES (?,?)' : 'DELETE FROM user_notebook_words WHERE notebook_id=? AND word_id=?', [notebookId, wordId])
  }
}
