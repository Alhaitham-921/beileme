import { defineStore } from 'pinia'
import api from '../api'

/**
 * AI 内容与设置。
 *
 * 这里最重要的设计原则是：**任何一次生成都必须由用户显式点击触发**。
 * 不自动生成、不后台预生成——省钱的最后一道防线就是「别偷偷调用」。
 * 所以每个生成 action 都是被按钮直接调用的，没有在 mounted 里自动跑的。
 */
export const useAiStore = defineStore('ai', {
  state: () => ({
    /** GET /ai/status 的结果：模式、额度、Key 列表、用量、定价 */
    status: null,
    /** 生成前的本地预估 */
    preflight: null,
    /** 当前展示的短文 */
    article: null,
    articleSource: null,
    articleMessage: '',
    /** 当前展示的理解题 */
    quiz: null,
    quizAnswers: {},
    /** 当前展示的错词卡片 */
    cards: [],
    cardsSource: null,
    cardsMessage: '',

    loading: { status: false, generate: false, saveKey: false, test: false, models: false, limits: false },
    /** 该用户实际生效的 token 额度 */
    limits: null,
    /** 可选的档位、系统推荐值与实测参考值 */
    limitOptions: null,
    activePreset: null,
    /** 最近一次 Key 校验的诊断结果（含每一步是否成功、可用模型列表） */
    verifyResult: null,
    /** 从服务商拉到的可用模型列表，供下拉选择 */
    availableModels: [],
    modelsError: '',
    modelSuggestion: '',
    modelCorrected: false,
    /** 最近一次生成的真实用量（token 与估算成本），界面直接展示 */
    lastUsage: null,

    error: '',
  }),

  getters: {
    /** 'user' | 'server' | 'none' */
    mode: (state) => state.status?.mode || 'none',
    isConfigured: (state) => (state.status?.mode || 'none') !== 'none',
    activeLabel: (state) => state.status?.activeProvider?.label || '未配置',
    keys: (state) => state.status?.keys || [],
    providers: (state) => state.status?.providers || [],
    todayUsage: (state) => state.status?.usage || {},
    monthTotals: (state) => state.status?.summary?.totals || { used: 0, cached: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 },
    zeroCostFeatures: (state) => state.status?.zeroCostFeatures || [],
    /** 短文正文里把 **word** 拆出来做高亮 */
    articleSegments: (state) => {
      const body = state.article?.body || ''
      return body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((piece) => {
        const matched = /^\*\*([^*]+)\*\*$/.exec(piece)
        return matched ? { text: matched[1], highlight: true } : { text: piece, highlight: false }
      })
    },
    quizQuestions: (state) => {
      if (!state.quiz?.body) return []
      try {
        const parsed = JSON.parse(state.quiz.body)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    },
  },

  actions: {
    async loadStatus() {
      this.loading.status = true
      this.error = ''
      try {
        this.status = await api.ai.status()
        return this.status
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.status = false
      }
    },

    /** 保存自带 Key。服务端会先分步校验，失败抛 AI_KEY_UNVERIFIED（details 含诊断过程） */
    async saveKey(payload) {
      this.loading.saveKey = true
      this.verifyResult = null
      try {
        const result = await api.ai.saveKey(payload)
        this.verifyResult = result.test
        await this.loadStatus()
        return result
      } catch (error) {
        // 把服务端返回的诊断过程留下来，界面上要展示「哪一步失败了、可用模型有哪些」
        this.verifyResult = error.details || null
        throw error
      } finally {
        this.loading.saveKey = false
      }
    },

    /** 只校验不保存 */
    async verifyKey(payload) {
      this.loading.test = true
      this.verifyResult = null
      try {
        const result = await api.ai.verifyKey(payload)
        this.verifyResult = result.test
        // 校验过程中如果拿到了模型列表，就直接拿来填下拉框
        if (result.test?.availableModels?.length) {
          this.availableModels = result.test.availableModels
        }
        return result
      } catch (error) {
        this.verifyResult = error.details || null
        throw error
      } finally {
        this.loading.test = false
      }
    },

    /**
     * 拉取账号可用模型列表（不消耗 token）。
     * 有了它就不需要用户手打模型名——手打极易出现大小写或拼写错误。
     */
    async loadModels(payload) {
      this.loading.models = true
      this.modelsError = ''
      try {
        const result = await api.ai.listModels(payload)
        if (result.ok) {
          this.availableModels = result.models
          this.modelSuggestion = result.suggested || ''
          this.modelCorrected = Boolean(result.corrected)
        } else {
          this.availableModels = []
          this.modelsError = result.message
        }
        return result
      } catch (error) {
        this.modelsError = error.message
        return { ok: false, message: error.message }
      } finally {
        this.loading.models = false
      }
    },

    async deleteKey(id) {
      await api.ai.deleteKey(id)
      await this.loadStatus()
    },

    async testKey() {
      this.loading.test = true
      try {
        const result = await api.ai.testKey()
        await this.loadStatus()
        return result
      } finally {
        this.loading.test = false
      }
    },

    /** 读取当前生效的 token 额度与可选项 */
    async loadLimits() {
      this.loading.limits = true
      try {
        const data = await api.ai.limits()
        this.limits = data.limits
        this.limitOptions = {
          recommended: data.recommended,
          bounds: data.bounds,
          presets: data.presets,
          measured: data.measured,
          thinking: data.thinking,
        }
        return data
      } finally {
        this.loading.limits = false
      }
    },

    /** 套用档位（frugal / balanced / quality） */
    async applyLimitPreset(preset) {
      this.loading.limits = true
      try {
        const data = await api.ai.saveLimits({ preset })
        this.limits = data.limits
        this.activePreset = preset
        return data.limits
      } finally {
        this.loading.limits = false
      }
    },

    /** 逐项调整；传 null 表示该字段恢复推荐值 */
    async saveLimits(patch) {
      this.loading.limits = true
      try {
        const data = await api.ai.saveLimits(patch)
        this.limits = data.limits
        this.activePreset = null
        return data.limits
      } finally {
        this.loading.limits = false
      }
    },

    async resetLimits() {
      this.loading.limits = true
      try {
        const data = await api.ai.resetLimits()
        this.limits = data.limits
        this.activePreset = null
        return data.limits
      } finally {
        this.loading.limits = false
      }
    },

    /**
     * 是否允许模型先做内部思考。
     * 默认关闭：实测允许思考时有 3/3 次把整个输出额度花在思考上、正文一个字都没写出来，
     * 而且这些 token 照常计费。关掉之后同一篇短文平均只用约 410 输出 token。
     */
    async setAllowThinking(allowThinking) {
      return this.saveLimits({ allowThinking })
    },

    /** 生成前预估：本地完成，不产生任何费用 */
    async loadPreflight({ type = 'article', wordIds, wordCount, limit, boost } = {}) {
      try {
        const result = await api.content.preflight({ type, wordIds, wordCount, limit, boost })
        // 只有不带加码的预估才写进主状态，避免「加码价格」覆盖掉常规价格
        if (!boost || boost === 1) this.preflight = result
        return result
      } catch {
        if (!boost || boost === 1) this.preflight = null
        return null
      }
    },

    /** 打开一篇历史短文（来自「短文回顾」），不产生任何费用 */
    async loadContent(id) {
      this.loading.generate = true
      this.error = ''
      try {
        const data = await api.content.detail(id)
        this.article = data.content
        this.articleSource = 'history'
        this.articleMessage = ''
        // 历史短文可能在别的会话里出过题，这里从零开始
        this.quiz = null
        this.quizAnswers = {}
        return data.content
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.generate = false
      }
    },

    async generateArticle({ wordIds, wordCount = 10, forceNew = false, boost = 1 } = {}) {
      this.loading.generate = true
      this.error = ''
      try {
        const result = await api.content.generateArticle({ wordIds, wordCount, forceNew, boost })
        this.article = result.content
        this.articleSource = result.source
        this.articleMessage = result.message || ''
        this.lastUsage = result.usage || null
        this.quiz = null
        this.quizAnswers = {}
        await this.loadStatus().catch(() => {})
        return result
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.generate = false
      }
    },

    async generateQuiz({ count = 3 } = {}) {
      if (!this.article?.id) return null
      this.loading.generate = true
      try {
        const result = await api.content.generateQuiz({ articleId: this.article.id, count })
        this.quiz = result.content
        this.quizAnswers = {}
        this.quizSuggestions = result.suggestions || []
        this.quizMessage = result.message || ''
        await this.loadStatus().catch(() => {})
        return result
      } finally {
        this.loading.generate = false
      }
    },

    /** 批量生成错词卡片：一次请求覆盖多个词 */
    async generateErrorCards({ wordIds, limit = 6, forceNew = false } = {}) {
      this.loading.generate = true
      this.error = ''
      try {
        const result = await api.content.generateErrorCards({ wordIds, limit, forceNew })
        this.cards = result.cards || []
        this.cardsSource = result.source
        this.cardsMessage = result.message || ''
        this.lastUsage = result.usage || null
        await this.loadStatus().catch(() => {})
        return result
      } catch (error) {
        this.error = error.message
        throw error
      } finally {
        this.loading.generate = false
      }
    },

    answerQuiz(index, optionIndex) {
      this.quizAnswers = { ...this.quizAnswers, [index]: optionIndex }
    },

    clearArticle() {
      this.article = null
      this.articleSource = null
      this.articleMessage = ''
      this.quiz = null
      this.quizAnswers = {}
    },

    clearCards() {
      this.cards = []
      this.cardsSource = null
      this.cardsMessage = ''
    },
  },
})
