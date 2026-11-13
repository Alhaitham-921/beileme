import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/ielts', name: 'ielts-home', component: () => import('../views/IeltsHomeView.vue') },
  { path: '/ielts/specialties', name: 'ielts-specialties', component: () => import('../views/IeltsCatalogView.vue') },
  { path: '/ielts/mock', name: 'ielts-mock', component: () => import('../views/IeltsCatalogView.vue') },
  { path: '/ielts/records', name: 'ielts-record', component: () => import('../views/IeltsArchiveView.vue') },
  { path: '/ielts/settings', name: 'ielts-account', component: () => import('../views/IeltsAccountView.vue') },
  { path: '/ielts/attempt/:id', name: 'ielts-attempt', component: () => import('../views/IeltsAttemptView.vue') },
  { path: '/ielts/vocabulary', name: 'ielts-vocabulary', component: () => import('../views/IeltsVocabularyView.vue') },
  { path: '/ielts/admin', name: 'ielts-admin', component: () => import('../views/IeltsAdminView.vue') },
  { path: '/notebooks', name: 'notebooks', component: () => import('../views/NotebooksView.vue') },
  { path: '/lookup', name: 'lookup', component: () => import('../views/WordLookupView.vue') },
  { path: '/speech', name: 'speech', component: () => import('../views/SpeechView.vue') },
  { path: '/roots', name: 'roots', component: () => import('../views/RootsView.vue') },
  { path: '/practice', name: 'practice', component: () => import('../views/PracticeView.vue') },
  { path: '/practice/demo', name: 'practice-demo', component: () => import('../views/PracticeDemoView.vue') },
  { path: '/recall', name: 'recall', component: () => import('../views/WordRecallView.vue') },
  { path: '/review/images', name: 'image-recall', component: () => import('../views/ImageRecallView.vue'), meta: { title: '看图回忆' } },
  { path: '/assessment', name: 'assessment', component: () => import('../views/AssessmentView.vue') },
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/onboarding', name: 'onboarding', component: () => import('../views/OnboardingView.vue') },
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/study', name: 'study', component: () => import('../views/StudyView.vue') },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  // 今日回顾：错词重练 + 短文重复阅读
  { path: '/review', name: 'review', component: () => import('../views/ReviewView.vue') },
  // AI 巩固内容：短文 + 阅读理解题（目标词通过 ?words=1,2,3 带入，或 ?id= 打开历史短文）
  { path: '/article', name: 'article', component: () => import('../views/ArticleView.vue') },
  { path: '/more', name: 'more', component: () => import('../views/MoreView.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
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

  if (!auth.isOnboarded && !['onboarding', 'speech', 'practice-demo'].includes(to.name)) {
    return { name: 'onboarding' }
  }

  if (auth.isOnboarded && to.name === 'onboarding') {
    return { name: 'home' }
  }

  return true
})

export default router
