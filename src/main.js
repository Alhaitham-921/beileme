import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAppStore, STORAGE_KEY } from './stores/app'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// 订阅 store 变化，持久化到 localStorage
const store = useAppStore(pinia)
store.$subscribe((_mutation, state) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
})

app.use(router)
app.mount('#app')
