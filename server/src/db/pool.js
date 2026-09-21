import mysql from 'mysql2/promise'
import { config } from '../config.js'

/**
 * 全局连接池。timezone 固定为 UTC，避免 JS Date 与 MySQL DATETIME 之间出现时区漂移；
 * multipleStatements 保持关闭，防止 SQL 注入被放大成多语句执行。
 */
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  timezone: 'Z',
  // DATE 列保持字符串形态（'YYYY-MM-DD'）：业务日期全程按字符串比较与拼装，
  // 一旦被膨胀成 JS Date，任何 String(date) 的拼接都会得到 "Mon Sep 21" 这类值。
  dateStrings: ['DATE'],
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: false,
})

/** 查询并返回行数组 */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params)
  return rows
}

/** 查询单行，无结果返回 null */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows.length ? rows[0] : null
}

/** 执行写入，返回 { insertId, affectedRows } */
export async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params)
  return result
}

/**
 * 在单个连接的事务中执行回调。
 * @template T
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (error) {
    try {
      await conn.rollback()
    } catch {
      // 回滚失败时保留原始错误，避免掩盖真正的原因
    }
    throw error
  } finally {
    conn.release()
  }
}

/** 关闭连接池（测试收尾 / 优雅退出用） */
export async function closePool() {
  await pool.end()
}

export default pool
