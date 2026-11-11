import { DefaultScheduler, Rating } from 'ts-fsrs'
import { vocabularyCards } from '../../../data/ielts/catalog.js'
import { queryOne, withTransaction } from '../../db/pool.js'
import { badRequest } from '../../utils/errors.js'
import { normalizeAnswer } from './engine.js'
import { parseJson } from '../../utils/json.js'

export const ABILITIES = ['recognition','listening','spelling','collocation','paraphrase']
const scheduler = DefaultScheduler({ config: { desiredRetention: 0.9, enableFuzz: false } })

export function vocabularyQuestion(card, ability) {
  if(!ABILITIES.includes(ability))throw badRequest('训练能力不正确')
  const base={id:card.id,ability,source:card.source}
  if(ability==='recognition')return {...base,prompt:card.word,options:vocabularyCards.slice(0,6).concat(card).filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i).map(v=>({value:v.meaning,label:v.meaning}))}
  if(ability==='listening')return {...base,prompt:'听录音，写出单词',audioPath:`/ielts/vocabulary/${card.id}/audio`}
  if(ability==='spelling')return {...base,prompt:`根据中文写出单词：${card.meaning}`}
  if(ability==='collocation')return {...base,prompt:card.collocation.replace(new RegExp(card.word,'i'),'____'),hint:card.meaning}
  return {...base,prompt:`选择在当前表达中接近 ${card.word} 的词`,context:card.example,options:[card.synonym,...vocabularyCards.filter(v=>v.id!==card.id).slice(0,3).map(v=>v.synonym)].sort().map(v=>({value:v,label:v}))}
}

export async function vocabularyAnswer(userId,{cardId,ability,answer,requestKey,recall='normal'}) {
  const card=vocabularyCards.find(c=>c.id===cardId)
  if(!card||!ABILITIES.includes(ability)||typeof answer!=='string'||answer.length>200||!/^[\w-]{8,100}$/.test(requestKey||''))throw badRequest('词汇作答不正确')
  const expected=ability==='recognition'?card.meaning:ability==='paraphrase'?card.synonym:card.word
  const correct=normalizeAnswer(answer)===normalizeAnswer(expected)
  return withTransaction(async conn=>{
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId])
    const sourceKey=`vocabulary:${requestKey}`
    const [prior]=await conn.execute('SELECT evidence FROM learning_evidence WHERE user_id=? AND source_key=?',[userId,sourceKey])
    if(prior.length){const previous=parseJson(prior[0].evidence,{});if(previous.cardId!==cardId||previous.ability!==ability)throw badRequest('该请求编号已用于其他单词');return previous}
    const [history]=await conn.execute("SELECT evidence FROM learning_evidence WHERE user_id=? AND skill='vocabulary' AND ability=? AND JSON_UNQUOTE(JSON_EXTRACT(evidence,'$.cardId'))=? ORDER BY id DESC LIMIT 1",[userId,ability,cardId])
    const previous=parseJson(history[0]?.evidence,{})
    const engine=await scheduler
    const now=new Date()
    const state=previous.shadow?.card||engine.newCard({now})
    for(const field of ['due','dueAt','last_review','lastReview','lastReviewAt','createdAt','lastReviewedAt'])if(typeof state[field]==='string')state[field]=new Date(state[field])
    // Shadow scheduling only: never updates the existing SM-2 next_review_at.
    const shadow=engine.review({card:state,grade:correct?(recall==='hard'?Rating.Hard:Rating.Good):Rating.Again,now})
    const evidence={cardId,ability,answer,correct,expected,card,shadow:{card:shadow.card,revlog:shadow.revlog,engine:'fsrs-shadow-v1'},at:now.toISOString()}
    await conn.execute("INSERT INTO learning_evidence(user_id,source_key,skill,ability,correct,evidence) VALUES(?,?,'vocabulary',?,?,?)",[userId,sourceKey,ability,correct?1:0,JSON.stringify(evidence)])
    if(!correct)await conn.execute('INSERT IGNORE INTO learning_suggestions(user_id,source_key,spelling,note) VALUES(?,?,?,?)',[userId,sourceKey,card.word,`${ability} 训练中答错，正确答案：${expected}`])
    return evidence
  })
}
