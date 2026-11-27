import {queryOne,execute,withTransaction} from '../db/pool.js'
import {badRequest,notFound} from '../utils/errors.js'
import {parseJson} from '../utils/json.js'
export const findCompanion=(userId,id)=>queryOne('SELECT * FROM library_chinese_companions WHERE user_id=? AND book_id=?',[userId,id])
export function saveCompanion(userId,id,book){return withTransaction(async conn=>{
 await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId])
 const [[existing]]=await conn.execute('SELECT text_bytes,source_sha256,mappings FROM library_chinese_companions WHERE user_id=? AND book_id=?',[userId,id])
 const [[usage]]=await conn.execute('SELECT COUNT(*) n,COALESCE(SUM(text_bytes),0) bytes FROM library_chinese_companions WHERE user_id=?',[userId])
 if((!existing&&Number(usage.n)>=40)||Number(usage.bytes)-Number(existing?.text_bytes||0)+book.textBytes>40*1024*1024)throw badRequest('中文对照最多 40 本、合计 40 MB 文字，请先移除不需要的对照')
 const mappings=existing?.source_sha256===book.sourceSha256?parseJson(existing.mappings,{}):{}
 await conn.execute(`INSERT INTO library_chinese_companions(user_id,book_id,title,author,text_bytes,source_sha256,document,mappings) VALUES (?,?,?,?,?,?,?,?)
  ON DUPLICATE KEY UPDATE title=VALUES(title),author=VALUES(author),text_bytes=VALUES(text_bytes),source_sha256=VALUES(source_sha256),document=VALUES(document),mappings=VALUES(mappings),updated_at=UTC_TIMESTAMP(3)`,
 [userId,id,book.title,book.author,book.textBytes,book.sourceSha256,JSON.stringify({chapters:book.chapters}),JSON.stringify(mappings)])
})}
export function mapCompanion(userId,id,englishChapter,chineseChapter){return withTransaction(async conn=>{
 const [[row]]=await conn.execute('SELECT document,mappings FROM library_chinese_companions WHERE user_id=? AND book_id=? FOR UPDATE',[userId,id])
 if(!row)throw notFound('请先导入中文对照')
 const book=parseJson(row.document,{})
 if(!book.chapters?.some(c=>c.id===chineseChapter))throw badRequest('中文章节不存在')
 const mappings=parseJson(row.mappings,{});mappings[englishChapter]=chineseChapter
 await conn.execute('UPDATE library_chinese_companions SET mappings=?,updated_at=UTC_TIMESTAMP(3) WHERE user_id=? AND book_id=?',[JSON.stringify(mappings),userId,id])
})}
export const removeCompanion=(userId,id)=>execute('DELETE FROM library_chinese_companions WHERE user_id=? AND book_id=?',[userId,id])
