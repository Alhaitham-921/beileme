<script setup>
import { useAppStore } from './stores/app'

const store = useAppStore()
</script>

<template>
  <div class="app">
    <header v-if="store.isOnboarded" class="topbar">
      <router-link to="/" class="brand">
        <img src="/logo.png" alt="" class="brand-logo" />
        <span class="brand-name">背了么</span>
      </router-link>
      <nav class="nav">
        <router-link to="/" class="nav-link" active-class="active">首页</router-link>
        <router-link to="/study" class="nav-link" active-class="active">学习</router-link>
        <router-link to="/dashboard" class="nav-link" active-class="active">看板</router-link>
      </nav>
    </header>

    <main class="main">
      <router-view />
    </main>
  </div>
</template>
