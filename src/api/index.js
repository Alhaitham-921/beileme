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
  generateArticle: (body) => http.post('/content/articles', { body }),
  generateQuiz: (body) => http.post('/content/quizzes', { body }),
  generateErrorCard: (body) => http.post('/content/error-cards', { body }),
  list: (query) => http.get('/content', { query }),
  detail: (id) => http.get(`/content/${id}`),
}

export const games = {
  record: (body) => http.post('/games/records', { body }),
  list: (query) => http.get('/games/records', { query }),
  summary: () => http.get('/games/summary'),
}

export const health = () => http.get('/health', { auth: false })

export default { auth, profile, words, study, plan, stats, content, games, health }
