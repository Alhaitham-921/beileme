import { shallowRef } from 'vue'

export const latestAiUsage = shallowRef(null)

export function publishAiUsage(path, data, error) {
  const usage = error?.details?.usage || data?.lastUsage || data?.usage || data?.feedback?.usage
  if (usage && typeof usage.promptTokens === 'number') {
    latestAiUsage.value = { ...usage, label: path.includes('practice') ? '情境练习' : path.includes('quiz') ? '阅读理解题' : path.includes('error-card') ? '错因卡片' : path.includes('summary') ? '薄弱点小结' : 'AI 内容', failed: Boolean(error) }
  } else if (data?.cached || data?.source === 'template') {
    latestAiUsage.value = { promptTokens: 0, completionTokens: 0, label: data?.cached ? '读取缓存' : '本地复习内容', unknownCalls: data?.degradedReason && data.degradedReason !== 'not_configured' ? 1 : 0 }
  }
}
