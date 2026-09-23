import { defineStore } from 'pinia'
import api from '../api'

/** 进行中的会话 id 存这里，刷新页面后可以接着背同一组题 */
const ACTIVE_SESSION_KEY = 'beileme:activeSession'

function readActiveSessionId() {
  try {
    const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

function writeActiveSessionId(id) {
  try {
    if (id) sessionStorage.setItem(ACTIVE_SESSION_KEY, String(id))
    else sessionStorage.removeItem(ACTIVE_SESSION_KEY)
  } catch {
    // 忽略存储不可用
  }
}

/**
 * 学习数据。所有内容都来自后端，前端不再自己算 SRS 与统计。
 *
 * 这样做的意义：换台设备/换个浏览器登录，进度和错题本都在；
 * 而且对错由服务端判定，前端拿不到答案，也就无法「作弊」。
 */
export const useAppStore = defineStore('app', {
  state: () => ({
    // 首页
    plan: null,
    overview: null,
    adjustmentPrompt: null,

    // 背词会话
    session: null,
    items: [],
    currentIndex: 0,
    /** 最近一次作答的完整结果（含错因分析、易混词卡片） */
    lastAnswer: null,
    sessionSummary: null,
    newBadges: [],

    // 看板
    trend: [],
    strengthDistribution: {},
    errorDistribution: null,
    weakSummary: null,
    calendar: [],
    badges: null,

    // 主页气泡彩蛋
    recentWords: [],

    /** 今日回顾：当天答错的词 + 当天生成的短文 */
    todayReview: null,

    loading: { home: false, session: false, dashboard: false, answering: false, review: false },
    error: '',
  }),

  getters: {
    /** 今日任务（新词/复习/可选任务） */
    todayNew: (state) => ({
      done: state.plan?.newDone ?? 0,
      target: state.plan?.newTarget ?? 0,
      percent: state.plan?.newPercent ?? 0,
    }),
    todayReview: (state) => ({
      done: state.plan?.reviewDone ?? 0,
      target: state.plan?.reviewTarget ?? 0,
      percent: state.plan?.reviewPercent ?? 0,
    }),
    allDoneToday: (state) => state.plan?.allDone === true,

    currentItem: (state) => state.items[state.currentIndex] || null,
    totalItems: (state) => state.items.length,
    answeredCount: (state) => state.items.filter((item) => item.answered).length,
    sessionCorrect: (state) => state.items.filter((item) => item.correct === true).length,
    sessionWrong: (state) => state.items.filter((item) => item.correct === false).length,
    sessionAccuracy() {
      const total = this.sessionCorrect + this.sessionWrong
      return total ? Math.round((this.sessionCorrect / total) * 100) : 0
    },
    isLastItem: (state) => state.currentIndex >= state.items.length - 1,

    totalLearned: (state) => state.overview?.totalLearned ?? 0,
    accuracy: (state) => state.overview?.accuracy ?? 0,
    streak: (state) => state.overview?.streak ?? 0,
    dueCount: (state) => state.overview?.dueCount ?? 0,
  },

  actions: {
    /** 首页：今日计划 + 总览 + 是否该弹自适应难度询问 */
    async loadHome() {
      this.loading.home = true
      this.error = ''
      try {
        const [planData, overview, prompt] = await Promise.all([
          api.plan.today(),
          api.stats.overview(),
          api.plan.adjustmentPrompt(),
        ])
        this.plan = planData.plan
        this.overview = overview
        this.adjustmentPrompt = prompt?.shouldPrompt ? prompt : null
        return planData
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.home = false
      }
    },

    async adjustPlan(reason) {
      const data = await api.plan.adjust(reason)
      this.plan = data.plan
      this.adjustmentPrompt = null
      return data
    },

    /**
     * 开始一轮学习。
     * @param {'daily'|'extra'} kind daily=按今日计划，extra=再学一组
     */
    async startSession(kind = 'daily') {
      this.loading.session = true
      this.error = ''
      this.lastAnswer = null
      this.sessionSummary = null
      try {
        const data = await api.study.createSession(kind)
        this.session = data.session
        this.items = data.items
        this.currentIndex = 0
        this.plan = data.plan || this.plan
        if (data.items.length) writeActiveSessionId(data.session.id)
        else writeActiveSessionId(null)
        return data
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.session = false
      }
    },

    /**
     * 开一轮「错词重练」：只做指定的一批词，不受每日计划限制。
     * 今日回顾页的「再练一遍」用它。
     */
    async startReviewSession(wordIds) {
      this.loading.session = true
      this.error = ''
      this.lastAnswer = null
      this.sessionSummary = null
      try {
        const data = await api.study.createReviewSession(wordIds)
        this.session = data.session
        this.items = data.items
        this.currentIndex = 0
        this.plan = data.plan || this.plan
        writeActiveSessionId(data.session.id)
        return data
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.session = false
      }
    },

    /** 今日回顾：今天答错的词 + 今天生成的短文 */
    async loadTodayReview() {
      this.loading.review = true
      try {
        this.todayReview = await api.study.reviewToday()
        return this.todayReview
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.review = false
      }
    },

    /** 刷新页面后恢复进行中的会话 */
    async restoreSession() {
      const sessionId = readActiveSessionId()
      if (!sessionId || this.session?.id === sessionId) return null

      this.loading.session = true
      try {
        const data = await api.study.getSession(sessionId)
        this.session = data.session
        this.items = data.items
        // 跳过已作答的题
        const nextIndex = data.items.findIndex((item) => !item.answered)
        this.currentIndex = nextIndex === -1 ? Math.max(0, data.items.length - 1) : nextIndex
        return data
      } catch {
        // 会话已失效就安静地放弃恢复
        writeActiveSessionId(null)
        return null
      } finally {
        this.loading.session = false
      }
    },

    /**
     * 提交作答。对错由服务端判定，这里只上报选项下标与犹豫时长。
     * @returns {Promise<object>} 含 isCorrect / analysis / confusableCard / progress
     */
    async submitAnswer({ wordId, optionIndex, hesitationMs, source = 'study', spellingMistake = false }) {
      if (!this.session) throw new Error('当前没有进行中的学习会话')

      this.loading.answering = true
      try {
        const data = await api.study.answer(this.session.id, {
          wordId,
          optionIndex,
          hesitationMs,
          source,
          spellingMistake,
        })

        this.lastAnswer = data
        if (data.plan) this.plan = data.plan
        if (data.unlockedBadges?.length) this.newBadges = data.unlockedBadges

        // 同步本地题目状态，让进度与结果统计立刻反映出来
        const item = this.items.find((entry) => entry.wordId === wordId)
        if (item) {
          item.answered = true
          item.correct = data.isCorrect
        }
        return data
      } finally {
        this.loading.answering = false
      }
    },

    nextQuestion() {
      if (this.currentIndex < this.items.length - 1) {
        this.currentIndex += 1
        this.lastAnswer = null
      }
    },

    async finishSession() {
      if (!this.session) return null
      const data = await api.study.finish(this.session.id)
      this.sessionSummary = data.summary
      writeActiveSessionId(null)
      return data
    },

    /** 结束本轮并清空本地会话状态 */
    clearSession() {
      this.session = null
      this.items = []
      this.currentIndex = 0
      this.lastAnswer = null
      this.sessionSummary = null
      writeActiveSessionId(null)
    },

    /** 看板：一次性把各图表需要的数据取回来 */
    async loadDashboard() {
      this.loading.dashboard = true
      this.error = ''
      try {
        const [overview, trend, strength, errors, weak, calendar, badges] = await Promise.all([
          api.stats.overview(),
          api.stats.trend({ days: 7 }),
          api.stats.strength(),
          api.stats.errors({ days: 30 }),
          api.stats.weakSummary({ days: 7 }),
          api.plan.calendar(),
          api.stats.badges(),
        ])

        this.overview = overview
        this.trend = trend.items
        this.strengthDistribution = strength.distribution
        this.errorDistribution = errors
        this.weakSummary = weak
        this.calendar = calendar.items
        this.badges = badges
        this.plan = overview.today || this.plan
        return { overview, trend, strength, errors, weak, calendar, badges }
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.dashboard = false
      }
    },

    /** 主界面气泡彩蛋：最近学过的单词 */
    async loadRecentWords(limit = 8) {
      try {
        const data = await api.words.recent({ limit })
        this.recentWords = data.items
        return data
      } catch {
        this.recentWords = []
        return { items: [], empty: true, emptyHint: '先去背几个单词吧~' }
      }
    },

    async markArticleDone(done = true) {
      const data = await api.plan.markArticleDone(done)
      this.plan = data.plan
      return data.plan
    },

    async markGameDone(done = true) {
      const data = await api.plan.markGameDone(done)
      this.plan = data.plan
      return data.plan
    },

    /** 上报一局小游戏结果（不消耗 AI 额度） */
    async recordGame(payload) {
      const data = await api.games.record(payload)
      if (data.plan) this.plan = data.plan
      if (data.unlockedBadge) this.newBadges = [data.unlockedBadge]
      return data
    },

    /** 生成易混词对比卡片（纯算法，不需要 AI） */
    async loadWordContrast(wordId) {
      const data = await api.words.contrast(wordId)
      return data.card
    },

    clearNewBadges() {
      this.newBadges = []
    },

    clearError() {
      this.error = ''
    },
  },
})
