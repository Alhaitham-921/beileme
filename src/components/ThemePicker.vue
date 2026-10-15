<script setup>
import { themes, theme, setTheme } from '../stores/theme'
</script>
<template>
  <section class="card theme-panel" aria-labelledby="theme-title">
    <div class="theme-heading"><div><h2 id="theme-title">界面主题</h2><p>换一种氛围，继续今天的学习</p></div><span>即时生效 · 自动记住</span></div>
    <div class="theme-options" role="group" aria-label="选择界面主题">
      <button v-for="item in themes" :key="item.id" class="theme-choice" :class="{ selected: theme === item.id }" :aria-pressed="theme === item.id" @click="setTheme(item.id)">
        <span class="theme-preview" :style="{ background: item.colors[0], color: item.colors[2] }"><span class="preview-sidebar" :style="{ background: item.colors[1] }"></span><span class="preview-content"><span class="preview-word">hello.</span><span class="preview-line" :style="{ background: item.colors[2] }"></span><span class="preview-pill" :style="{ background: item.colors[1] }"></span></span></span>
        <span class="theme-name">{{ item.name }} <span v-if="theme === item.id" aria-hidden="true">✓</span></span>
        <span class="theme-description">{{ item.description }}</span>
      </button>
    </div>
  </section>
</template>
<style scoped>
.theme-panel { margin-bottom: 28px; }.theme-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 22px; }.theme-heading h2 { margin: 0; font-size: 18px; }.theme-heading p { margin: 4px 0 0; color: var(--ink-soft); font-size: 13px; }.theme-heading > span { font-size: 11px; color: var(--ink-soft); }.theme-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }.theme-choice { padding: 10px; text-align: left; border: 1px solid var(--line); border-radius: 14px; background: transparent; color: var(--ink); }.theme-choice.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }.theme-preview { display: flex; height: 100px; border-radius: 9px; overflow: hidden; border: 1px solid rgba(128,128,128,.2); }.preview-sidebar { width: 14px; opacity: .5; }.preview-content { display: flex; flex-direction: column; padding: 12px; gap: 8px; }.preview-word { font-family: var(--serif); font-size: 21px; }.preview-line { width: 55px; height: 3px; opacity: .25; }.preview-pill { width: 38px; height: 10px; border-radius: 10px; }.theme-name { display: flex; justify-content: space-between; font-size: 14px; font-weight: 600; margin-top: 12px; }.theme-description { font-size: 11px; color: var(--ink-soft); }@media(max-width: 480px) { .theme-options { grid-template-columns: 1fr; }.theme-preview { height: 80px; }.theme-choice { display: grid; grid-template-columns: 110px 1fr; gap: 0 14px; }.theme-preview { grid-row: span 2; }.theme-heading > span { display: none; } }
</style>
