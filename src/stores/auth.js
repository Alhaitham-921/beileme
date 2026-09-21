import { defineStore } from 'pinia'
import api from '../api'
import { setTokens, clearTokens, isLoggedIn } from '../api/client.js'

/**
 * 登录态与用户画像。
 *
 * 与「学习数据」分开：本 store 只关心「我是谁、我引导完了没」，
 * 学习相关的一切在 stores/app.js。
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    profile: null,
    /** 是否已经尝试过用本地令牌恢复登录态（避免路由守卫反复请求） */
    initialized: false,
    loading: false,
    error: '',
  }),

  getters: {
    isLoggedIn: (state) => Boolean(state.user),
    isOnboarded: (state) => state.profile?.isOnboarded === true,
    displayName: (state) =>
      state.user?.nickname || state.user?.email || state.user?.phone || '同学',
  },

  actions: {
    /**
     * 应用启动时调用：本地有令牌就换取用户信息，令牌失效则清掉。
     * 无论成功失败都会把 initialized 置为 true，路由守卫据此决定去向。
     */
    async bootstrap() {
      if (this.initialized) return
      if (!isLoggedIn()) {
        this.initialized = true
        return
      }

      try {
        const data = await api.auth.me()
        this.user = data.user
        this.profile = data.profile
      } catch (error) {
        if (error.isAuthError || error.isNetworkError) {
          // 令牌已失效，或后端暂时连不上：都不该让用户卡在空白页
          if (error.isAuthError) clearTokens()
          this.user = null
          this.profile = null
          if (error.isNetworkError) this.error = error.message
        } else {
          this.error = error.message
        }
      } finally {
        this.initialized = true
      }
    },

    async login({ account, password }) {
      this.loading = true
      this.error = ''
      try {
        const data = await api.auth.login({ account, password })
        setTokens(data.tokens)
        this.user = data.user
        this.profile = data.profile
        return data
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    async register({ email, password, nickname }) {
      this.loading = true
      this.error = ''
      try {
        const data = await api.auth.register({ email, password, nickname })
        setTokens(data.tokens)
        this.user = data.user
        this.profile = data.profile
        return data
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading = false
      }
    },

    async logout() {
      try {
        // 通知后端撤销刷新令牌；失败也要清掉本地登录态，不能把用户困住
        await api.auth.logout()
      } catch {
        // 忽略
      } finally {
        clearTokens()
        this.user = null
        this.profile = null
        this.error = ''
      }
    },

    /** 登录态失效时由 api 客户端回调触发 */
    handleExpired() {
      clearTokens()
      this.user = null
      this.profile = null
    },

    async refreshProfile() {
      const data = await api.profile.get()
      this.profile = data.profile
      return data.profile
    },

    /** 完成 Onboarding：后端会一并算出每日新词量并生成当日计划 */
    async completeOnboarding(answers) {
      const data = await api.profile.completeOnboarding(answers)
      this.profile = data.profile
      return data
    },

    async updateProfile(patch) {
      const data = await api.profile.update(patch)
      this.profile = data.profile
      return data.profile
    },
  },
})
