import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import { config, SERVER_ROOT } from '../config.js'

export const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'src', 'db', 'migrations')

/** 库名会拼进 DDL，必须先确认是安全标识符，避免环境变量被当作注入点 */
export function assertSafeIdentifier(name, label = 'database') {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(name)) {
    throw new Error(`${label} 名称不合法（只允许字母、数字、下划线）：${name}`)
  }
  return name
}

function baseConnectionOptions() {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
  }
}

/** 数据库不存在时自动创建，让首次启动无需手工建库 */
export async function ensureDatabase(database = config.db.database) {
  assertSafeIdentifier(database)
  const conn = await mysql.createConnection({ ...baseConnectionOptions(), multipleStatements: false })
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
  } finally {
    await conn.end()
  }
}

/** 删除并重建数据库，仅供自动化测试使用 */
export async function resetDatabase(database = config.db.database) {
  assertSafeIdentifier(database)
  const conn = await mysql.createConnection({ ...baseConnectionOptions(), multipleStatements: false })
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await conn.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
  } finally {
    await conn.end()
  }
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR)
  return entries.filter((name) => name.endsWith('.sql')).sort()
}

function checksumOf(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/**
 * 按文件名顺序执行未应用的迁移，已应用的记录校验和以发现被事后修改的迁移。
 * @returns {Promise<{ applied: string[], skipped: string[] }>}
 */
export async function runMigrations({ database = config.db.database, logger = console } = {}) {
  assertSafeIdentifier(database)
  await ensureDatabase(database)

  const conn = await mysql.createConnection({
    ...baseConnectionOptions(),
    database,
    // 迁移文件里一条语句一个分号，开启多语句让整个文件一次性执行
    multipleStatements: true,
  })

  const applied = []
  const skipped = []

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name       VARCHAR(190) NOT NULL,
        checksum   CHAR(64)     NOT NULL,
        applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_migration_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    const [records] = await conn.query('SELECT name, checksum FROM schema_migrations')
    const recorded = new Map(records.map((row) => [row.name, row.checksum]))

    for (const name of await listMigrationFiles()) {
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, name), 'utf8')
      const checksum = checksumOf(sql)
      const previous = recorded.get(name)

      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `迁移 ${name} 已执行过但内容被修改。已应用的迁移不可变，请新增一个迁移文件来变更表结构。`
          )
        }
        skipped.push(name)
        continue
      }

      await conn.query(sql)
      await conn.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [name, checksum])
      applied.push(name)
      logger.log(`[migrate] 已应用 ${name}`)
    }

    if (!applied.length) logger.log('[migrate] 数据库结构已是最新，无需迁移')
  } finally {
    await conn.end()
  }

  return { applied, skipped }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectRun) {
  runMigrations()
    .then(({ applied }) => {
      console.log(`[migrate] 完成，本次应用 ${applied.length} 个迁移`)
    })
    .catch((error) => {
      console.error('[migrate] 失败：', error.message)
      process.exitCode = 1
    })
}
