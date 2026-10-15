import fs from 'node:fs/promises'
import { query, pool } from '../server/src/db/pool.js'
try {
 const rows = await query('SELECT spelling, definitions, wordbook_id FROM words')
 await fs.writeFile('third_party/morpholex/project-words.json', JSON.stringify(rows))
 console.log(`Exported ${rows.length} wordbook entries`)
} finally { await pool.end() }
