import {query,queryOne,withTransaction} from '../db/pool.js'
import {badRequest} from '../utils/errors.js'

export function listUserReadingBooks(userId){
 return query(`SELECT id,title,author,source_format,chapter_count,text_bytes,created_at
   FROM library_user_books WHERE user_id=? ORDER BY created_at DESC,id DESC`,[userId])
}
export function findUserReadingBook(userId,id){
 return queryOne('SELECT document FROM library_user_books WHERE id=? AND user_id=?',[id,userId])
}
export function insertUserReadingBook(userId,book,format,textBytes){
 return withTransaction(async conn=>{
  // Serialize only this account's imports; retries of the same file return its existing book.
  await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId])
  const [[existing]]=await conn.execute('SELECT id FROM library_user_books WHERE user_id=? AND source_sha256=?',[userId,book.sourceSha256])
  if(existing)return {id:existing.id,existing:true}
  const [[usage]]=await conn.execute('SELECT COUNT(*) n,COALESCE(SUM(text_bytes),0) bytes FROM library_user_books WHERE user_id=?',[userId])
  if(Number(usage.n)>=20||Number(usage.bytes)+textBytes>20*1024*1024)throw badRequest('个人书架最多 20 本、合计 20 MB 文字，请先移除不需要的个人书籍')
  await conn.execute(`INSERT INTO library_user_books(id,user_id,title,author,source_sha256,source_format,chapter_count,text_bytes,document)
    VALUES (?,?,?,?,?,?,?,?,?)`,[book.id,userId,book.title,book.author,book.sourceSha256,format,book.chapters.length,textBytes,JSON.stringify(book)])
  return {id:book.id,existing:false}
 })
}
export function deleteUserReadingBook(userId,id){
 return withTransaction(async conn=>{
  const [result]=await conn.execute('DELETE FROM library_user_books WHERE id=? AND user_id=?',[id,userId])
  if(!result.affectedRows)return false
  await conn.execute("DELETE FROM library_progress WHERE user_id=? AND kind='reading' AND content_id=?",[userId,id])
  await conn.execute('DELETE FROM library_chinese_companions WHERE user_id=? AND book_id=?',[userId,id])
  return true
 })
}
