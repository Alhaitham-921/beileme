<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AppIcon from '../components/AppIcon.vue'

const auth = useAuthStore()
const router = useRouter()
const links = [
  { to: '/review', icon: 'repeat', label: '温故知新' },
  { to: '/roots', icon: 'layers', label: '词根词缀' },
  { to: '/dashboard', icon: 'chart', label: '学习足迹' },
  { to: '/ielts', icon: 'layers', label: '雅思专项' },
  { to: '/settings', icon: 'settings', label: '偏好设置' },
]

async function logout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <section class="more-page">
    <h1 class="section-title">更多</h1>
    <p class="section-sub">{{ auth.displayName }}</p>
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
.more-links { margin: 16px 0; padding: 8px 16px; }
.more-links a { display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center; min-height: 52px; color: var(--ink); text-decoration: none; }
.more-links a + a { border-top: 1px solid var(--line); }
</style>
