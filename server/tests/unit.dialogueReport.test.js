import test from 'node:test'
import assert from 'node:assert/strict'
import {sceneFor,validateReport} from '../src/services/dialogueEngine.js'
const scene=sceneFor('bank','beginner')
const fixture=()=>({scene,targetUsage:scene.targets.map(t=>({...t,status:'unused',helpLevel:0})),helpEvents:[],messages:[
 {role:'user',text:'Yesterday I go to the river bank.',corrections:[{type:'grammar',original:'go',replacement:'went',explanation:'用过去时',grammarTag:'tense'}]},
 {role:'user',text:'Last night I walk along the river.',corrections:[{type:'grammar',original:'walk',replacement:'walked',explanation:'用过去时',grammarTag:'tense'}]},
]})
const raw=()=>({summary:'已练习河边交流，接下来巩固过去时。',corrections:[],weakWords:[],reinforcement:[],grammarWeaknesses:[{type:'tense',description:'注意时态',count:2}]})
test('report accepts provider grammar objects and derives categories only from grounded corrections',()=>{
 const result=validateReport(raw(),fixture())
 assert.deepEqual(result.grammarWeaknesses,['时态'])
 assert.deepEqual(result.weakWords,[])
})
test('untrusted grammar metadata cannot create unsupported grammar weaknesses',()=>{
 const s=fixture();s.messages=s.messages.map(m=>({...m,corrections:[]}))
 assert.deepEqual(validateReport(raw(),s).grammarWeaknesses,[])
 for(const value of [undefined,null,'tense',Array(20).fill({type:'tense'})])assert.deepEqual(validateReport({...raw(),grammarWeaknesses:value},s).grammarWeaknesses,[])
})
test('normalizing the derived field does not loosen summary, quote, weak-word or exercise validation',()=>{
 assert.throws(()=>validateReport({},fixture()))
 assert.throws(()=>validateReport({...raw(),corrections:[{type:'grammar',original:'invented quote',replacement:'fixed',explanation:'fake'}]},fixture()),/原文/)
 assert.throws(()=>validateReport({...raw(),weakWords:['unobserved']},fixture()),/证据/)
 assert.throws(()=>validateReport({...raw(),reinforcement:[{word:'bank',prompt:'练习',answer:'A different word.',explanation:'说明'}]},fixture()),/对应词/)
})
