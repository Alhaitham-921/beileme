import { ref, watch } from 'vue'

export const styles = { mechanical: '机械青轴', deep: '低沉轴', soft: '轻触键' }
export const tone = ref('mechanical')
try { const v = localStorage.getItem('blm:typing-tone'); if (Object.hasOwn(styles,v)) tone.value=v } catch {}
watch(tone,v=>{ try {localStorage.setItem('blm:typing-tone',v)} catch {} },{flush:'sync'})
const key = 'beileme.spellingSound'
export const spellingSoundEnabled = ref(true)
try { spellingSoundEnabled.value = localStorage.getItem(key) !== 'off' } catch {}
watch(spellingSoundEnabled, enabled => {
  try { localStorage.setItem(key, enabled ? 'on' : 'off') } catch {}
}, { flush: 'sync' })