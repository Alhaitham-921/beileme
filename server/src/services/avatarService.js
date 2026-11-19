import sharp from 'sharp'
import { randomBytes } from 'node:crypto'
import { queryOne, withTransaction } from '../db/pool.js'
import { badRequest, notFound } from '../utils/errors.js'

export const avatarUrl = (userId, revision) => revision ? `/profile/avatars/${userId}/${revision}` : null

export async function saveAvatar(userId, encoded) {
  if (typeof encoded !== 'string' || encoded.length > 700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw badRequest('请上传 JPG、PNG 或 WebP 图片，处理后大小需小于 512 KB。')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.length > 512 * 1024) throw badRequest('头像图片过大，请换一张。')
  let image
  try {
    const input = sharp(bytes, { limitInputPixels: 20_000_000, animated: false })
    const metadata = await input.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported image')
    // Re-encode, orient and crop on the server too; strip metadata and active content.
    image = await input.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer()
  } catch { throw badRequest('无法读取这张图片，请选择有效的 JPG、PNG 或 WebP 图片。') }
  const revision = randomBytes(16).toString('hex')
  await withTransaction(async conn => {
    await conn.execute('INSERT INTO user_avatars (user_id,image_data) VALUES (?,?) ON DUPLICATE KEY UPDATE image_data=VALUES(image_data)', [userId, image])
    await conn.execute('UPDATE users SET avatar_revision=? WHERE id=?', [revision, userId])
  })
  return { avatarUrl: avatarUrl(userId, revision) }
}

export async function removeAvatar(userId) {
  await withTransaction(async conn => {
    await conn.execute('DELETE FROM user_avatars WHERE user_id=?', [userId])
    await conn.execute('UPDATE users SET avatar_revision=NULL WHERE id=?', [userId])
  })
  return { avatarUrl: null }
}

export async function readAvatar(userId, revision) {
  const row = await queryOne(`SELECT a.image_data FROM user_avatars a JOIN users u ON u.id=a.user_id
    WHERE a.user_id=? AND u.avatar_revision=? AND u.status='active'`, [userId, revision])
  if (!row) throw notFound('头像不存在或已更换')
  return row.image_data
}
