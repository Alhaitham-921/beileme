import { buildAssessmentSynthesis } from './assessmentTrend.js'

export const ASSESSMENT_BASELINE_VERSION = 'assessment-history-v2'
const labels = { foundation: '高频基础', standard: '常规难度', challenge: '更有挑战' }
const percent = (correct, total) => total ? Math.round(correct / total * 100) : null
const keyOf = q => JSON.stringify([q.spelling.toLowerCase(), q.options[q.correctIndex]])
const dateOf = value => new Date(value).toISOString()

export function buildAssessmentBaseline({ session, history, learning = {}, totals = {} }) {
  const state = session.state, result = state.result
  const sameBook = history.filter(row => Number(row.state.bookId) === Number(state.bookId))
  const comparable = sameBook.filter(row => row.state.methodVersion === state.methodVersion &&
    (!state.questionSetVersion || !row.state.questionSetVersion || state.questionSetVersion === row.state.questionSetVersion))
  const used = [...comparable].sort((a, b) =>
    new Date(b.state.result.completedAt || b.completed_at) - new Date(a.state.result.completedAt || a.completed_at) || b.id - a.id).slice(0, 20)
  const previous = used[0]
  const current = { sessionId: Number(session.id), takenAt: dateOf(result.completedAt || session.completed_at),
    form: result.form, recommended: result.recommended, bands: result.bands,
    tested: result.bands.reduce((sum, band) => sum + band.tested, 0),
    correct: result.bands.reduce((sum, band) => sum + band.correct, 0),
    unsure: result.bands.reduce((sum, band) => sum + band.unsure, 0) }
  current.percent = percent(current.correct, current.tested)
  const comparisons = previous ? result.bands.map(band => {
    const before = previous.state.result.bands.find(item => item.level === band.level)
    const nowPercent = percent(band.correct, band.tested)
    const previousPercent = before ? percent(before.correct, before.tested) : null
    const change = previousPercent === null ? null : nowPercent - previousPercent
    return { level: band.level, current: band, previous: before || null,
      currentPercent: nowPercent, previousPercent, change,
      direction: change === null ? 'insufficient' : change > 0 ? 'higher' : change < 0 ? 'lower' : 'similar' }
  }) : []

  const oldWords = new Map()
  for (const row of used) {
    const seen = new Set()
    for (const answer of row.state.answers || []) {
      const q = answer.snapshot
      if (!q?.spelling || !q.options?.[q.correctIndex]) continue
      const key = keyOf(q)
      if (seen.has(key)) continue
      seen.add(key)
      if (!oldWords.has(key)) oldWords.set(key, { failures: 0, latestCorrect: answer.correct, sessions: [] })
      const record = oldWords.get(key)
      if (!answer.correct) { record.failures++; record.sessions.push(Number(row.id)) }
    }
  }
  const weakWords = [], improvedWords = []
  let missingSnapshots = 0
  for (const answer of state.answers || []) {
    const q = answer.snapshot
    if (!q?.spelling || !q.options?.[q.correctIndex]) { missingSnapshots++; continue }
    const record = oldWords.get(keyOf(q))
    const word = { spelling: q.spelling, meaning: q.options[q.correctIndex],
      wordId: q.dictionaryWordId || null, correct: answer.correct, unsure: answer.selectedIndex === -1,
      priorFailures: record?.failures || 0, sourceSessions: record?.sessions || [],
      purpose: answer.purpose || 'core' }
    if (!answer.correct) weakWords.push(word)
    else if (record?.failures) improvedWords.push(word)
  }
  weakWords.sort((a, b) => b.priorFailures - a.priorFailures)
  const repeatedWeakWords = weakWords.filter(word => word.priorFailures > 0)
  const historyRetest = result.historyRetest || []
  const facts = [{ id: 'current', label: '本次词义辨认', sessionIds: [current.sessionId],
    text: `本次 ${result.form} 卷计分题答对 ${current.correct}/${current.tested}，${current.unsure} 题不确定；建议从「${labels[result.recommended]}」试学。` }]
  if (previous) facts.push({ id: 'comparison', label: '前后自测比较', sessionIds: [Number(previous.id), current.sessionId],
    text: comparisons.map(item => `${labels[item.level]}：上次 ${item.previous?.correct ?? '—'}/${item.previous?.tested ?? '—'}，本次 ${item.current.correct}/${item.current.tested}`).join('；') + '。' })
  else facts.push({ id: 'comparison', label: '历史比较', sessionIds: [current.sessionId], text: '尚无同词书、同方法且题库版本可比较的历史自测，暂不能判断进步或退步。' })
  if (historyRetest.length) facts.push({ id: 'history-retest', label: '历史薄弱点复测', sessionIds: [current.sessionId, ...new Set(historyRetest.map(item => item.source?.sessionId).filter(Boolean))],
    text: `额外复测历史薄弱点 ${historyRetest.length} 题，答对 ${historyRetest.filter(item => item.correct).length} 题；这部分不计入分档比较。` })
  if (repeatedWeakWords.length) facts.push({ id: 'recurring', label: '反复出现的薄弱点',
    sessionIds: [...new Set([current.sessionId, ...repeatedWeakWords.flatMap(word => word.sourceSessions)])],
    text: `${repeatedWeakWords.length} 个词义在历史和本次自测都未答出：${repeatedWeakWords.slice(0, 5).map(word => `${word.spelling}（${word.meaning}）`).join('、')}。` })
  if (improvedWords.length) facts.push({ id: 'recovered', label: '本次重新答出', sessionIds: [current.sessionId],
    text: `${improvedWords.length} 个过去未答出的词义本次答对，需继续用延迟回忆检验稳定性。` })
  const study = learning.study || { total: 0, correct: 0, words: 0 }
  const collocations = learning.collocations || { total: 0, correct: 0, unknown: 0 }
  const recall = learning.recall || { total: 0, independent: 0, hinted: 0, weak: 0 }
  const synthesis = buildAssessmentSynthesis({ session, history: used, learning: { study, collocations, recall } })
  for (const trend of synthesis.trends) facts.push({ id: `trend-${trend.level}`, label: `${labels[trend.level]}多次趋势`,
    sessionIds: trend.points.map(point => point.sessionId), text: trend.text })
  facts.push({ id: 'synthesis', label: '综合学习建议',
    sessionIds: synthesis.daily.map(item => item.sessionId), text: `${synthesis.title}。${synthesis.detail}` })
  facts.push({ id: 'study', label: '近期日常学习与复习', sessionIds: [],
    text: study.total ? `测试完成前近三十天，日常学习与复习共 ${study.total} 次作答，答对 ${study.correct} 次，涉及 ${study.words} 个词。` : '测试完成前近三十天暂无当前词书的日常学习与复习记录。' })
  facts.push({ id: 'collocations', label: '搭配运用', sessionIds: [],
    text: collocations.total ? `同期搭配填空 ${collocations.total} 次，答对 ${collocations.correct} 次，${collocations.unknown} 次想不起来。` : '同期暂无当前词书的搭配练习记录，暂不能判断搭配运用能力。' })
  facts.push({ id: 'recall', label: '延迟回忆', sessionIds: [],
    text: recall.total ? `同期已完成的延迟复测 ${recall.total} 次，独立答出 ${recall.independent} 次，提示后答出 ${recall.hinted} 次，未答出 ${recall.weak} 次。` : '同期暂无当前词书已完成的延迟复测，暂不能判断记忆是否稳定。' })
  const recommendations = []
  if (weakWords.length) recommendations.push({ id: 'weak-words', title: '先巩固本次薄弱词',
    detail: repeatedWeakWords.length ? '优先练习历史和本次都未答出的词义，再处理本次新出现的错词。' : '先练习本次答错或不认识的词，再换卷检查。',
    to: '/notebooks?source=mistakes', wordIds: [...new Set(weakWords.map(word => word.wordId).filter(Boolean))] })
  if (!collocations.total || collocations.correct < collocations.total) recommendations.push({ id: 'collocations', title: '练习短语搭配',
    detail: collocations.total ? '把能辨认的词放进短语里，重点复习未答出的搭配。' : '补充搭配练习记录，检查能否把词用进常用短语。', to: '/collocations' })
  recommendations.push({ id: 'recall', title: '检查隔天能否答出',
    detail: recall.total ? '继续到期复测，观察能否不靠提示独立答出。' : '先练错词，再在到期日做延迟复测。', to: '/recall' })
  if (!weakWords.length) recommendations.push({ id: 'study', title: '按建议档位试学', detail: '结合实际学习和后续复测，再决定是否调整学习起点。', to: '/' })
  if (synthesis.recommendedLevel) recommendations.push({ id: 'study-start', title: '采用综合起点建议',
    detail: synthesis.detail, level: synthesis.recommendedLevel, to: '/' })
  const limitations = ['分档来自少量词义辨认题；不同试卷尚未经正式等值校准，前后变化只作参考，不能换算成精确词汇量或认定长期掌握。',
    '日常作答、搭配和延迟回忆分别呈现；练习次数及一次答对不等于掌握。']
  if (!previous) limitations.push('历史不足，暂不判断进步或退步。')
  if (missingSnapshots || used.some(row => (row.state.answers || []).some(answer => !answer.snapshot)))
    limitations.push('部分旧测试没有完整题目快照，保留其分档统计；不推断具体错词，也不将旧题编号当作词库编号。')
  if (Number(totals.otherBook || 0) || Number(totals.otherVersion || 0)) limitations.push('其他词书或不同测试版本的记录单独保留，不直接参与分数比较。')
  return { version: ASSESSMENT_BASELINE_VERSION, sessionId: current.sessionId, book: { id: Number(state.bookId), name: state.bookName },
    asOf: current.takenAt, current, previous: previous ? { sessionId: Number(previous.id), takenAt: dateOf(previous.completed_at), form: previous.state.form } : null,
    comparisons, history: { usedTests: used.length, window: 20, ...totals,
      tests: used.map(row => ({ sessionId: Number(row.id), takenAt: dateOf(row.completed_at), form: row.state.form })) },
    weakWords, repeatedWeakWords, improvedWords, historyRetest,
    learning: { days: 30, study, collocations, recall }, synthesis, facts, recommendations, limitations }
}
