import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import mysql from 'mysql2/promise'
import { config } from '../server/src/config.js'

const database = process.argv.find(a => a.startsWith('--database='))?.slice(11)
if (!database || !/^[a-zA-Z0-9_]{1,64}$/.test(database)) throw new Error('Provide an explicit --database=name')
const directory = path.resolve('server/backups')
await fs.mkdir(directory, { recursive: true })
const file = path.join(directory, `${database}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)
const connection = await mysql.createConnection({ ...config.db, database: undefined, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
try {
  const [databases] = await connection.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])
  if (!databases.length) {
    const manifest = `${file}.absent.json`
    await fs.writeFile(manifest, JSON.stringify({ database, existed: false, timestamp: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ database, existed: false, manifest }))
  } else {
    await connection.query(`USE \`${database}\``)
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    const [tables] = await connection.query("SHOW FULL TABLES WHERE Table_type='BASE TABLE'")
    const manifest = { database, existed: true, tables: [], timestamp: new Date().toISOString() }
    const lines = ['-- Local backup. Restore into an EMPTY database; no DROP statements are included.', 'SET NAMES utf8mb4;', "SET time_zone='+00:00';", 'SET FOREIGN_KEY_CHECKS=0;']
    for (const row of tables) {
      const name = Object.values(row)[0]
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Unsupported table identifier')
      const [ddl] = await connection.query(`SHOW CREATE TABLE \`${name}\``)
      lines.push(`${ddl[0]['Create Table']};`)
      const [rows] = await connection.query(`SELECT * FROM \`${name}\``)
      for (const record of rows) {
        const columns = Object.keys(record).map(c => `\`${c.replaceAll('`', '``')}\``).join(',')
        const values = Object.values(record).map(v => mysql.escape(typeof v === 'object' && v !== null && !Buffer.isBuffer(v) && !(v instanceof Date) ? JSON.stringify(v) : v, false, 'Z')).join(',')
        lines.push(`INSERT INTO \`${name}\` (${columns}) VALUES (${values});`)
      }
      manifest.tables.push({ name, rows: rows.length })
    }
    lines.push('SET FOREIGN_KEY_CHECKS=1;')
    await connection.commit()
    const body = lines.join('\n') + '\n'
    await fs.writeFile(file, body, { flag: 'wx', mode: 0o600 })
    manifest.sha256 = crypto.createHash('sha256').update(body).digest('hex')
    manifest.bytes = Buffer.byteLength(body)
    await fs.writeFile(`${file}.manifest.json`, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ file, bytes: manifest.bytes, sha256: manifest.sha256, tables: manifest.tables.length, rows: manifest.tables.reduce((n,t)=>n+t.rows,0) }))
  }
} finally { await connection.end() }
