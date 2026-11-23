import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { navigating } from '../stores/activity.js'

const routes = [
  { path: '/recall/spelling/:id', name: 'spelling', component: () => import('../views/SpellingView.vue'), meta: { title: '错词专项 · 拼写练习' } },
  { path: '/practice/image', name: 'image-practice', component: () => import('../views/ImagePracticeView.vue'), meta: { title: '看图聊三轮' } },
  { path: '/notebooks', name: 'notebooks', component: () => import('../views/NotebookLibraryView.vue') },
  { path: '/lookup', name: 'lookup', component: () => import('../views/WordLookupView.vue') },
  { path: '/speech', redirect: '/practice' },
  { path: '/roots', name: 'roots', component: () => import('../views/RootsView.vue') },
  { path: '/practice', name: 'practice', component: () => import('../views/PracticeView.vue') },
  { path: '/practice/demo', name: 'practice-demo', component: () => import('../views/PracticeDemoView.vue') },
  { path: '/recall', name: 'recall', component: () => import('../views/WordRecallView.vue') },
  { path: '/notebooks/collocations', name: 'collocations', component: () => import('../views/CollocationsView.vue'), meta: { title: '错题本 · 搭配练习' } },
  { path: '/collocations', redirect: to => ({ path: '/notebooks/collocations', query: to.query }) },
  { path: '/review/images', name: 'image-recall', component: () => import('../views/ImageRecallView.vue'), meta: { title: '温故知新 · 看图回忆' } },
  { path: '/assessment', name: 'assessment', component: () => import('../views/AssessmentView.vue') },
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/onboarding', name: 'onboarding', component: () => import('../views/OnboardingView.vue') },
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/study', name: 'study', component: () => import('../views/StudyView.vue') },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/leaderboard', name: 'leaderboard', component: () => import('../views/LeaderboardView.vue'), meta: { title: '学习排行' } },
  // 今日回顾：错词重练 + 短文重复阅读
  { path: '/review', name: 'review', component: () => import('../views/ReviewView.vue') },
  // AI 巩固内容：短文 + 阅读理解题（目标词通过 ?words=1,2,3 带入，或 ?id= 打开历史短文）
  { path: '/review/article', name: 'article', component: () => import('../views/ArticleView.vue'), meta: { title: '温故知新 · 阅读巩固' } },
  { path: '/article', redirect: to => ({ path: '/review/article', query: to.query }) },
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
  navigating.value = true
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

  if (!auth.isOnboarded && !['onboarding', 'practice-demo'].includes(to.name)) {
    return { name: 'onboarding' }
  }

  if (auth.isOnboarded && to.name === 'onboarding') {
    return { name: 'home' }
  }

  return true
})

router.afterEach(() => { navigating.value = false })
router.onError(() => { navigating.value = false })

export default router
