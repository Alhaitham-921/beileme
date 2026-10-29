<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import AppIcon from './components/AppIcon.vue'
import AiUsage from './components/AiUsage.vue'
import { latestAiUsage } from './stores/aiUsage.js'
import EnvironmentBackground from './components/EnvironmentBackground.vue'
import brandMark from './assets/brand-mark.svg'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const showChrome = computed(() => auth.isLoggedIn && !['login', 'onboarding'].includes(route.name))
const menuOpen = ref(false)
const menuButton = ref(null)
const sidebar = ref(null)
const links = [
  { to: '/', icon: 'home', label: '今日', caption: 'TODAY' },
  { to: '/study', icon: 'book', label: '单词学习' },
  { to: '/review', icon: 'repeat', label: '温故知新' },
  { to: '/notebooks', icon: 'book', label: '我的单词本' },
  { to: '/practice', icon: 'chat', label: '情境练习' },
  { to: '/roots', icon: 'layers', label: '词根词缀' },
  { to: '/dashboard', icon: 'chart', label: '学习足迹' },
]
const pageLabel = computed(() => [...links, { to: '/settings', label: '偏好设置' }, { to: '/article', label: '阅读巩固' }, { to: '/assessment', label: '词汇测评' }].find(item => item.to === route.path)?.label || '学习空间')

async function closeMenu(restoreFocus = true) {
  menuOpen.value = false
  if (restoreFocus) { await nextTick(); menuButton.value?.focus() }
}
async function openMenu() {
  menuOpen.value = true
  await nextTick()
  sidebar.value?.querySelector('a')?.focus()
}
function onKeydown(event) {
  if (!menuOpen.value) return
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return }
  if (event.key !== 'Tab') return
  const controls = [...sidebar.value.querySelectorAll('a, button')].filter(el => el.getClientRects().length)
  const first = controls[0], last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
watch(() => route.fullPath, () => closeMenu(false))
watch(menuOpen, open => { document.body.classList.toggle('menu-is-open', open) })
document.addEventListener('keydown', onKeydown)
const desktopQuery = window.matchMedia('(min-width: 821px)')
function handleDesktop(event) { if (event.matches) closeMenu(false) }
desktopQuery.addEventListener('change', handleDesktop)
onBeforeUnmount(() => { document.removeEventListener('keydown', onKeydown); desktopQuery.removeEventListener('change', handleDesktop); document.body.classList.remove('menu-is-open') })
async function logout() {
  await auth.logout()
  router.replace({ name: 'login' })
}
function focusMain() { document.getElementById('main-content')?.focus() }
</script>

<template>
  <EnvironmentBackground />
  <div class="app" :class="{ 'with-navigation': showChrome }">
    <a class="accessibility-skip" href="#main-content" @click.prevent="focusMain">跳到主要内容</a>
    <template v-if="showChrome">
      <header class="mobile-header">
        <router-link to="/" class="brand"><span class="brand-symbol"><img :src="brandMark" alt="" /></span><span>背了么<span class="brand-dot">.</span></span></router-link>
        <button ref="menuButton" class="icon-button" aria-label="打开导航" :aria-expanded="menuOpen" aria-controls="app-navigation" @click="openMenu"><AppIcon name="menu" /></button>
      </header>
      <div v-if="menuOpen" class="navigation-overlay" @click="closeMenu()"></div>
      <aside id="app-navigation" ref="sidebar" class="sidebar" :class="{ 'is-open': menuOpen }" :role="menuOpen ? 'dialog' : undefined" :aria-modal="menuOpen ? true : undefined" aria-label="学习导航">
        <div class="sidebar-brand-row">
          <router-link to="/" class="brand" @click="closeMenu(false)"><span class="brand-symbol"><img :src="brandMark" alt="" /></span><span>背了么<span class="brand-dot">.</span><small>让每个单词，都有回响</small></span></router-link>
          <button class="icon-button close-navigation" aria-label="关闭导航" @click="closeMenu()"><AppIcon name="close" /></button>
        </div>
        <p class="navigation-caption">你的学习空间</p>
        <nav class="nav" aria-label="主要导航">
          <router-link v-for="link in links" :key="link.to" :to="link.to" class="nav-link" exact-active-class="active" @click="closeMenu(false)"><AppIcon :name="link.icon" /><span>{{ link.label }}</span><small v-if="link.caption">{{ link.caption }}</small></router-link>
        </nav>
        <div class="sidebar-bottom">
          <div class="sidebar-note"><span class="quiet-line"></span><p>慢慢来，<br />每一天都在靠近。</p><small>A LITTLE, EVERY DAY.</small></div>
          <router-link to="/settings" class="nav-link settings-link" exact-active-class="active" @click="closeMenu(false)"><AppIcon name="settings" /><span>偏好设置</span></router-link>
          <div class="sidebar-account"><span class="avatar">{{ auth.displayName.slice(0, 1) }}</span><div><strong>{{ auth.displayName }}</strong><small>保持好奇，继续生长</small></div><button class="icon-button logout-button" aria-label="退出登录" title="退出登录" @click="logout"><AppIcon name="logout" /></button></div>
        </div>
      </aside>
      <header class="workspace-header"><span>学习空间 <span class="breadcrumb-separator">/</span> <strong>{{ pageLabel }}</strong></span><span class="workspace-motto"><span></span> 留一点时间，给自己</span></header>
    </template>
    <main id="main-content" class="main" :class="{ 'public-main': !showChrome }" :inert="menuOpen || undefined" tabindex="-1"><router-view /><AiUsage v-if="showChrome" :usage="latestAiUsage" :label="`${latestAiUsage?.label || 'AI'}最近一次消耗${latestAiUsage?.failed ? '（生成失败）' : ''}`" /></main>
    <footer v-if="showChrome" class="workspace-footer"><span>背了么 · 用单词，而不是背单词</span><span>MAKE ROOM FOR GROWTH.</span></footer>
  </div>
</template>
