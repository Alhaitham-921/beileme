import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, ref, nextTick } from 'vue'
import { usePracticeWordPicker } from '../../src/composables/usePracticeWordPicker.js'
import { scenarioRequestDescription, DEFAULT_WORD_SCENARIO } from '../../src/utils/scenarioRequest.js'

async function until(predicate) {
  for (let n=0;n<100;n++) { if (predicate()) return; await new Promise(resolve=>setTimeout(resolve,5)) }
  assert.fail('Word picker request did not settle')
}
function mount(t,options,initial=[]) {
  const selected=ref(initial),renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null})
  let picker
  const app=renderer.createApp({setup(){picker=usePracticeWordPicker(selected,ids=>{selected.value=ids},{searchDelay:5,...options});return ()=>null}})
  app.mount({});t.after(()=>app.unmount())
  return {picker,selected}
}
const word=(id)=>({id,spelling:`word${id}`,definitions:[`释义${id}`]})

test('history picker searches and paginates without losing cross-source selections or accepting a sixth word',async t=>{
  const requests=[]
  const {picker:p,selected}=mount(t,{
    wordApi:{detail:async id=>({word:word(id)}),collection:async options=>{
      requests.push(options)
      return {items:options.source==='favorites'?[word(90)]:options.q?[word(45)]:options.page===1?[word(1),word(2)]:[word(31)],total:options.q?1:31,totalPages:options.q?1:2}
    }},studyApi:{reviewToday:async()=>({wrongWords:[{...word(88),wordId:88}]})},
  })
  await until(()=>!p.loading.value)
  assert.equal(requests[0].source,'mistakes')
  p.toggle(1);await nextTick();p.goPage(2);await until(()=>!p.loading.value)
  p.toggle(31);await nextTick()
  assert.deepEqual(selected.value,[1,31]);assert.equal(p.chosen.value[0].spelling,'word1')
  p.selectSource('saved');await until(()=>!p.loading.value);p.toggle(90);await nextTick()
  p.selectSource('wrong');await until(()=>!p.loading.value);p.toggle(88);await nextTick()
  assert.equal(p.list.value[0].id,88)
  p.selectSource('mistakes');await until(()=>!p.loading.value)
  p.setSearch('历史释义');await until(()=>!p.loading.value)
  assert.equal(requests.at(-1).q,'历史释义');assert.equal(requests.at(-1).page,1)
  p.toggle(45);await nextTick();p.toggle(999)
  assert.equal(selected.value.length,5);assert.ok(!selected.value.includes(999))
  p.toggle(31);await nextTick();assert.deepEqual(selected.value,[1,90,88,45])
})

test('slow old-source requests cannot overwrite a newer selection and one failing source does not block others',async t=>{
  const pending=Promise.withResolvers();let historyCalls=0
  const {picker:p}=mount(t,{wordApi:{detail:async id=>({word:word(id)}),collection:async options=>{
    if(options.source==='mistakes'&&historyCalls++===0)return pending.promise
    return {items:[word(12)],total:1,totalPages:1}
  }},studyApi:{reviewToday:async()=>{throw Error('今日错词暂时读取失败')}}})
  p.selectSource('saved');await until(()=>!p.loading.value)
  pending.resolve({items:[word(99)],total:1,totalPages:1});await nextTick();await new Promise(r=>setTimeout(r,5))
  assert.equal(p.source.value,'saved');assert.equal(p.list.value[0].id,12)
  p.selectSource('wrong');await until(()=>!p.loading.value);assert.match(p.error.value,/暂时读取失败/)
  p.selectSource('mistakes');await until(()=>!p.loading.value);assert.equal(p.error.value,'');assert.equal(p.list.value[0].id,12)
})

test('selected words permit an empty or short brief, while invalid free briefs get actionable feedback',()=>{
  assert.equal(scenarioRequestDescription('   ',[1]).description,DEFAULT_WORD_SCENARIO)
  assert.match(scenarioRequestDescription('酒店',[1]).description,/酒店/)
  assert.ok(scenarioRequestDescription('酒店',[1]).description.length>=10)
  assert.match(scenarioRequestDescription('',[]).error,/选择 1–5 个单词/)
  assert.match(scenarioRequestDescription('酒店',[]).error,/至少 10 个字/)
  const valid='我想练习办理酒店入住，并确认早餐和退房时间。'
  assert.equal(scenarioRequestDescription(' '+valid+' ',[]).description,valid)
  assert.match(scenarioRequestDescription('a'.repeat(1501),[1]).error,/1500/)
})
