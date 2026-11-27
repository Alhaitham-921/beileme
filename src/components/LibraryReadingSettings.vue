<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue'
import {library} from '../api/index.js'
const loaded=ref(false),showChinese=ref(false),busy=ref(false),message=ref('');let disposed=false
async function load(){try{const prefs=await library.preferences();if(!disposed){showChinese.value=prefs.showChinese;loaded.value=true}}catch(e){message.value=e.message}}
async function change(event){const value=event.target.checked;busy.value=true;message.value='';try{const prefs=await library.savePreferences({showChinese:value});if(!disposed){showChinese.value=prefs.showChinese;message.value='阅读偏好已保存到账号'}}catch(e){if(!disposed){event.target.checked=showChinese.value;message.value=e.message}}finally{busy.value=false}}
onMounted(load);onBeforeUnmount(()=>{disposed=true})
</script>
<template><section class="card reading-settings" aria-label="英文阅读偏好"><h2>英文阅读</h2><label><input type="checkbox" :checked="showChinese" :disabled="!loaded||busy" @change="change"> 每页英文后显示中文对照区</label><p>可导入中文译本，按章节保存对照，无需 API。AI 解释仅在点击生成时调用并保存复用，开启本开关不会自动调用 AI。关闭后只显示英文，已保存对照和解释继续保留。</p><p>翻页会适配屏幕和字号；长按单词 2 秒查释义，也可选择句子分析句式与单词用法。</p><p v-if="message" role="status">{{message}} <button v-if="!loaded" class="text-button" @click="load">重试读取</button></p></section></template>
<style scoped>.reading-settings{padding:20px;margin:18px 0}.reading-settings h2{font-size:18px;margin:0 0 14px}.reading-settings label{display:flex;gap:9px;align-items:center}.reading-settings p{font-size:12px;line-height:1.8;color:var(--ink-soft);margin:12px 0 0}</style>
