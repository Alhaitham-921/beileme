import test from 'node:test'
import assert from 'node:assert/strict'
import { actorMessages } from '../../src/utils/actorConversation.js'
import { buildTurnMessages } from '../src/services/dialogueEngine.js'
import { buildHelpMessages } from '../src/services/dialogueHelpEngine.js'

test('each actor sees only their own conversation in replies, references and the chat view', () => {
  const session = {
    scene: { role:'同学', actors:[{id:'alex',name:'Alex'},{id:'sam',name:'Sam'}], targets:[] },
    journey:{activeActorId:'sam',goals:[]}, messages:[
      {role:'assistant',text:'Legacy opening'},
      {role:'user',recipientId:'alex',text:'Private question for Alex'},
      {role:'assistant',actorId:'alex',text:'Alex private reply'},
      {role:'assistant',actorId:'sam',text:'Sam opening'},
      {role:'user',recipientId:'sam',text:'Question for Sam'},
      {role:'assistant',actorId:'sam',text:'Sam reply'},
    ],
  }
  assert.deepEqual(actorMessages(session).map(m=>m.text),['Sam opening','Question for Sam','Sam reply'])
  assert.equal(actorMessages(session,'alex').length,3)
  for (const prompt of [buildTurnMessages(session,'Next question'),buildHelpMessages(session,{useMemoryWord:false})]) {
    assert.doesNotMatch(prompt[1].content,/Private question|Alex private|Legacy opening/)
    assert.match(prompt[1].content,/Sam reply/)
  }
  assert.match(buildTurnMessages(session,'Next question')[0].content,/禁止分饰多人/)
  assert.deepEqual(actorMessages({messages:session.messages}),session.messages)
})
