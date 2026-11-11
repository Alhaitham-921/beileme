import test from 'node:test'
import assert from 'node:assert/strict'
import { gradeQuestion, validateAnswers, validatePaper, publicPaper, objectiveReport, deadlinePassed, validateFeedback } from '../src/services/ielts/engine.js'
import { seedPapers, vocabularyCards } from '../data/ielts/catalog.js'
import { publicAddress, validatePublicUrl } from '../src/services/platform/security.js'
import { vocabularyQuestion } from '../src/services/ielts/vocabulary.js'

test('all original draft papers have valid question ids, evidence and 40 objective questions',()=>{
  for(const paper of seedPapers){assert.equal(validatePaper(paper),paper);if(paper.code.startsWith('academic-')&&['reading','listening'].includes(paper.skill))assert.equal(paper.questions.length,40)}
})
test('answers and explanations are not sent before submission; listening transcript is withheld',()=>{
  const p=seedPapers.find(p=>p.skill==='listening')
  const safe=publicPaper(p,{mode:'mock'})
  for(const q of safe.questions){assert.equal(q.answer,undefined);assert.equal(q.explanation,undefined);assert.equal(q.evidence,undefined)}
  for(const s of safe.sections)assert.equal(s.text,undefined)
  assert.equal(publicPaper(p,{reveal:true}).questions[0].answer[0],p.questions[0].answer[0])
})
test('strict marking supports alternatives, exact sets, whitespace, spelling and word limits',()=>{
  assert.equal(gradeQuestion({type:'completion',answer:['colour','color'],maxWords:1},' COLOR '),true)
  assert.equal(gradeQuestion({type:'completion',answer:'public transport',maxWords:1},'public transport'),false)
  assert.equal(gradeQuestion({type:'completion',answer:'library'},'libary'),false)
  assert.equal(gradeQuestion({type:'multiple',answer:['A','C']},['C','A']),true)
  assert.equal(gradeQuestion({type:'multiple',answer:['A','C']},['A','B','C']),false)
  assert.equal(gradeQuestion({type:'true_false',answer:'NOT GIVEN'},'FALSE'),false)
  assert.equal(gradeQuestion({type:'essay'},'a draft'),null)
})
test('server marking ignores forged isCorrect and rejects answers for foreign questions',()=>{
  const p=seedPapers.find(p=>p.skill==='reading')
  const r=objectiveReport(p,{q1:'wrong',isCorrect:true})
  assert.equal(r.questions[0].correct,false);assert.equal(r.band,null)
  assert.throws(()=>validateAnswers(p,{alien:'answer'}),/不属于/)
  assert.throws(()=>validateAnswers(p,{q1:{isCorrect:true}}),/类型/)
})
test('mock deadlines expire using server time; training has no hidden deadline',()=>{
  assert.ok(deadlinePassed({mode:'mock',deadline_at:new Date(1000)},1001))
  assert.equal(deadlinePassed({mode:'practice',deadline_at:new Date(1000)},1001),false)
})
test('feedback rejects invented quotes, omits unsupported pronunciation and speaking bands',()=>{
  const p=seedPapers.find(p=>p.skill==='speaking'),answers={p1a:'I usually take the bus to work.'}
  const raw={summary:'练习反馈',criteria:['coherence','lexical','grammar'].map(key=>({key,feedback:'可继续展开观点',band:9,evidence:[{questionId:'p1a',quote:'take the bus'}]})),corrections:[],pronunciation:9,overallBand:9}
  const result=validateFeedback(raw,p,answers)
  assert.equal(result.pronunciation.state,'not_assessed');assert.equal(result.overallBand,null);assert.ok(result.criteria.every(c=>c.band===null))
  assert.throws(()=>validateFeedback({...raw,corrections:[{questionId:'p1a',quote:'invented text',replacement:'fix',explanation:'bad'}]},p,answers),/依据/)
})
test('public provider URLs reject private IPv4, mapped IPv6, metadata, credentials and redirects at transport',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false,ip)
  assert.equal(publicAddress('8.8.8.8'),true)
  await assert.rejects(validatePublicUrl('http://example.com'),/HTTPS/)
  await assert.rejects(validatePublicUrl('https://key:secret@example.com'),/HTTPS/)
  await assert.rejects(validatePublicUrl('https://example.com',async()=>[{address:'127.0.0.1',family:4}]),/内网/)
})
test('listening/spelling prompts do not leak their expected word',()=>{
  for(const card of vocabularyCards){assert.equal(JSON.stringify(vocabularyQuestion(card,'listening')).includes(card.word),false);assert.equal(vocabularyQuestion(card,'spelling').answer,undefined)}
})
