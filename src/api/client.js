/**
 * 与后端通信的统一入口。
 *
 * 这一层负责三件事，页面和 store 都不用再操心：
 *  1. 自动带上登录令牌（Authorization 头）
 *  2. 令牌过期时自动续期并重放请求，用户无感
 *  3. 把后端的 { ok, data } / { ok, error } 统一拆包，失败一律抛 ApiError
 *
 * 令牌存在 localStorage 里，属于纯前端 SPA 的常规做法；
 * 代价是若页面被注入恶意脚本，令牌可能被读走，因此正式上线前建议改由后端下发
 * HttpOnly Cookie。这一点在当前阶段接受，但记录在此以免遗忘。
 */

const STORAGE_KEY = 'beileme:auth'

/**
 * 接口根地址。优先级：
 *  1. 运行时注入的 globalThis.__BEILEME_API_BASE__（单文件 HTML 部署时，前端与后端不同源，
 *     在页面里先设置这个变量即可，无需重新打包）
 *  2. 构建期的 VITE_API_BASE_URL
 *  3. 默认相对路径 /api/v1（开发环境由 Vite 代理转发，见 vite.config.js）
 *
 * 这里刻意做了「非浏览器环境」的兼容：import.meta.env 在 Node 下不存在，
 * 直接取属性会抛错，所以统一走可选链。
 */
const runtimeBase =
  typeof globalThis !== 'undefined' ? globalThis.__BEILEME_API_BASE__ : undefined
const envBase = import.meta.env?.VITE_API_BASE_URL

export let BASE_URL = String(runtimeBase || envBase || '/api/v1').replace(/\/+$/, '')

/** 供测试或宿主环境在运行时改写接口地址 */
export function setBaseUrl(url) {
  BASE_URL = String(url || '/api/v1').replace(/\/+$/, '')
}

/** localStorage 在 Node 与隐私模式下可能不可用，统一做兜底 */
function readStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** 是否为登录态失效 */
  get isAuthError() {
    return this.status === 401
  }

  /** 是否为网络层问题（后端没起来 / 断网） */
  get isNetworkError() {
    return this.status === 0
  }
}

function readStoredTokens() {
  const storage = readStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.accessToken ? parsed : null
  } catch {
    return null
  }
}

let tokens = readStoredTokens()
let refreshPromise = null
let authExpiredHandler = () => {}

export function getAccessToken() {
  return tokens?.accessToken || null
}

export function isLoggedIn() {
  return Boolean(tokens?.accessToken)
}

export function setTokens(next) {
  tokens = next && next.accessToken ? next : null
  const storage = readStorage()
  try {
    if (!storage) return
    if (tokens) storage.setItem(STORAGE_KEY, JSON.stringify(tokens))
    else storage.removeItem(STORAGE_KEY)
  } catch {
    // 隐私模式下 localStorage 可能不可写，此时退化为「仅当前会话有效」
  }
}

export function clearTokens() {
  setTokens(null)
}

/** 注册登录态失效的回调，由 auth store 用来跳转登录页 */
export function onAuthExpired(handler) {
  authExpiredHandler = typeof handler === 'function' ? handler : () => {}
}

function handleAuthExpired() {
  clearTokens()
  authExpiredHandler()
}

function buildUrl(path, query) {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.append(key, value)
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function parseBody(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** 用刷新令牌换新的访问令牌。并发请求只会真正刷新一次。 */
function ensureRefreshed() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = tokens?.refreshToken
      if (!refreshToken) throw new ApiError(401, 'UNAUTHORIZED', '登录状态已失效')

      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      const payload = await parseBody(response)

      if (!response.ok || payload?.ok === false) {
        throw new ApiError(401, payload?.error?.code || 'UNAUTHORIZED', '登录状态已失效')
      }
      setTokens(payload.data.tokens)
      return payload.data
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

/**
 * 发起请求并返回 data 部分。
 *
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} path 形如 '/study/sessions'（不含 /api/v1 前缀）
 * @param {{ body?:object, query?:object, auth?:boolean, retryOn401?:boolean }} [options]
 * @returns {Promise<any>}
 * @throws {ApiError}
 */
export async function request(method, path, options = {}) {
  const { body, query, auth = true, retryOn401 = true } = options

  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`

  let response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请确认后端已启动（npm run server）')
  }

  // 访问令牌可能已过期：先静默续期，再原样重放一次请求
  if (response.status === 401 && auth && retryOn401 && tokens?.refreshToken) {
    try {
      await ensureRefreshed()
    } catch {
      handleAuthExpired()
      throw new ApiError(401, 'UNAUTHORIZED', '登录状态已失效，请重新登录')
    }
    return request(method, path, { body, query, auth, retryOn401: false })
  }

  const payload = await parseBody(response)

  if (!response.ok || payload?.ok === false) {
    const error = payload?.error || {}
    if (response.status === 401 && auth) handleAuthExpired()
    throw new ApiError(
      response.status,
      error.code || 'UNKNOWN_ERROR',
      error.message || `请求失败（HTTP ${response.status}）`,
      error.details
    )
  }

  return payload?.data
}

export const http = {
  get: (path, options) => request('GET', path, options),
  post: (path, options) => request('POST', path, options),
  put: (path, options) => request('PUT', path, options),
  del: (path, options) => request('DELETE', path, options),
}

export default http
