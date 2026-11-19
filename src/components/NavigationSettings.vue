<script setup>
import {watch,ref} from 'vue'
import {useAuthStore} from '../stores/auth'
import {selectedTabIds,initializeNavigation,saveNavigation} from '../stores/navigation.js'
import {navigationModules,defaultTabIds} from '../utils/androidNavigation.js'
const auth=useAuthStore(),notice=ref('')
watch(()=>auth.user?.id,initializeNavigation,{immediate:true})
function update(index,event){const ids=[...selectedTabIds.value];ids[index]=event.target.value;notice.value=saveNavigation(ids)?'已保存，安卓底栏会立即更新。':'当前设备无法保存，暂时只在本次使用中生效。'}
function reset(){notice.value=saveNavigation(defaultTabIds)?'已恢复默认底栏。':'当前设备无法保存，暂时只在本次使用中生效。'}
</script>
<template>
  <section class="card navigation-settings" aria-label="安卓底部导航设置">
    <h2>把常用功能放在手边</h2><p class="muted">安卓底栏只固定「今日」，其余四个位置可以自由选择。背单词从首页进入，其他模块随时可从侧栏打开。</p>
    <div class="tab-preview"><span>今日 <small>固定</small></span></div>
    <label v-for="(id,index) in selectedTabIds" :key="index">位置 {{index+2}}<select :value="id" @change="update(index,$event)"><option v-for="module in navigationModules" :key="module.id" :value="module.id" :disabled="module.id!==id&&selectedTabIds.includes(module.id)">{{module.label}}</option></select></label>
    <button class="text-button" type="button" @click="reset">恢复默认</button><p class="muted">设置保存在当前设备，按登录账号区分。</p><p v-if="notice" role="status">{{notice}}</p>
  </section>
</template>
<style scoped>
.navigation-settings{margin-top:16px}.navigation-settings h2{font-size:19px;margin:0 0 14px}.navigation-settings p{font-size:12px;line-height:1.8}.navigation-settings label{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:14px 0}.navigation-settings select{min-width:160px;max-width:70%;padding:9px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:var(--bg-card)}.tab-preview{display:flex;gap:10px}.tab-preview span{padding:9px 12px;background:var(--accent-soft);border-radius:9px}.tab-preview small{font-size:10px;color:var(--ink-soft);margin-left:6px}
</style>
