import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {LISTENING_LESSONS,findListeningLesson} from '../data/listeningLessons.js'

test('active listening curriculum has ten versioned complete scenes and six questions per scene',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../data/listening-audio/manifest.json',import.meta.url)))
 assert.equal(LISTENING_LESSONS.length,10)
 assert.ok(!LISTENING_LESSONS.some(l=>l.id==='clarification'||l.title.includes('没听懂时')))
 const ids=new Set()
 for(const lesson of LISTENING_LESSONS){
  assert.ok(!ids.has(lesson.id));ids.add(lesson.id)
  assert.match(lesson.id,/-v2$/);assert.equal(lesson.questions.length,6)
  assert.ok(lesson.turns.length>=8);assert.ok(lesson.transcript.split(/\s+/).length>=300)
  for(const question of lesson.questions){assert.doesNotMatch(question.question,/\p{Script=Han}/u);for(const choice of question.choices)assert.doesNotMatch(choice,/\p{Script=Han}/u);assert.ok(question.choices[question.answer]);assert.equal(new Set(question.choices).size,question.choices.length)}
  const asset=manifest.lessons[lesson.id]
  assert.ok(asset.durationSeconds>=120&&asset.durationSeconds<=180,lesson.id)
  assert.equal(asset.mimeType,'audio/mpeg')
  assert.equal(asset.transcriptSha256,createHash('sha256').update(lesson.transcript).digest('hex'))
  const bytes=await readFile(new URL('../data/listening-audio/'+asset.file,import.meta.url))
  assert.equal(asset.audioSha256,createHash('sha256').update(bytes).digest('hex'))
 }
})
test('historical short material keeps its original two-question meaning after new curriculum release',()=>{
 const original=findListeningLesson('hotel-arrival'),oldClarification=findListeningLesson('clarification')
 assert.equal(original.questions.length,2);assert.equal(original.questions[1].choices[original.questions[1].answer],'十一点')
 assert.match(oldClarification.transcript,/second left/)
 assert.equal(findListeningLesson('missing'),undefined)
})
