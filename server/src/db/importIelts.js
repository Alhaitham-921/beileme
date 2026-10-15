import { pool, query, execute } from './pool.js'
import { importWordlists } from './importWordlists.js'
try {
  await importWordlists({ only: 'ielts' })
  const [book] = await query("SELECT id FROM wordbooks WHERE code = 'ielts'")
  await execute("UPDATE user_profiles SET wordbook_id = ? WHERE goal = '雅思'", [book.id])
} finally { await pool.end() }
