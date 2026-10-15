import { ref } from 'vue'
export const themes = [
  { id: 'paper', name: '暖纸', description: '米白纸感 · 陶土橙', colors: ['#faf6f0', '#d0765a', '#3a3633'] },
  { id: 'frost', name: '磨砂暗黑', description: '雾面玻璃 · 冰蓝微光', colors: ['#10141d', '#86bdf9', '#e8edf5'] },
  { id: 'forest', name: '林间', description: '浅绿留白 · 松针绿', colors: ['#f0f5ef', '#34785e', '#233d31'] },
]
const key = 'beileme.theme'
export const theme = ref('paper')
export function setTheme(id) {
  theme.value = themes.some(t => t.id === id) ? id : 'paper'
  document.documentElement.dataset.theme = theme.value
  document.documentElement.style.backgroundColor = ''
  try { localStorage.setItem(key, theme.value) } catch { /* 浏览器禁用存储时仍可切换 */ }
}
export function initializeTheme() {
  let saved = 'paper'
  try { saved = localStorage.getItem(key) || 'paper' } catch { /* 使用默认主题 */ }
  setTheme(saved)
  window.addEventListener('storage', event => {
    if (event.key === key) {
      theme.value = themes.some(t => t.id === event.newValue) ? event.newValue : 'paper'
      document.documentElement.dataset.theme = theme.value
    }
  })
}
