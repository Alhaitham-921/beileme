import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadingPress,READING_HOLD_MS,readingTokens } from '../../src/utils/readingPress.js'
test('reading lookup requires a full two seconds and release, movement and cancellation prevent stale lookup',()=>{
  let callback,opened=[],clears=0
  const press=createReadingPress({onOpen:w=>opened.push(w),setTimer:(fn,delay)=>{assert.equal(delay,2000);callback=fn;return 1},clearTimer:()=>{clears++}})
  assert.equal(READING_HOLD_MS,2000)
  press.start('Alice',{clientX:10,clientY:10,pointerId:1});press.cancel();callback();assert.deepEqual(opened,[])
  press.start('rabbit',{clientX:10,clientY:10,pointerId:1});press.move({clientX:24,clientY:10,pointerId:1});callback();assert.deepEqual(opened,[])
  press.start('wonderland',{pointerId:1});callback();assert.deepEqual(opened,['wonderland']);assert.ok(clears>=2)
})
test('reader tokenisation keeps original punctuation, spaces, contractions and hyphenated words intact',()=>{
  const text='“Alice’s looking-glass,” she said.\nA word.'
  const tokens=readingTokens(text)
  assert.equal(tokens.map(t=>t.text).join(''),text)
  assert.ok(tokens.some(t=>t.word&&t.text==='Alice’s'))
  assert.ok(tokens.some(t=>t.word&&t.text==='looking-glass'))
})
