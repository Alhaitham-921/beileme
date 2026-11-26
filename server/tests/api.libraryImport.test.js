import test from 'node:test'
import assert from 'node:assert/strict'
import {zipSync,strToU8} from 'fflate'
import {getTestServer,createClient,createOnboardedUser} from './helpers/setup.js'
import {parseImportedBook} from '../src/services/readingBookImportService.js'
import {queryOne} from '../src/db/pool.js'

const sample='Chapter 1\nAlice meets a friend and asks about a new book.\n\nThey talk about reading in the garden.\nChapter 2\nThe friends return to the library and continue their conversation.'
const upload=(text=sample)=>({filename:'My English Book.txt',contentBase64:Buffer.from(text).toString('base64'),title:'My private book',author:'Example Author'})
function epub(overrides={}){
 const files={
  'mimetype':'application/epub+zip',
  'META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>',
  'OPS/content.opf':'<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>English Stories</dc:title><dc:creator>Sample Author</dc:creator></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
  'OPS/a.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>The second chapter</h1><p>Later they <em>visit</em> a library &amp; borrow a book.</p></body></html>',
  'OPS/b.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>The first chapter</h1><p>Alice says, “Hello, my friend.”</p><script>do not include executable text</script></body></html>',
  ...overrides,
 }
 return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)]))))
}

test('book parser preserves TXT chapters and EPUB spine order, inline words and plain-text boundaries',()=>{
 const text=parseImportedBook('BOOK.TXT',Buffer.from(sample))
 assert.deepEqual(parseImportedBook('utf16.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from(sample,'utf16le')])).chapters,text.chapters)
 assert.equal(text.chapters.length,2);assert.equal(text.chapters[0].paragraphs.length,2)
 const book=parseImportedBook('stories.epub',epub())
 assert.equal(book.title,'English Stories');assert.equal(book.author,'Sample Author')
 assert.equal(book.chapters[0].title,'The first chapter');assert.equal(book.chapters[1].title,'The second chapter')
 assert.ok(book.chapters[1].paragraphs.some(p=>p.includes('visit a library & borrow')))
 assert.ok(!JSON.stringify(book).includes('do not include executable text'))
 assert.equal(parseImportedBook('book.txt',Buffer.from(sample.replaceAll('\n','\r\n'))).sourceSha256,text.sourceSha256)
})

test('book parser rejects unsupported formats, damaged archives, encrypted text and oversized expansion',()=>{
 assert.throws(()=>parseImportedBook('book.pdf',Buffer.from(sample)),/TXT/)
 assert.throws(()=>parseImportedBook('book.epub',Buffer.from(sample)),/EPUB/)
 assert.throws(()=>parseImportedBook('book.txt',Buffer.alloc(8*1024*1024+1)),/8 MB/)
 assert.throws(()=>parseImportedBook('book.epub',epub({'META-INF/encryption.xml':'<encryption><EncryptedData><CipherData><CipherReference URI="OPS/a.xhtml"/></CipherData></EncryptedData></encryption>'})),/加密/)
 assert.throws(()=>parseImportedBook('book.epub',epub({'OPS/a.xhtml':'<html><body><p>'+'a'.repeat(4*1024*1024+1)+'</p></body></html>'})),/解压/)
 assert.throws(()=>parseImportedBook('book.epub',epub({'OPS/b.xhtml':'<!DOCTYPE html [<!ENTITY secret SYSTEM "file:///private">]><html><body><p>&secret;</p></body></html>'})),/实体/)
})

test('personal books are private across catalog, chapter, notice, progress, AI and deletion; duplicate imports preserve position',async()=>{
 const client=createClient((await getTestServer()).baseUrl),owner=await createOnboardedUser(client),peer=await createOnboardedUser(client),auth={token:owner.token},other={token:peer.token}
 const path='/api/v1/library/books/import'
 assert.equal((await client.post(path,{body:upload()})).status,401)
 const imported=await client.post(path,{...auth,body:upload()})
 assert.equal(imported.status,201,JSON.stringify(imported.raw));const id=imported.data.id,bookPath='/api/v1/library/books/'+id
 const book=(await client.get(bookPath,auth)).data
 assert.equal(book.book.title,'My private book');assert.equal(book.chapters.length,2)
 assert.equal((await client.put(bookPath+'/progress',{...auth,body:{chapterId:'2',paragraph:0,offset:8}})).status,200)
 const repeated=await client.post(path,{...auth,body:upload()})
 assert.equal(repeated.data.id,id);assert.equal(repeated.data.existing,true)
 assert.equal((await client.get(bookPath,auth)).data.progress.offset,8)
 assert.equal((await client.get('/api/v1/library',auth)).data.personalBooks.length,1)
 assert.equal((await client.get('/api/v1/library',other)).data.personalBooks.length,0)
 for(const suffix of ['', '/notice'])assert.equal((await client.get(bookPath+suffix,other)).status,404)
 assert.equal((await client.put(bookPath+'/progress',{...other,body:{chapterId:'1',paragraph:0}})).status,404)
 const range={startParagraph:0,startOffset:0,endParagraph:0,endOffset:30}
 assert.equal((await client.post(bookPath+'/explain-page',{...other,body:{chapterId:'1',range}})).status,404)
 assert.equal((await client.post(bookPath+'/analyse-selection',{...other,body:{chapterId:'1',range,text:'Alice meets'}})).status,404)
 assert.equal((await client.del(bookPath,other)).status,404)
 const notice=await client.get(bookPath+'/notice',auth);assert.equal(notice.status,200);assert.match(notice.data.notice,/当前账号/)
 assert.equal((await client.del('/api/v1/library/books/alice',auth)).status,404)
 assert.equal((await client.del(bookPath,auth)).status,200)
 assert.equal((await client.get(bookPath,auth)).status,404)
 assert.equal(Number((await queryOne('SELECT COUNT(*) n FROM library_progress WHERE user_id=? AND content_id=?',[owner.userId,id])).n),0)
 assert.ok(await queryOne('SELECT id FROM users WHERE id=?',[owner.userId]))
})

test('EPUB import retains metadata and canonical text; authenticated import supports books larger than the general JSON limit',async()=>{
 const client=createClient((await getTestServer()).baseUrl),owner=await createOnboardedUser(client),auth={token:owner.token}
 const path='/api/v1/library/books/import'
 const first=await client.post(path,{...auth,body:{filename:'stories.epub',contentBase64:epub().toString('base64')}})
 assert.equal(first.status,201,JSON.stringify(first.raw))
 const book=(await client.get('/api/v1/library/books/'+first.data.id,auth)).data
 assert.equal(book.book.title,'English Stories');assert.equal(book.chapter.title,'The first chapter')
 const large=upload(('A story about learning English with a friend.\n\n').repeat(19000))
 assert.ok(JSON.stringify(large).length>1024*1024)
 const uploaded=await client.post(path,{...auth,body:large})
 assert.equal(uploaded.status,201,JSON.stringify(uploaded.raw))
 assert.equal((await client.post(path,{...auth,body:{...upload(),contentBase64:'bad=bad='}})).status,400)
})
