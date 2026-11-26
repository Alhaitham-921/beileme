export const READING_HOLD_MS=2000
export function readingTokens(text) {
  return text.split(/([A-Za-z]+(?:['’\u2011-][A-Za-z]+)*)/g).filter(Boolean)
    .map(text=>({text,word:/^[A-Za-z]+(?:['’\u2011-][A-Za-z]+)*$/.test(text)}))
}
export function createReadingPress({onOpen,onCancel=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}) {
  let pending=null,timer=null
  function cancel() {if(timer!==null)clearTimer(timer);timer=null;pending=null;onCancel()}
  return {
    start(word,{clientX=0,clientY=0,pointerId=0,button=0}={}) {
      cancel();if(button!==0)return
      pending={word,x:clientX,y:clientY,pointerId}
      timer=setTimer(()=>{const value=pending;timer=null;pending=null;onCancel();if(value)onOpen(value.word)},READING_HOLD_MS)
    },
    move({clientX,clientY,pointerId}) {
      if(pending&&(pointerId!==pending.pointerId||Math.hypot(clientX-pending.x,clientY-pending.y)>10))cancel()
    },cancel,
  }
}
