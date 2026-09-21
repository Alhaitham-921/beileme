<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import logo from './assets/logo.png'

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
        <router-link to="/dashboard" class="nav-link" active-class="active">看板</router-link>
      </nav>

      <button class="user-btn" :title="`退出登录（${auth.displayName}）`" @click="logout">
        {{ auth.displayName.slice(0, 1) }}
      </button>
    </header>

    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
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
