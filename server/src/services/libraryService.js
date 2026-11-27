import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { LISTENING_LESSONS, EXTERNAL_RESOURCES, findListeningLesson } from '../../data/listeningLessons.js'
import { findLibraryProgress,saveLibraryProgress,recordListeningAttempt } from '../repositories/libraryProgressRepository.js'
import { notFound, badRequest } from '../utils/errors.js'
import {listUserReadingBooks,findUserReadingBook} from '../repositories/userReadingBooksRepository.js'
import { parseJson } from '../utils/json.js'
import { loadLearningContext } from './learningContextService.js'
import { resolveWordbookForUser } from './wordService.js'

const location=new URL('../../data/library/',import.meta.url)
const audioLocation=new URL('../../data/listening-audio/',import.meta.url)
const audioManifest=JSON.parse(await readFile(new URL('manifest.json',audioLocation),'utf8'))
const audioCache=new Map()
const books=new Map()
let bookLoading
async function allBooks() {
  if(!bookLoading)bookLoading=(async()=>{
    const loaded=await Promise.all((await readdir(location)).filter(name=>/^[a-z-]+\.json$/.test(name)).map(async name=>JSON.parse(await readFile(new URL(name,location),'utf8'))))
    for(const book of loaded)books.set(book.id,book)
    return loaded
  })().catch(error=>{bookLoading=null;throw error})
  return bookLoading
}
async function bookFor(userId,id) {
  if(id.startsWith('personal-')){const row=await findUserReadingBook(userId,id);if(!row)throw notFound('这本书暂不可用');return parseJson(row.document,{})}
  await allBooks();const book=books.get(id);if(!book)throw notFound('这本书暂不可用');return book
}
export async function libraryOverview(userId) {
  const items=await allBooks(),personal=await listUserReadingBooks(userId)
  let learning=null
  const book=await resolveWordbookForUser(userId)
  if(book) {
    const until=new Date(),since=new Date(until.getTime()-30*86400000)
    learning=(await loadLearningContext({userId,bookId:book.id,since,until})).learning
  }
  return {books:items.map(({chapters,notice,...metadata})=>({...metadata,chapterCount:chapters.length})),
    personalBooks:personal.map(row=>({id:row.id,title:row.title,titleZh:'',author:row.author,chapterCount:Number(row.chapter_count),sourceFormat:row.source_format,sourceName:'个人导入',level:'仅自己可见',personal:true})),
    lessons:LISTENING_LESSONS.map(({transcript,questions,turns,...lesson})=>({...lesson,questionCount:questions.length,durationSeconds:audioManifest.lessons[lesson.id]?.durationSeconds||0,source:'平台原创 · Kokoro 合成朗读'})),
    resources:EXTERNAL_RESOURCES,learning}
}
export function listeningLesson(id) {
  const lesson=findListeningLesson(id)
  if(!lesson)throw notFound('听力材料不存在')
  return {...lesson,questions:lesson.questions.map(({answer,...q})=>q),source:'平台原创 · 合成朗读',
    audioRevision:audioManifest.lessons[id]?.audioSha256,durationSeconds:audioManifest.lessons[id]?.durationSeconds||0,baseRate:audioManifest.lessons[id]?.baseRate||audioManifest.baseRate}
}
export function listeningAudioMime(id){return audioManifest.lessons[id]?.mimeType||'audio/wav'}
export async function listeningAudio(id) {
  const lesson=findListeningLesson(id),asset=audioManifest.lessons[id]
  if(!lesson||!asset)throw notFound('听力音频不存在')
  if(createHash('sha256').update(lesson.transcript).digest('hex')!==asset.transcriptSha256)throw notFound('这段材料的音频正在更新，请稍后重试')
  if(!audioCache.has(id)) {
    const bytes=await readFile(new URL(asset.file,audioLocation))
    if(createHash('sha256').update(bytes).digest('hex')!==asset.audioSha256)throw notFound('音频文件需要重新校验，请稍后重试')
    audioCache.set(id,bytes)
  }
  return audioCache.get(id)
}
export async function checkListening(userId,id,{answers,transcriptShown}) {
  const lesson=findListeningLesson(id)
  if(!lesson)throw notFound('听力材料不存在')
  if(answers.length!==lesson.questions.length||answers.some((a,i)=>!Number.isInteger(a)||!lesson.questions[i].choices[a]))throw badRequest('请完成全部听力问题')
  const results=answers.map((answer,i)=>({correct:answer===lesson.questions[i].answer,answer:lesson.questions[i].choices[lesson.questions[i].answer]}))
  const progress={answers,results,transcriptShown,correct:results.filter(r=>r.correct).length,total:results.length}
  const attemptId=await recordListeningAttempt(userId,id,progress)
  return {...progress,attemptId}
}
export async function getReading(userId,id,chapterId) {
  const book=await bookFor(userId,id)
  const saved=await findLibraryProgress(userId,'reading',id)
  const progress=parseJson(saved?.position,{})
  const chosen=chapterId||progress.chapterId||book.chapters[0].id
  const chapter=book.chapters.find(c=>c.id===chosen)
  if(!chapter)throw notFound('章节不存在')
  const {chapters,notice,...metadata}=book
  return {book:metadata,chapters:chapters.map(({paragraphs,...c})=>c),chapter,progress}
}
export async function readingNotice(userId,id) {return (await bookFor(userId,id)).notice}
export async function saveReading(userId,id,{chapterId,paragraph,offset=0}) {
  const book=await bookFor(userId,id),chapter=book.chapters.find(c=>c.id===chapterId)
  if(!chapter||paragraph>=chapter.paragraphs.length||offset>chapter.paragraphs[paragraph].length)throw badRequest('阅读位置无效')
  await saveLibraryProgress(userId,'reading',id,{chapterId,paragraph,offset})
  return {saved:true}
}
