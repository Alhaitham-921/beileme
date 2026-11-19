<script setup>
import {ref,watch,onBeforeUnmount} from 'vue'
import {http} from '../api/client.js'
import AppIcon from '../components/AppIcon.vue'
import UserAvatar from '../components/UserAvatar.vue'
const period=ref('total'),data=ref(null),loading=ref(true),error=ref('')
let controller,run=0
async function load(){controller?.abort();controller=new AbortController();const current=++run;loading.value=true;error.value=''
try{const result=await http.get('/stats/leaderboard',{query:{period:period.value},signal:controller.signal,timeoutMs:15000});if(current===run)data.value=result}catch(e){if(current===run)error.value=e.message}finally{if(current===run)loading.value=false}}
watch(period,()=>{data.value=null;load()},{immediate:true})
onBeforeUnmount(()=>{run++;controller?.abort()})
</script>
<template>
  <div class="leaderboard"><header class="page-heading"><div><h1 class="section-title">一起积累，一起向前</h1><p class="section-sub">每一个学过的单词，都是今天多走的一步。</p></div><AppIcon name="trophy" class="board-icon"/></header>
    <div class="board-tabs" role="group" aria-label="排行榜范围"><button v-for="option in [{id:'total',label:'累计学习榜'},{id:'daily',label:'今日学习榜'}]" :key="option.id" class="btn" :class="period===option.id?'btn-primary':'btn-ghost'" :aria-pressed="period===option.id" @click="period=option.id">{{option.label}}</button></div>
    <LoadingState v-if="loading" skeleton>正在整理学习排行…</LoadingState>
    <div v-else-if="error" class="card" role="alert"><p>{{error}}</p><button class="btn btn-ghost" @click="load">重新加载</button></div>
    <template v-else-if="data"><section class="card my-place" aria-label="我的学习排名"><div><small>我的{{period==='daily'?'今日':'累计'}}学习量</small><strong>{{data.me.words}} <span>词</span></strong></div><div><small>{{data.date||'持续积累'}}</small><p>{{data.me.rank?`第 ${data.me.rank} 名`:'学完第一个词，即可加入排行'}}</p></div></section>
    <section class="card board-list"><div class="board-heading"><h2>{{period==='daily'?'今日学习榜':'累计学习榜'}}</h2><span>{{data.participants}} 人参与 · 展示前 50 位</span></div><p v-if="!data.items.length" class="muted">榜单还在等第一个脚步，去学几个词吧。</p><ol v-else><li v-for="(item,index) in data.items" :key="index" :class="{'is-me':item.isMe}"><span class="place" :class="{'top-place':item.rank<=3}">{{item.rank}}</span><UserAvatar :src="item.avatarUrl" :label="item.name"/><span class="learner-name">{{item.name}}<small v-if="item.isMe">当前账号</small></span><strong>{{item.words}} <small>词</small></strong></li></ol></section>
    <p class="board-rule">{{data.rule}} 同分并列；排行仅向登录用户开放，其他用户以学习编号显示。</p></template>
  </div>
</template>
<style scoped>
.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.board-icon{flex-shrink:0}.board-list li{grid-template-columns:28px 32px minmax(0,1fr) auto;gap:10px}.board-list .user-avatar{width:32px;height:32px}.learner-name{font-size:13px;overflow-wrap:anywhere}.learner-name small{display:block;margin:3px 0 0}
.leaderboard{max-width:820px;margin:auto}.board-icon{width:42px;height:42px;color:var(--accent)}.board-tabs{display:flex;gap:10px;margin-bottom:24px}.my-place{display:flex;justify-content:space-between;align-items:center;gap:18px;background:var(--accent-soft);margin-bottom:22px}.my-place small{color:var(--ink-soft)}.my-place strong{display:block;font-size:38px;margin-top:8px;font-variant-numeric:tabular-nums}.my-place strong span{font-size:15px;font-weight:400}.my-place p{font-size:17px}.board-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.board-heading h2{font-size:18px}.board-heading span{font-size:11px;color:var(--ink-soft)}ol{padding:0;list-style:none;margin:12px 0 0}li{display:grid;grid-template-columns:40px 1fr auto;align-items:center;gap:12px;padding:15px 10px;border-top:1px solid var(--line)}li.is-me{background:var(--accent-soft);border-radius:9px}li small{font-size:10px;color:var(--ink-soft);margin-left:8px}li strong{font-variant-numeric:tabular-nums}.place{font-size:16px;color:var(--ink-soft)}.top-place{color:var(--accent);font-weight:700}.board-rule{color:var(--ink-soft);font-size:12px;line-height:1.9;margin-top:20px}@media(max-width:480px){.my-place strong{font-size:32px}.board-heading{align-items:start;flex-direction:column;gap:0}.my-place{padding:20px}}
</style>
