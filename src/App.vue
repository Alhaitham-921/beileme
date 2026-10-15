<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import logo from './assets/logo.png'
import { theme, themes, setTheme } from './stores/theme'

const auth = useAuthStore()
const router = useRouter()

/** 顶栏只在登录后出现，登录页与引导页保持干净 */
const showChrome = computed(() => auth.isLoggedIn)

async function logout() {
  await auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="app">
    <header v-if="showChrome" class="topbar">
      <router-link to="/" class="brand">
        <img :src="logo" alt="" class="brand-logo" />
        <span class="brand-name">背了么</span>
      </router-link>

      <nav class="nav">
        <router-link to="/" class="nav-link" active-class="active">首页</router-link>
        <router-link to="/study" class="nav-link" active-class="active">学习</router-link>
        <router-link to="/review" class="nav-link" active-class="active">回顾</router-link>
        <router-link to="/practice" class="nav-link" active-class="active">情境</router-link>
        <router-link to="/dashboard" class="nav-link" active-class="active">看板</router-link>
        <router-link to="/settings" class="nav-link" active-class="active">设置</router-link>
      </nav>

      <button class="user-btn" :title="`退出登录（${auth.displayName}）`" @click="logout">
        {{ auth.displayName.slice(0, 1) }}
      </button>
    </header>

    <div class="theme-shortcut"><label>外观 <select :value="theme" aria-label="界面主题" @change="setTheme($event.target.value)"><option v-for="item in themes" :key="item.id" :value="item.id">{{ item.name }}</option></select></label></div>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.theme-shortcut { max-width: 760px; margin: 0 auto; padding: 8px 20px 0; text-align: right; font-size: 12px; color: var(--ink-soft); }.theme-shortcut select { font: inherit; color: var(--ink); background: var(--bg-card); border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; margin-left: 6px; }
.topbar {
  position: relative;
}

.user-btn {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--bg-card);
  color: var(--accent-deep);
  font-size: 15px;
  font-weight: 600;
  transition: border-color 0.15s, background 0.15s;
}

.user-btn:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

@media (max-width: 560px) {
  .brand-name {
    display: none;
  }

  .topbar {
    gap: 8px;
  }

  .nav-link {
    padding: 7px 10px;
    font-size: 13px;
  }
}
</style>
