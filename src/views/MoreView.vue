<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AppIcon from '../components/AppIcon.vue'
import UserAvatar from '../components/UserAvatar.vue'
import { navigationModules } from '../utils/androidNavigation.js'

const auth = useAuthStore()
const router = useRouter()
const links = navigationModules.filter(link => link.id !== 'more')

async function logout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <section class="more-page">
    <h1 class="section-title">更多</h1>
    <div class="profile-heading"><UserAvatar :src="auth.user?.avatarUrl" :label="auth.displayName" :size="72" /><div><h2>{{ auth.displayName }}</h2><p class="section-sub">个人主页 · 用自己的节奏，留下学习足迹</p></div></div>
    <nav class="card more-links" aria-label="更多功能">
      <router-link v-for="link in links" :key="link.to" :to="link.to">
        <AppIcon :name="link.icon" /><span>{{ link.label }}</span><span aria-hidden="true">›</span>
      </router-link>
    </nav>
    <button type="button" class="btn btn-ghost" @click="logout">退出登录</button>
  </section>
</template>

<style scoped>
.more-page { max-width: 600px; margin: 0 auto; }
.profile-heading { display:flex; align-items:center; gap:16px; margin:20px 0; }.profile-heading h2 { margin:0; font-size:18px; overflow-wrap:anywhere; }
.more-links { margin: 16px 0; padding: 8px 16px; }
.more-links a { display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center; min-height: 52px; color: var(--ink); text-decoration: none; }
.more-links a + a { border-top: 1px solid var(--line); }
</style>
