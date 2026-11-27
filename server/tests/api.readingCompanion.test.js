import test from 'node:test'
import assert from 'node:assert/strict'
import {getTestServer,createClient,createOnboardedUser} from './helpers/setup.js'
import {queryOne} from '../src/db/pool.js'
const chinese='第一章\n爱丽丝坐在姐姐身边，觉得很无聊。她看了一眼姐姐手里的书，希望找到有趣的故事。\n\n她想知道没有图片和对话的书有什么用。\n第二章\n爱丽丝跟着兔子来到了陌生的地方，开始仔细观察周围的环境，并向遇到的朋友询问方向。'
const upload={filename:'Chinese.txt',contentBase64:Buffer.from(chinese).toString('base64'),title:'个人中文译本',author:'测试译者'}
test('Chinese companions work without any AI, require manual chapter matching and preserve matching on repeated import',async()=>{
 const client=createClient((await getTestServer()).baseUrl),owner=await createOnboardedUser(client),peer=await createOnboardedUser(client),auth={token:owner.token},path='/api/v1/library/books/alice/translation'
 assert.equal((await client.get(path)).status,401)
 const initial=(await client.get(path,auth)).data
 assert.equal(initial.available,false);assert.match(initial.backgroundResources[0].type,/非逐页/)
 assert.equal((await client.put(path,{...auth,body:upload})).status,200)
 const imported=(await client.get(path,{...auth})).data
 assert.equal(imported.available,true);assert.equal(imported.chapter,null);assert.equal(imported.selectedChapterId,'');assert.equal(imported.chapters.length,2)
 const mapped=await client.put(path+'/chapter',{...auth,body:{englishChapterId:'1',chineseChapterId:'2'}})
 assert.equal(mapped.status,200,JSON.stringify(mapped.raw));assert.equal(mapped.data.chapter.id,'2');assert.match(mapped.data.chapter.paragraphs[0],/爱丽丝/)
 assert.equal((await client.put(path,{...auth,body:upload})).status,200)
 assert.equal((await client.get(path,{...auth})).data.selectedChapterId,'2')
 assert.equal((await client.get(path,{token:peer.token})).data.available,false)
 assert.equal((await client.put(path+'/chapter',{...auth,body:{englishChapterId:'1',chineseChapterId:'99'}})).status,400)
 assert.equal((await client.post('/api/v1/library/books/import',{...auth,body:upload})).status,400)
 assert.equal(Number((await queryOne('SELECT COUNT(*) n FROM library_ai_explanations WHERE user_id=?',[owner.userId])).n),0)
 assert.equal((await client.del(path,auth)).status,200)
 assert.equal((await client.get(path,auth)).data.available,false)
})
test('private book companion permissions follow the original book and are cleaned only with the owner book',async()=>{
 const client=createClient((await getTestServer()).baseUrl),owner=await createOnboardedUser(client),peer=await createOnboardedUser(client),auth={token:owner.token},other={token:peer.token}
 const imported=await client.post('/api/v1/library/books/import',{...auth,body:{filename:'English.txt',contentBase64:Buffer.from('This is a sufficiently long private English story for a translation pairing test.').toString('base64')}})
 const id=imported.data.id,path='/api/v1/library/books/'+id
 assert.equal((await client.put(path+'/translation',{...auth,body:upload})).status,200)
 assert.equal((await client.get(path+'/translation',other)).status,404)
 assert.equal((await client.put(path+'/translation',{...other,body:upload})).status,404)
 assert.equal((await client.put(path+'/translation/chapter',{...other,body:{englishChapterId:'1',chineseChapterId:'1'}})).status,404)
 assert.equal((await client.del(path+'/translation',other)).status,404)
 assert.equal((await client.del(path,auth)).status,200)
 assert.equal(Number((await queryOne('SELECT COUNT(*) n FROM library_chinese_companions WHERE user_id=? AND book_id=?',[owner.userId,id])).n),0)
})
