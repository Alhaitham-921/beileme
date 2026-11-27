import {getReading} from './libraryService.js'
import {parseImportedBook,decodeBookUpload} from './readingBookImportService.js'
import {findCompanion,saveCompanion,mapCompanion,removeCompanion} from '../repositories/readingCompanionRepository.js'
import {parseJson} from '../utils/json.js'
import {badRequest} from '../utils/errors.js'
const resources={
 alice:[{title:'大英图书馆：爱丽丝的中国之旅',type:'中文导读，非逐页译文',url:'https://www.britishlibrary.cn/zh-hk/articles/alice-in-china/'}],
 'christmas-carol':[{title:'大英图书馆：《圣诞颂歌》',type:'中文导读，非逐页译文',url:'https://www.britishlibrary.cn/zh-hk/works/a-christmas-carol/'}],
 'around-world':[{title:'南京图书馆藏《八十日環遊記》旧译扫描',type:'旧译卷册扫描，非当前页对照',url:'https://commons.wikimedia.org/wiki/File:NJlib-0028137-0001_%E5%85%AB%E5%8D%81%E6%97%A5%E7%92%B0%E9%81%8A%E8%A8%98%E5%9B%9B%E5%8D%B7.pdf'}],
}
export async function getReadingCompanion(userId,id,chapterId){
 const reading=await getReading(userId,id,chapterId),row=await findCompanion(userId,id)
 const backgroundResources=resources[id]||[]
 if(!row)return {available:false,backgroundResources}
 const document=parseJson(row.document,{}),selectedChapterId=parseJson(row.mappings,{})[reading.chapter.id]||''
 return {available:true,title:row.title,author:row.author,source:'个人导入，仅自己可见',backgroundResources,selectedChapterId,
  chapters:document.chapters.map(({id,title})=>({id,title})),chapter:document.chapters.find(c=>c.id===selectedChapterId)||null}
}
export async function importReadingCompanion(userId,id,{filename,contentBase64,title,author}){
 await getReading(userId,id)
 const parsed=parseImportedBook(filename,decodeBookUpload(contentBase64),{requireEnglish:false})
 if((parsed.chapters.flatMap(c=>c.paragraphs).join('').match(/\p{Script=Han}/gu)||[]).length<20)throw badRequest('未找到足够的中文，请导入中文译文或中文对照文本')
 await saveCompanion(userId,id,{...parsed,title:(title||parsed.title||filename.replace(/\.[^.]+$/,'')).slice(0,160),author:(author||parsed.author||'未填写译者').slice(0,120)})
 return {imported:true}
}
export async function mapReadingCompanion(userId,id,{englishChapterId,chineseChapterId}){
 await getReading(userId,id,englishChapterId);await mapCompanion(userId,id,englishChapterId,chineseChapterId)
 return getReadingCompanion(userId,id,englishChapterId)
}
export async function deleteReadingCompanion(userId,id){await getReading(userId,id);await removeCompanion(userId,id);return {removed:true}}
