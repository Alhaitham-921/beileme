import { createRouter, createWebHistory } from 'vue-router'
import { useAppStore } from '../stores/app'

const routes = [
  { path: '/onboarding', name: 'onboarding', component: () => import('../views/OnboardingView.vue') },
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/study', name: 'study', component: () => import('../views/StudyView.vue') },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const store = useAppStore()
  if (to.name !== 'onboarding' && !store.isOnboarded) {
    return { name: 'onboarding' }
  }
  if (to.name === 'onboarding' && store.isOnboarded) {
    return { name: 'home' }
  }
  return true
})

export default router
