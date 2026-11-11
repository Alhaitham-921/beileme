<script setup>
import {useRoute} from 'vue-router'
const route=useRoute()
const links=[['/ielts','专项概览'],['/ielts/specialties','四科训练'],['/ielts/mock','计时模考'],['/ielts/records','专项档案'],['/ielts/settings','目标与服务']]
</script>
<template><nav class="ielts-subnav" aria-label="雅思专项导航"><router-link v-for="[path,label] in links" :key="path" :to="path" :class="{active:route.path===path}">{{label}}</router-link></nav></template>
<style scoped>.ielts-subnav{display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:0 0 15px;margin-bottom:26px}.ielts-subnav a{color:var(--ink-soft);font-size:13px;padding:6px 0}.ielts-subnav a.active{color:var(--accent-deep);box-shadow:0 2px 0 var(--accent)}@media(max-width:600px){.ielts-subnav{gap:10px 18px}.ielts-subnav a{font-size:12px}}</style>
