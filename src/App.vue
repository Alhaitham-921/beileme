<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import AppIcon from './components/AppIcon.vue'
import UserAvatar from './components/UserAvatar.vue'
import AiUsage from './components/AiUsage.vue'
import { latestAiUsage } from './stores/aiUsage.js'
import EnvironmentBackground from './components/EnvironmentBackground.vue'
import brandMark from './assets/brand-mark.svg'
import ActivityIndicator from './components/ActivityIndicator.vue'
import { androidTabs, initializeNavigation } from './stores/navigation.js'
import { tabMatches, drawerSwipe, mainNavigation } from './utils/androidNavigation.js'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const isAndroid = Capacitor.getPlatform() === 'android'
const showChrome = computed(() => auth.isLoggedIn && !['login', 'onboarding'].includes(route.name))
const menuOpen = ref(false)
const menuButton = ref(null)
const sidebar = ref(null)
const links = mainNavigation
watch(() => auth.user?.id, initializeNavigation, { immediate: true })
function isTabActive(tab) {
  return tabMatches(tab, route.path) || (tab.id === 'more' && !androidTabs.value.some(item => item.id !== 'more' && tabMatches(item, route.path)))
}
watch(() => route.path, () => {
  if (isAndroid) window.scrollTo({ top: 0, behavior: 'instant' })
}, { flush: 'post' })
const pageLabel = computed(() => route.meta.title || [...links, { to: '/settings', label: '偏好设置' }, { to: '/assessment', label: '词汇自测' }, { to: '/recall', label: '错词专项' }].find(item => item.to === route.path)?.label || '学习空间')
const atHome = computed(() => route.path === '/')
let navigationTouch = null
function startNavigationSwipe(event) {
  navigationTouch = null
  if (!showChrome.value || (!isAndroid && desktopQuery.matches) || event.touches.length !== 1) return
  if (!menuOpen.value && !atHome.value) return
  if (event.target.closest('a, button, input, textarea, select, label, dialog, [role="slider"], [data-no-navigation-swipe]')) return
  const touch = event.touches[0]
  navigationTouch = {startX:touch.clientX,startY:touch.clientY,id:touch.identifier,at:performance.now(),direction:menuOpen.value?'close':'open'}
}
function moveNavigationSwipe(event) {
  if (!navigationTouch) return
  if (event.touches.length !== 1) { navigationTouch = null; return }
  const touch = event.touches[0], dx=(touch.clientX-navigationTouch.startX)*(navigationTouch.direction==='close'?-1:1),dy=Math.abs(touch.clientY-navigationTouch.startY)
  if (dy>14 && dy>Math.abs(dx)) { navigationTouch=null; return }
  if (dx>14 && dx>dy*1.6 && event.cancelable) event.preventDefault()
}
function endNavigationSwipe(event) {
  const start=navigationTouch;navigationTouch=null
  if (!start) return
  const touch=[...event.changedTouches].find(item=>item.identifier===start.id)
  if (touch && drawerSwipe({...start,endX:touch.clientX,endY:touch.clientY,elapsedMs:performance.now()-start.at})) {
    if (start.direction==='close') closeMenu()
    else openMenu()
  }
}

