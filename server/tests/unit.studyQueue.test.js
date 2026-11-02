import test from 'node:test'
import assert from 'node:assert/strict'
import { selectDailyWords } from '../src/services/studyQueue.js'
import { computeMemoryStrength, reviewItem, grade } from '../src/services/srs.js'
const plan={reviewTarget:10,reviewDone:2,newTarget:5,newDone:1}
test('new-only skips review lookup and preserves new-word budget',async()=>{
 const items=await selectDailyWords({plan,studyMode:'new-only',listDue:()=>assert.fail('must not fetch review'),listFresh:n=>Array.from({length:n},(_,i)=>i)})
 assert.equal(items.length,4);assert.ok(items.every(i=>i.kind==='new'))
 assert.equal(plan.reviewDone,2)
})
test('review-first orders reviews before new words and caps session size',async()=>{
 const items=await selectDailyWords({plan,listDue:n=>Array(n).fill('old'),listFresh:n=>Array(n).fill('new'),maxSize:10})
 assert.equal(items.length,10);assert.deepEqual(items.map(i=>i.kind),[...Array(8).fill('review'),...Array(2).fill('new')])
})
test('normal correct recalls can reach mastered without fast responses',()=>{
 let p={};for(let i=0;i<8;i++)p=reviewItem(p,grade(12000,true))
 assert.equal(p.state,'mastered')
 const base={repetitions:6,ef:2.5,timesSeen:6,timesCorrect:6,lastResult:1}
 assert.equal(computeMemoryStrength({...base,lastHesitationMs:1000}),computeMemoryStrength({...base,lastHesitationMs:12000}))
})
