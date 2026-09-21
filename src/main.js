import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { onAuthExpired } from './api/client.js'
import logoUrl from './assets/logo.png'
import './styles/main.css'

// 单文件部署（file://）下 favicon 无法用绝对路径，改为运行时从内联资源设置
const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/png'
favicon.href = logoUrl
document.head.appendChild(favicon)

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

/**
 * 令牌彻底失效（刷新令牌也过期）时，交给 auth store 清状态并跳回登录页。
 * 注册在路由挂载之前，保证任何一次接口调用触发失效都能被捕获。
 */
const auth = useAuthStore(pinia)
onAuthExpired(() => {
  auth.handleExpired()
  if (router.currentRoute.value.name !== 'login') {
    router.replace({ name: 'login' })
  }
})

app.use(router)
app.mount('#app')