async function closeMenu(restoreFocus = true) {
  menuOpen.value = false
  if (restoreFocus) { await nextTick(); menuButton.value?.focus() }
}
async function openMenu() {
  menuOpen.value = true
  await nextTick()
  requestAnimationFrame(() => { if (menuOpen.value) sidebar.value?.querySelector('a')?.focus() })
}
function focusOpenNavigation(event) {
  if (event.target === sidebar.value && menuOpen.value) sidebar.value?.querySelector('a')?.focus()
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
function handleDesktop(event) { if (!isAndroid && event.matches) closeMenu(false) }
const nativeListeners = []
onMounted(async () => {
  if (Capacitor.getPlatform() !== 'android') return
  nativeListeners.push(await NativeApp.addListener('backButton', () => {
    if (menuOpen.value) { closeMenu(); return }
    const dialog = document.querySelector('dialog[open]')
    if (dialog) {
      const cancel = new Event('cancel', { cancelable: true })
      if (dialog.dispatchEvent(cancel)) dialog.close()
      return
    }
    if (router.options.history.state.back) router.back()
    else if (!['home', 'login', 'onboarding'].includes(route.name)) router.replace('/')
    else NativeApp.minimizeApp()
  }))
  nativeListeners.push(await NativeApp.addListener('appStateChange', ({ isActive }) => {
    document.dispatchEvent(new CustomEvent('beileme:app-activity', { detail: isActive }))
    if (!isActive) window.dispatchEvent(new Event('pagehide'))
  }))
})
onBeforeUnmount(() => { nativeListeners.forEach(listener => listener.remove()) })
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
  <ActivityIndicator :class="{ 'android-activity': isAndroid }" />
  <div class="app" :class="{ 'android-edge': isAndroid, 'with-navigation': showChrome && !isAndroid, 'android-shell': showChrome && isAndroid }" @touchstart.passive="startNavigationSwipe" @touchmove="moveNavigationSwipe" @touchend="endNavigationSwipe" @touchcancel="navigationTouch = null">
    <a class="accessibility-skip" href="#main-content" @click.prevent="focusMain">跳到主要内容</a>
    <header v-if="showChrome && isAndroid" class="android-header" :inert="menuOpen || undefined">
      <button v-if="atHome" ref="menuButton" type="button" class="brand android-menu-brand" aria-label="背了么，打开导航" :aria-expanded="menuOpen" aria-controls="app-navigation" @click="openMenu"><span class="brand-symbol"><img :src="brandMark" alt="" /></span><span>背了么<span class="brand-dot">.</span></span><AppIcon name="menu" /></button>
      <router-link v-else to="/" class="brand" aria-label="背了么，返回首页"><span class="brand-symbol"><img :src="brandMark" alt="" /></span><span>背了么<span class="brand-dot">.</span></span></router-link>
      <router-link to="/lookup" class="icon-button header-lookup" aria-label="查词"><AppIcon name="search" /></router-link>
    </header>
    <template v-if="showChrome">
      <header v-if="!isAndroid" class="mobile-header" :inert="menuOpen || undefined">
        <button v-if="atHome" ref="menuButton" type="button" class="brand android-menu-brand" aria-label="背了么，打开导航" :aria-expanded="menuOpen" aria-controls="app-navigation" @click="openMenu"><span class="brand-symbol"><img :src="brandMark" alt="" /></span><span>背了么<span class="brand-dot">.</span></span><AppIcon name="menu" /></button>
        <router-link v-else to="/" class="brand" aria-label="背了么，返回首页"><span class="brand-symbol"><img :src="brandMark" alt="" /></span><span>背了么<span class="brand-dot">.</span></span></router-link>
        <div class="mobile-actions">
          <router-link to="/lookup" class="icon-button" aria-label="查词"><AppIcon name="search" /></router-link>
        </div>
      </header>
      <Transition name="menu-shade"><div v-if="menuOpen" class="navigation-overlay" :class="{'android-shade':isAndroid}" @click="closeMenu()"></div></Transition>
      <aside id="app-navigation" ref="sidebar" class="sidebar" :class="{ 'is-open': menuOpen, 'android-drawer': isAndroid }" :inert="isAndroid && !menuOpen || undefined" :role="menuOpen ? 'dialog' : undefined" :aria-modal="menuOpen ? true : undefined" aria-label="学习导航" @transitionend="focusOpenNavigation">
        <div class="sidebar-brand-row">
          <router-link to="/" class="brand" @click="closeMenu(false)"><span class="brand-symbol"><img :src="brandMark" alt="" /></span><span>背了么<span class="brand-dot">.</span><small>让每个单词，都有回响</small></span></router-link>
          <button class="icon-button close-navigation" aria-label="关闭导航" @click="closeMenu()"><AppIcon name="close" /></button>
        </div>
        <p class="navigation-caption">你的学习空间</p>
        <nav class="nav" aria-label="主要导航">
          <router-link v-for="link in links" :key="link.to" :to="link.to" class="nav-link" :class="{active:tabMatches(link,route.path)}" @click="closeMenu(false)"><AppIcon :name="link.icon" /><span>{{ link.label }}</span><small v-if="link.caption">{{ link.caption }}</small></router-link>
        </nav>
        <div class="sidebar-bottom">
          <div class="sidebar-note"><span class="quiet-line"></span><p>慢慢来，<br />每一天都在靠近。</p><small>A LITTLE, EVERY DAY.</small></div>
          <router-link to="/settings" class="nav-link settings-link" exact-active-class="active" @click="closeMenu(false)"><AppIcon name="settings" /><span>偏好设置</span></router-link>
          <div class="sidebar-account"><UserAvatar :src="auth.user?.avatarUrl" :label="auth.displayName"/><div><strong>{{ auth.displayName }}</strong><small>保持好奇，继续生长</small></div><button class="icon-button logout-button" aria-label="退出登录" title="退出登录" @click="logout"><AppIcon name="logout" /></button></div>
        </div>
      </aside>
      <header v-if="!isAndroid" class="workspace-header"><span>学习空间 <span class="breadcrumb-separator">/</span> <strong>{{ pageLabel }}</strong></span><span class="workspace-motto"><span></span> 留一点时间，给自己</span></header>
    </template>
    <main id="main-content" class="main" :class="{ 'public-main': !showChrome }" :inert="menuOpen || undefined" tabindex="-1">
      <div v-if="!route.matched.length" class="card"><LoadingState skeleton>正在打开学习空间…</LoadingState></div>
      <router-view v-slot="{ Component }"><Transition name="page" mode="out-in"><div v-if="Component" :key="route.path" class="route-page"><component :is="Component" /></div></Transition></router-view>
      <AiUsage v-if="showChrome && route.name !== 'collocations'" :usage="latestAiUsage" :label="`${latestAiUsage?.label || 'AI'}最近一次消耗${latestAiUsage?.failed ? '（生成失败）' : ''}`" />
    </main>
    <nav v-if="showChrome && isAndroid" class="android-tabs" :inert="menuOpen || undefined" aria-label="App 底部导航">
      <router-link v-for="tab in androidTabs" :key="tab.to" :to="tab.to"
        :class="{ 'android-tab-active': isTabActive(tab) }">
        <AppIcon :name="tab.icon" /><span>{{ tab.label }}</span>
      </router-link>
    </nav>
    <footer v-if="showChrome && !isAndroid" class="workspace-footer"><span>背了么 · 用单词，而不是背单词</span><span>MAKE ROOM FOR GROWTH.</span></footer>
  </div>
</template>

<style scoped>
.mobile-actions { display: flex; align-items: center; gap: 4px; }
.header-lookup { margin-inline-start: auto; }
.sidebar { overflow: hidden; }
.sidebar > .nav { min-height: 0; overflow-y: auto; overscroll-behavior: contain; flex-shrink: 1; }
.sidebar-brand-row, .navigation-caption, .sidebar-bottom { flex-shrink: 0; }
.android-menu-brand { border: 0; background: none; padding: 0; cursor: pointer; color: inherit; font-family: inherit; }
.android-menu-brand > .app-icon { width: 15px; height: 15px; opacity: .65; margin-left: 4px; }
.navigation-overlay { position: fixed; inset: 0; z-index: 40; background: rgba(4,10,18,.65); backdrop-filter: blur(5px); }
.navigation-overlay.android-shade { backdrop-filter: none; }
.sidebar.android-drawer { left: 0; top: 0; bottom: 0; width: min(310px, 88vw); padding-top: calc(24px + var(--app-safe-top)); padding-bottom: calc(16px + var(--app-safe-bottom)); padding-left: max(16px, var(--app-safe-left)); border-radius: 0 22px 22px 0; background: var(--bg-card); transform: translate3d(-110%,0,0); visibility: hidden; transition: transform 280ms cubic-bezier(.22,.8,.25,1), visibility 280ms; z-index: 50; }
.sidebar.android-drawer.is-open { transform: translate3d(0,0,0); visibility: visible; }
.android-drawer .sidebar-brand-row { display: flex; align-items: center; justify-content: space-between; }
.android-drawer .close-navigation { display: grid; }
.android-drawer .sidebar-note { display: none; }
.android-drawer .sidebar-bottom { padding-top: 12px; }
@media (prefers-reduced-motion: reduce) { .sidebar.android-drawer { transition: none; } }
</style>
