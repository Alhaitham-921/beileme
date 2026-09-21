import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/onboarding', name: 'onboarding', component: () => import('../views/OnboardingView.vue') },
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/study', name: 'study', component: () => import('../views/StudyView.vue') },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

/**
 * 路由守卫决定「这个用户现在该去哪个页面」，三条规则：
 *  1. 没登录 → 一律去登录页（登录页本身放行）
 *  2. 登录了但没做引导 → 去引导页
 *  3. 已经引导过还想去引导页 → 回首页
 */
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 首次进入应用时，先用本地令牌换一次用户信息
  if (!auth.initialized) await auth.bootstrap()

  if (!auth.isLoggedIn) {
    if (to.meta.public) return true
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }

  if (to.name === 'login') {
    return { name: auth.isOnboarded ? 'home' : 'onboarding' }
  }

  if (!auth.isOnboarded && to.name !== 'onboarding') {
    return { name: 'onboarding' }
  }

  if (auth.isOnboarded && to.name === 'onboarding') {
    return { name: 'home' }
  }

  return true
})

export default router
