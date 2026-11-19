import test from 'node:test'
import assert from 'node:assert/strict'
import { visualUpdate,canAddPanel,COMIC_STYLE,castFor } from '../src/services/dialogueIllustrationEngine.js'
import { buildTurnMessages } from '../src/services/dialogueEngine.js'
const update={changed:true,topicKey:'hotel-room',description:'The same hotel guest enters a quiet room carrying a suitcase.',caption:'来到房间'}
test('optional visual metadata fails closed without inventing a new frame',()=>{
  assert.equal(visualUpdate(null),null)
  assert.equal(visualUpdate({...update,description:'x'}),null)
  assert.equal(visualUpdate({...update,changed:false}),null)
  assert.deepEqual(visualUpdate(update),update)
  const context={enabled:true,count:1,lastTurn:0,topicKey:'opening'}
  assert.equal(canAddPanel(context,update,1),false)
  assert.equal(canAddPanel(context,update,2),true)
  assert.equal(canAddPanel({...context,enabled:false},update,2),false)
  assert.equal(canAddPanel({...context,count:6},update,20),false)
  assert.equal(canAddPanel({...context,topicKey:update.topicKey},update,2),false)
})
test('visual direction reuses cast and restrained colors without a fixed palette',()=>{
  assert.match(COMIC_STYLE,/no fixed palette/i)
  assert.doesNotMatch(COMIC_STYLE,/Morandi/i)
  assert.match(castFor({role:'酒店前台',userRole:'旅客',location:'酒店'}),/Keep the same/)
  const session={scene:{targets:[],task:'check in'},messages:[],illustrationContext:{enabled:true}}
  assert.match(buildTurnMessages(session,'Hello')[0].content,/visualUpdate/)
  session.illustrationContext.enabled=false
  assert.doesNotMatch(buildTurnMessages(session,'Hello')[0].content,/本轮已开启漫画式/)
})
