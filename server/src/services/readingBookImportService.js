import {createHash,randomUUID} from 'node:crypto'
import {unzipSync,strFromU8} from 'fflate'
import {SaxesParser} from 'saxes'
import {badRequest,notFound} from '../utils/errors.js'
import {insertUserReadingBook,deleteUserReadingBook} from '../repositories/userReadingBooksRepository.js'

const MAX_FILE=8*1024*1024,MAX_TEXT=2*1024*1024,MAX_XML=12*1024*1024
const clean=text=>String(text).replace(/\u0000/g,'').replace(/\r\n?/g,'\n').trim()
const squash=text=>clean(text).replace(/\s+/g,' ')
const descendants=(node,name)=>node.children.flatMap(c=>typeof c==='string'?[]:[...(c.name===name?[c]:[]),...descendants(c,name)])
const textOf=node=>typeof node==='string'?node:['script','style','iframe','object'].includes(node.name)?'':node.name==='br'?'\n':node.children.map(textOf).join('')
function xml(text){
 if(/<!ENTITY/i.test(text))throw badRequest('书籍包含不支持的 XML 实体声明，请转换为普通 EPUB 或 TXT')
 const root={name:'root',children:[]},stack=[root],parser=new SaxesParser({xmlns:true});let nodes=0
 parser.on('opentag',tag=>{
  if(++nodes>100000||stack.length>80)throw badRequest('书籍结构过于复杂，请转换为纯文本')
  const child={name:tag.local,attrs:Object.fromEntries(Object.values(tag.attributes).map(a=>[a.name,a.value])),children:[]}
  stack.at(-1).children.push(child);stack.push(child)
 })
 parser.on('closetag',()=>stack.pop())
 parser.on('text',value=>stack.at(-1).children.push(value))
 parser.on('cdata',value=>stack.at(-1).children.push(value))
 try{parser.write(text).close()}catch(e){if(e.status)throw e;throw badRequest('EPUB 的 XML 内容无效，请使用未加密的标准 EPUB 或 TXT')}
 return root
}
function archivePath(base,reference){
 let ref
 try{ref=decodeURIComponent(reference.split('#')[0])}catch{throw badRequest('EPUB 章节路径无效')}
 if(/^[a-z][a-z\d+.-]*:|^[/\\]|\\/i.test(ref))throw badRequest('EPUB 必须包含本地章节，不能使用外部网址')
 const parts=base.split('/').slice(0,-1)
 for(const part of ref.split('/')){if(part==='..'){if(!parts.length)throw badRequest('EPUB 章节路径越界');parts.pop()}else if(part&&part!=='.')parts.push(part)}
 return parts.join('/')
}
function epub(bytes){
 let files,total=0,count=0
 try{files=unzipSync(bytes,{filter:file=>{
  if(++count>3000)throw badRequest('EPUB 文件条目过多')
  if(!/\.(xml|opf|xhtml|html|htm)$/i.test(file.name))return false
  if(file.originalSize>4*1024*1024||(total+=file.originalSize)>MAX_XML)throw badRequest('EPUB 解压后的文字过大，请分卷导入')
  return true
 }})}catch(e){if(e.status)throw e;throw badRequest('无法读取 EPUB，请确认文件完整且没有加密')}
 const read=path=>{if(!files[path])throw badRequest('EPUB 缺少目录或章节文件');return xml(strFromU8(files[path]))}
 if(files['META-INF/encryption.xml']){
  const encrypted=descendants(read('META-INF/encryption.xml'),'EncryptedData')
  // Font obfuscation is common in valid EPUBs; only protected text prevents import.
  for(const item of encrypted)for(const ref of descendants(item,'CipherReference'))if(/\.(x?html?|opf|xml)(?:$|[?#])/i.test(ref.attrs.URI||''))throw badRequest('暂不支持带 DRM 或加密正文的 EPUB')
 }
 const container=read('META-INF/container.xml'),opf=descendants(container,'rootfile')[0]?.attrs['full-path']
 if(!opf)throw badRequest('EPUB 缺少阅读目录')
 const packagePath=archivePath('',opf),doc=read(packagePath)
 const items=new Map(descendants(doc,'item').map(item=>[item.attrs.id,item.attrs]))
 const chapters=[]
 for(const ref of descendants(doc,'itemref')){
  if(ref.attrs.linear==='no')continue
  const item=items.get(ref.attrs.idref)
  if(!item||!['application/xhtml+xml','text/html'].includes(item['media-type']))throw badRequest('EPUB 正文目录不完整或采用了不支持的格式')
  if((item.properties||'').split(/\s+/).includes('nav'))continue
  const chapter=read(archivePath(packagePath,item.href||'')),body=descendants(chapter,'body')[0]
  if(!body)throw badRequest('EPUB 章节缺少正文')
  const paragraphs=[],blocks=new Set(['p','h1','h2','h3','h4','h5','h6','li','blockquote','pre','figcaption'])
  function collect(node){
   if(typeof node==='string')return
   if(['script','style','iframe','object','nav'].includes(node.name))return
   if(blocks.has(node.name)){const text=squash(textOf(node));if(text)paragraphs.push(text)}
   else for(const child of node.children)collect(child)
  }
  collect(body)
  if(!paragraphs.length){const text=squash(textOf(body));if(text)paragraphs.push(text)}
  if(!paragraphs.length)continue
  const heading=['h1','h2','h3'].flatMap(tag=>descendants(body,tag))[0]
  chapters.push({id:String(chapters.length+1),title:heading?squash(textOf(heading)).slice(0,160):`第 ${chapters.length+1} 节`,paragraphs})
  if(chapters.length>999)throw badRequest('书籍章节超过 999 节，请分卷导入')
 }
 return {title:squash(textOf(descendants(doc,'title')[0]||'')),author:squash(textOf(descendants(doc,'creator')[0]||'')),chapters}
}
function txt(bytes){
 let text
 try{text=new TextDecoder(bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8',{fatal:true}).decode(bytes)}catch{try{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes)}catch{throw badRequest('TXT 编码无法识别，请另存为 UTF-8 后导入')}}
 text=clean(text)
 if(/[\u0001-\u0008\u000e-\u001f]/.test(text))throw badRequest('文件不是可阅读的 TXT 文本')
 const lines=text.split('\n'),chapters=[];let title='正文',part=[]
 const flush=()=>{const source=part.join('\n').trim();if(source){const paragraphs=source.split(/\n\s*\n/).map(p=>p.replace(/\n/g,' ').trim()).filter(Boolean);chapters.push({id:String(chapters.length+1),title,paragraphs})}part=[]}
 for(const line of lines){
  if(/^\s*(?:(?:chapter|book|part)\s+(?:\d+|[ivxlcdm]+)\b.*|第[一二三四五六七八九十百零\d]+[章节回部].*)\s*$/i.test(line)&&line.trim().length<=160){flush();title=line.trim()}
  else part.push(line)
 }
 flush()
 // A file without blank lines still gets sensible paragraph boundaries.
 for(const chapter of chapters)chapter.paragraphs=chapter.paragraphs.flatMap(p=>{
  const chunks=[];let rest=p
  while(rest.length>6000){let end=rest.lastIndexOf(' ',6000);if(end<1000)end=6000;chunks.push(rest.slice(0,end));rest=rest.slice(end).trimStart()}
  if(rest)chunks.push(rest);return chunks
 })
 return {title:'',author:'',chapters}
}
export function parseImportedBook(filename,bytes){
 if(!bytes.length||bytes.length>MAX_FILE)throw badRequest('书籍文件需为 8 MB 以内的 TXT 或 EPUB')
 const format=filename.toLowerCase().endsWith('.epub')?'epub':filename.toLowerCase().endsWith('.txt')?'txt':null
 if(!format)throw badRequest('目前支持 TXT 和未加密 EPUB；PDF、扫描件请先转换为文本')
 const parsed=format==='epub'?epub(bytes):txt(bytes)
 const text=parsed.chapters.flatMap(c=>c.paragraphs).join('\n\n'),textBytes=Buffer.byteLength(text,'utf8')
 if(!parsed.chapters.length||parsed.chapters.length>999||textBytes<20||textBytes>MAX_TEXT)throw badRequest('正文需为 20 字节至 2 MB、最多 999 节，请分卷导入较大的书籍')
 if((text.match(/[A-Za-z]/g)||[]).length<20)throw badRequest('未找到足够的英文正文，请确认导入的是英文书籍')
 return {...parsed,format,textBytes,sourceSha256:createHash('sha256').update(JSON.stringify(parsed.chapters)).digest('hex')}
}
export async function importReadingBook(userId,{filename,contentBase64,title,author}){
 if(contentBase64.length>Math.ceil(MAX_FILE/3)*4||/[^A-Za-z0-9+/=]/.test(contentBase64))throw badRequest('书籍文件编码无效或超过 8 MB')
 const bytes=Buffer.from(contentBase64,'base64')
 if(bytes.toString('base64')!==contentBase64)throw badRequest('书籍文件编码无效')
 const parsed=parseImportedBook(filename,bytes)
 const book={id:'personal-'+randomUUID(),title:squash(title||parsed.title||filename.replace(/\.[^.]+$/,'')).slice(0,160),author:squash(author||parsed.author||'未填写作者').slice(0,120),
  personal:true,titleZh:'',level:'个人书籍 · 原文阅读',sourceName:'个人导入',sourceFormat:parsed.format,
  sourceSha256:parsed.sourceSha256,licenseLabel:'个人导入，仅当前账号可见',notice:'个人导入的文本仅保存在当前账号。请导入你有权使用的书籍。AI 功能只在你主动开启或点击时将当前页或选句发送到你配置的文字接口。',chapters:parsed.chapters}
 return insertUserReadingBook(userId,book,parsed.format,parsed.textBytes)
}
export async function removeReadingBook(userId,id){
 if(!id.startsWith('personal-')||!await deleteUserReadingBook(userId,id))throw notFound('个人书籍不存在')
 return {removed:true}
}
