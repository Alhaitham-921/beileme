export const DEFAULT_WORD_SCENARIO = '请围绕所选单词设计一个自然的日常交流情景，帮助我练习使用这些词。'

export function scenarioRequestDescription(text, wordIds = []) {
  const brief = String(text || '').trim()
  if (brief.length > 1500) return { error: '对话需求请控制在 1500 个字以内。' }
  if (brief.length >= 10) return { description: brief }
  if (wordIds.length) return { description: brief ? `${brief}。${DEFAULT_WORD_SCENARIO}` : DEFAULT_WORD_SCENARIO, usesDefault: true }
  return { error: '请先选择 1–5 个单词，或填写至少 10 个字的对话需求，也可以点击下方示例。' }
}
