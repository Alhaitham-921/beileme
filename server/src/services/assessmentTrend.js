import { businessDate } from '../utils/time.js'

const labels = { foundation: '高频基础', standard: '常规难度', challenge: '更有挑战' }
const thresholds = { foundation: 0.75, standard: 0.75, challenge: 0.5 }
const rate = band => band?.tested > 0 ? band.correct / band.tested : null
const titles = {
  insufficient: '历史不足', rising: '跨次上升', falling: '跨次下降', fluctuating: '有升有降',
  similar: '表现相近', 'recent-rise': '近期上升', 'recent-fall': '近期下降',
}

function record(row) {
  const result = row.state.result
  const takenAt = new Date(result.completedAt || row.completed_at).toISOString()
  return { sessionId: Number(row.id), takenAt, day: businessDate(new Date(takenAt)),
    form: result.form, recommended: result.recommended, bands: result.bands }
}

export function buildAssessmentSynthesis({ session, history, learning }) {
  const series = [...history.map(record), record(session)].sort((a, b) =>
    a.takenAt.localeCompare(b.takenAt) || a.sessionId - b.sessionId)
  // Repeated drills on the same day remain in history; only its latest result enters the trend.
  const days = new Map(series.map(item => [item.day, item]))
  const daily = [...days.values()].slice(-5)
  const trends = Object.keys(labels).map(level => {
    const points = daily.flatMap(item => {
      const band = item.bands.find(band => band.level === level)
      return rate(band) === null ? [] : [{ sessionId: item.sessionId, takenAt: item.takenAt,
        form: item.form, tested: band.tested, correct: band.correct, rate: rate(band) }]
    })
    const changes = points.slice(1).map((point, index) => point.rate - points[index].rate)
    const up = changes.filter(value => value > 1e-9).length
    const down = changes.filter(value => value < -1e-9).length
    const status = points.length < 3 ? 'insufficient'
      : up && down ? 'fluctuating' : up >= 2 ? 'rising' : down >= 2 ? 'falling'
        : up ? 'recent-rise' : down ? 'recent-fall' : 'similar'
    const belowReference = points.length >= 3 && points.slice(-3).every(point => point.rate < thresholds[level])
    const text = points.length < 3
      ? `${labels[level]}：可比较记录不足三个测试日，暂不判断持续进步或退步。`
      : `${labels[level]}：最近 ${points.length} 个测试日依次答对 ${points.map(point => `${point.correct}/${point.tested}`).join(' → ')}，${titles[status]}${belowReference ? '；最近三个测试日均低于本档试学参考线' : ''}。`
    return { level, status, title: titles[status], points, belowReference, text }
  })
  const enoughHistory = daily.length >= 3 && trends.every(trend => trend.points.length >= 3)
  const recent = daily.slice(-3)
  const latest = series.at(-1)
  const recentSupport = recent.filter(item => item.recommended === latest.recommended).length
  const flags = []
  const { study, collocations, recall } = learning
  const missingEvidence = [!study.total && '日常学习', !collocations.total && '搭配', !recall.total && '延迟回忆'].filter(Boolean)
  if (study.total >= 10 && study.correct / study.total < 0.55) flags.push('study')
  if (collocations.total >= 5 && collocations.correct / collocations.total < 0.6) flags.push('collocations')
  if (recall.total >= 5 && recall.independent / recall.total < 0.6) flags.push('recall')
  const unstable = trends.some(trend => ['fluctuating', 'falling', 'recent-fall'].includes(trend.status))
  const decision = !enoughHistory ? 'insufficient' : flags.length ? 'consolidate'
    : recentSupport >= 2 && !unstable ? 'supported' : 'observe'
  const recommendedLevel = decision === 'supported' ? latest.recommended : null
  const evidenceIds = ['trend-foundation', 'trend-standard', 'trend-challenge', ...flags]
  const titlesByDecision = { insufficient: '先试学，继续积累依据', consolidate: '优先巩固练习中的薄弱项',
    supported: `近期记录支持从「${labels[recommendedLevel]}」试学`, observe: '近期表现有变化，先观察实际学习' }
  const detail = decision === 'insufficient'
    ? '跨日记录还不足，可先参考本次结果或自选起点开始学习；后续是否自测由你决定。'
    : decision === 'consolidate'
      ? '多次自测已可比较，但近期日常学习、搭配或延迟回忆仍有待巩固。先完成对应练习，再观察实际表现。'
      : decision === 'supported'
        ? `最近三个测试日中有 ${recentSupport} 次建议与本次一致，可以自愿采用这个起点继续试学。${missingEvidence.length ? `尚缺${missingEvidence.join('、')}记录，暂不据此判断这些方面的能力。` : '搭配和延迟回忆仍按各自记录继续观察。'}`
        : '多次结果存在波动或本次建议尚未获得近期记录支持，暂不据此切换起点；可按熟悉的档位学习，再观察实际表现。'
  const priorityActions = flags.filter(id => id !== 'study')
  return { version: 'assessment-synthesis-v1', series, daily, trends, testDays: daily.length,
    enoughHistory, decision, recommendedLevel, recentSupport, flags, missingEvidence, evidenceIds,
    title: titlesByDecision[decision], detail, priorityActions,
    scope: '趋势取最近五个测试日，每天只用最后一次；至少三个测试日才描述持续变化。试学参考线和练习提示是产品规则，不是已校准的能力标准。' }
}
