/**
 * 接口清单。页面与 store 只调用这里的函数，不直接拼 URL，
 * 这样后端调整路径时只需改一处。
 */
import http from './client.js'

export const auth = {
  register: (body) => http.post('/auth/register', { body, auth: false }),
  login: (body) => http.post('/auth/login', { body, auth: false }),
  refresh: (refreshToken) => http.post('/auth/refresh', { body: { refreshToken }, auth: false }),
  logout: () => http.post('/auth/logout'),
  me: () => http.get('/auth/me'),
  changePassword: (body) => http.post('/auth/password', { body }),
}

export const profile = {
  get: () => http.get('/profile'),
  update: (body) => http.put('/profile', { body }),
  completeOnboarding: (body) => http.post('/profile/onboarding', { body }),
  wordbooks: () => http.get('/profile/wordbooks'),
}

export const words = {
  books: () => http.get('/words/books'),
  listByBook: (code, query) => http.get(`/words/books/${code}/words`, { query }),
  detail: (id) => http.get(`/words/${id}`),
  related: (id, query) => http.get(`/words/${id}/related`, { query }),
  /** 对比记忆卡片（纯算法生成，不消耗 AI 额度） */
  contrast: (id) => http.get(`/words/${id}/contrast`),
  /** 最近学过的词，供主界面气泡彩蛋使用 */
  recent: (query) => http.get('/words/recent', { query }),
}

export const study = {
  createSession: (kind = 'daily') => http.post('/study/sessions', { body: { kind } }),
  /** 针对指定单词开一轮「错词重练」，不受每日计划限制 */
  createReviewSession: (wordIds) => http.post('/study/review-sessions', { body: { wordIds } }),
  /** 今日错词 + 今日生成的短文（回顾页用） */
  reviewToday: () => http.get('/study/review/today'),
  getSession: (id) => http.get(`/study/sessions/${id}`),
  /**
   * 提交作答。只上报所选选项下标，由服务端判定对错，
   * 因此不要试图在前端推算答案。
   */
  answer: (sessionId, body) => http.post(`/study/sessions/${sessionId}/answers`, { body }),
  finish: (sessionId) => http.post(`/study/sessions/${sessionId}/finish`),
  errorDigest: (query) => http.get('/study/errors/digest', { query }),
}

export const plan = {
  today: () => http.get('/plan/today'),
  adjustmentPrompt: () => http.get('/plan/today/prompt'),
  adjust: (reason) => http.post('/plan/adjust', { body: { reason } }),
  calendar: (query) => http.get('/plan/calendar', { query }),
  markArticleDone: (done = true) => http.post('/plan/today/article', { body: { done } }),
  markGameDone: (done = true) => http.post('/plan/today/game', { body: { done } }),
}

export const stats = {
  overview: () => http.get('/stats/overview'),
  trend: (query) => http.get('/stats/trend', { query }),
  strength: () => http.get('/stats/strength'),
  errors: (query) => http.get('/stats/errors', { query }),
  weakSummary: (query) => http.get('/stats/weak-summary', { query }),
  hourly: (query) => http.get('/stats/hourly', { query }),
  badges: () => http.get('/stats/badges'),
}

export const content = {
  quota: () => http.get('/content/quota'),
  /** 生成前预估：本地算 token，不调用模型，成本为 0 */
  preflight: (body) => http.post('/content/preflight', { body }),
  generateArticle: (body) => http.post('/content/articles', { body }),
  generateQuiz: (body) => http.post('/content/quizzes', { body }),
  /** 批量生成易错词卡片：一次请求覆盖多个词，比逐词调用省得多 */
  generateErrorCards: (body) => http.post('/content/error-cards', { body }),
  list: (query) => http.get('/content', { query }),
  detail: (id) => http.get(`/content/${id}`),
}

/**
 * AI 设置与用量。
 * Key 的明文永远不会回传，列表里只有打码值，用于确认「我填过哪一个」。
 */
export const ai = {
  status: () => http.get('/ai/status'),
  usage: (query) => http.get('/ai/usage', { query }),
  providers: () => http.get('/ai/providers'),
  listKeys: () => http.get('/ai/keys'),
  /** 拉取账号可用模型列表（只调 /models，不消耗 token），用于做模型下拉选择 */
  listModels: (body) => http.post('/ai/models', { body }),
  /** 只校验不保存：可以在不留下记录的前提下反复调试 Key / 地址 / 模型名 */
  verifyKey: (body) => http.post('/ai/keys/verify', { body }),
  /** 保存前服务端会先分步校验；填错了会返回 400 AI_KEY_UNVERIFIED，details 里含诊断过程 */
  saveKey: (body) => http.put('/ai/keys', { body }),
  deleteKey: (id) => http.del(`/ai/keys/${id}`),
  /** 用最小请求测试当前生效的 Key，成本几乎为 0 */
  testKey: () => http.post('/ai/keys/test'),
  /** token 额度：读取当前生效值 + 可选档位 + 实测参考值 */
  limits: () => http.get('/ai/limits'),
  /** 套用档位。可直接传 { preset: 'frugal' | 'balanced' | 'quality' } */
  saveLimits: (body) => http.put('/ai/limits', { body }),
  resetLimits: () => http.post('/ai/limits/reset'),
}

export const games = {
  record: (body) => http.post('/games/records', { body }),
  list: (query) => http.get('/games/records', { query }),
  summary: () => http.get('/games/summary'),
}

export const health = () => http.get('/health', { auth: false })

export default { auth, profile, words, study, plan, stats, content, ai, games, health }
