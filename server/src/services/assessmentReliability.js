import { normalizeSense } from './wordLearningEvidence.js'

const questionKey = answer => {
  const q = answer.snapshot
  return q?.spelling && q.options?.[q.correctIndex]
    ? JSON.stringify([q.spelling.normalize('NFKC').toLowerCase(), normalizeSense(q.options[q.correctIndex])]) : null
}

export function assessReliability(session, history, wordHistory) {
  const known = new Set(history.flatMap(row => (row.state.answers || []).map(questionKey).filter(Boolean)))
  const answers = (session.state.answers || []).filter(answer => (answer.purpose || 'core') === 'core')
  const identifiable = answers.filter(answer => questionKey(answer))
  const repeated = identifiable.filter(answer => known.has(questionKey(answer)))
  const fresh = identifiable.filter(answer => !known.has(questionKey(answer)))
  const forms = ['A','B'].map(form => {
    const rows = [...history, session].filter(row => row.state.form === form)
    const tested = rows.reduce((sum, row) => sum + row.state.result.bands.reduce((n, b) => n + b.tested, 0), 0)
    const correct = rows.reduce((sum, row) => sum + row.state.result.bands.reduce((n, b) => n + b.correct, 0), 0)
    return { form, tests: rows.length, tested, correct, percent: tested ? Math.round(correct / tested * 100) : null }
  })
  const supported = wordHistory.supportedImprovements
  const status = supported.length ? 'word-evidence' : 'test-scores-only'
  const text = supported.length
    ? `${supported.length} 个具体词义在曾经答错后，本次辨认正确，并有至少两个不同日期、间隔至少24小时且更换语境的独立回忆记录支持改善；仅针对这些词义，仍需继续观察。`
    : '当前只能描述自测成绩变化，尚缺同词同义项的跨日独立回忆支持，不据此认定学习能力或长期记忆提高。'
  const warnings = ['A/B卷尚未完成真实人群的等值校准。以下分卷统计来自你自己的作答，不能用来证明两卷难度相同。',
    '独立回忆支持条件是产品提示规则，不能替代真实学习效果研究或标准化能力测评。',
    '未在最近二十次可比较测试出现的题目，也可能已在日常学习中见过；不是严格的全新词测试。']
  if (repeated.length) warnings.push(`本次 ${repeated.length}/${identifiable.length} 道可识别计分题曾在上述历史出现，可能受熟悉题目影响。`)
  if (identifiable.length < answers.length) warnings.push('部分题目缺少完整快照，无法核对是否重复，不将它们归为新题。')
  return { version: 'assessment-reliability-v1', status, text, supportedWords: supported,
    total: answers.length, identifiable: identifiable.length, repeated: repeated.length,
    repeatedCorrect: repeated.filter(answer => answer.correct).length, fresh: fresh.length,
    freshCorrect: fresh.filter(answer => answer.correct).length, forms, warnings, calibrated: false }
}
