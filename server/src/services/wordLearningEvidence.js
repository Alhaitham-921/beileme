import { businessDate } from '../utils/time.js'
export { recordWordEvidence, loadWordEvidence } from '../repositories/learningEvidenceRepository.js'

export const normalizeSense = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

const names = { assessment: '自测辨义', study: '日常辨义', collocation: '搭配填空', recall: '独立回忆', image: '看图辨义', dialogue: '情境使用', dialogue_quiz: '情境小结巩固' }
function channels(events) {
  return Object.entries(names).flatMap(([source, label]) => {
    const rows = events.filter(row => row.source === source)
    if (!rows.length) return []
    return [{ source, label, total: rows.length, correct: rows.filter(row => ['correct','independent'].includes(row.result)).length,
      hinted: rows.filter(row => row.result === 'hinted').length, skipped: rows.filter(row => row.result === 'skipped').length,
      latest: rows.at(-1).result }]
  })
}

export function buildWordHistory(session, history, practiceEvents = []) {
  const answers = session.state.answers || []
  const targets = new Map()
  for (const answer of answers) {
    const q = answer.snapshot, wordId = Number(q?.dictionaryWordId)
    if (!wordId || !q?.options?.[q.correctIndex]) continue
    if (!targets.has(wordId)) targets.set(wordId, { wordId, spelling: q.spelling, senses: new Map() })
    targets.get(wordId).senses.set(normalizeSense(q.options[q.correctIndex]), q.options[q.correctIndex])
  }
  const cutoff = new Date(session.state.result.completedAt || session.completed_at).getTime()
  const events = practiceEvents.filter(event => new Date(event.at).getTime() <= cutoff)
  for (const row of [...history, session]) for (const answer of row.state.answers || []) {
    const q = answer.snapshot, wordId = Number(q?.dictionaryWordId)
    if (!targets.has(wordId) || !q?.options?.[q.correctIndex]) continue
    events.push({ wordId, sense: q.options[q.correctIndex], source: 'assessment', sourceKey: `${row.id}:${q.wordId}`,
      result: answer.correct ? 'correct' : 'incorrect', details: { sessionId: Number(row.id) },
      at: new Date(row.state.result.completedAt || row.completed_at).toISOString() })
  }
  events.sort((a, b) => a.at.localeCompare(b.at))
  const byWord=new Map()
  for(const event of events){
    const rows=byWord.get(event.wordId)||[];rows.push(event);byWord.set(event.wordId,rows)
  }
  const words = [...targets.values()].map(target => {
    const rows = byWord.get(target.wordId)||[]
    const bySense=new Map()
    for(const event of rows)if(event.sense){
      const key=normalizeSense(event.sense),matching=bySense.get(key)||[];matching.push(event);bySense.set(key,matching)
    }
    const senses = [...target.senses].map(([key, sense]) => {
      const matching = bySense.get(key)||[]
      const stats = channels(matching)
      const assessment = stats.find(item => item.source === 'assessment')
      const recall = stats.find(item => item.source === 'recall')
      const weak = stats.filter(item => ['incorrect','unknown','needs-practice','hinted','skipped','assisted','weak'].includes(item.latest))
      const previouslyWrong = matching.some(event => event.source === 'assessment' && event.result === 'incorrect')
      const lastFailure = matching.filter(event => ['assessment','recall'].includes(event.source) &&
        !['correct','independent'].includes(event.result)).at(-1)?.at
      const delayed = matching.filter((event, index) => event.source === 'recall' && event.result === 'independent' &&
        !event.details?.legacy && event.details?.mode === 'retest' && event.details?.changedContext && index > 0 &&
        (!lastFailure || event.at > lastFailure) &&
        new Date(event.at) - new Date(matching[index - 1].at) >= 86400000)
      const delayedDays = new Set(delayed.map(event => businessDate(new Date(event.at)))).size
      const state = weak.length ? 'needs-practice' : delayedDays >= 2 ? 'delayed-evidence' : assessment?.latest === 'correct' ? 'recognition-only' : 'insufficient'
      const label = state === 'needs-practice' ? '仍有待巩固的练习' : state === 'delayed-evidence' ? '已有跨日独立回忆依据'
        : state === 'recognition-only' ? '本次能辨认，独立使用仍待验证' : '证据不足'
      return { sense, channels: stats, state, label, delayedDays,
        improvementSupported: previouslyWrong && assessment?.latest === 'correct' && delayedDays >= 2 && !weak.length,
        timeline: matching.slice(-12).map(({ source, result, at, details }) => ({ source, label: names[source], result, at,
          mode: details?.mode, changedContext: Boolean(details?.changedContext) })) }
    })
    const known = new Set(target.senses.keys())
    return { wordId: target.wordId, spelling: target.spelling, senses,
      unscoped: channels(rows.filter(event => !event.sense)),
      otherSenses: [...new Set(rows.filter(event => event.sense && !known.has(normalizeSense(event.sense))).map(event => event.sense))] }
  })
  words.sort((a, b) => Number(b.senses.some(s => s.state === 'needs-practice')) - Number(a.senses.some(s => s.state === 'needs-practice')))
  return { words, supportedImprovements: words.flatMap(word => word.senses.filter(s => s.improvementSupported).map(s => ({ wordId: word.wordId, spelling: word.spelling, sense: s.sense }))),
    scope: '仅关联当前测试词。义项按保存的明确文本匹配；未标义项的旧记录单独呈现，不合并推断。辨义、搭配、回忆和看图分别统计，一次答对不代表长期掌握。' }
}
