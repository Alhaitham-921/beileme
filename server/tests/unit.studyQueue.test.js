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

test('review-only ignores frozen targets and completed plan counts, fetching ten live due words', async () => {
 for (const reviewDone of [0, 10, 23]) {
  const limits = []
  const items = await selectDailyWords({
   plan: { ...plan, reviewTarget: 10, reviewDone }, studyMode: 'review-only',
   listDue: limit => { limits.push(limit); return Array.from({ length: limit }, (_, id) => ({ id })) },
   listFresh: () => assert.fail('review-only must not fetch new words'),
  })
  assert.deepEqual(limits, [10])
  assert.equal(items.length, 10)
  assert.ok(items.every(item => item.kind === 'review'))
 }
})

test('review-only honors a smaller cap and never fills a short or empty due list with fresh words', async () => {
 for (const available of [0, 2, 23]) {
  const items = await selectDailyWords({
   plan, studyMode: 'review-only', maxSize: 5,
   listDue: limit => { assert.equal(limit, 5); return Array.from({ length: Math.min(available, limit) }, (_, id) => ({ id })) },
   listFresh: () => assert.fail('must not fill from new words'),
  })
  assert.equal(items.length, Math.min(available, 5))
 }
 const empty = await selectDailyWords({ plan, studyMode: 'review-only', maxSize: 0,
  listDue: () => assert.fail('zero cap must not query due words'),
  listFresh: () => assert.fail('must not query new words'),
 })
 assert.deepEqual(empty, [])
})

test('review-only continuation re-reads the live head without an offset', async () => {
 let due = Array.from({ length: 23 }, (_, id) => ({ id }))
 const seen = []
 const sizes = []
 for (let round = 0; round < 4; round += 1) {
  const items = await selectDailyWords({ plan, studyMode: 'review-only',
   listDue: (...args) => { assert.deepEqual(args, [10]); return due.slice(0, args[0]) },
   listFresh: () => assert.fail('must not query new words'),
  })
  sizes.push(items.length)
  seen.push(...items.map(item => item.row.id))
  due = due.filter(row => !items.some(item => item.row.id === row.id))
 }
 assert.deepEqual(sizes, [10, 10, 3, 0])
 assert.deepEqual(seen, Array.from({ length: 23 }, (_, id) => id))
})

test('daily new-only still stops at its plan target', async () => {
 const items = await selectDailyWords({ plan: { ...plan, newDone: plan.newTarget }, studyMode: 'new-only',
  listDue: () => assert.fail('must not fetch reviews'),
  listFresh: limit => { assert.equal(limit, 0); return [] },
 })
 assert.deepEqual(items, [])
})
test('normal correct recalls can reach mastered without fast responses',()=>{
 let p={};for(let i=0;i<8;i++)p=reviewItem(p,grade(12000,true))
 assert.equal(p.state,'mastered')
 const base={repetitions:6,ef:2.5,timesSeen:6,timesCorrect:6,lastResult:1}
 assert.equal(computeMemoryStrength({...base,lastHesitationMs:1000}),computeMemoryStrength({...base,lastHesitationMs:12000}))
})
