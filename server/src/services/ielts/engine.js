import { badRequest } from '../../utils/errors.js'

export const SKILLS = ['listening', 'reading', 'writing', 'speaking']
export const SKILL_NAMES = { listening: '听力', reading: '阅读', writing: '写作', speaking: '口语' }
export const OBJECTIVE_TYPES = ['single', 'multiple', 'completion', 'matching', 'true_false', 'yes_no', 'headings', 'map', 'diagram', 'short_answer']
export const wordCount = text => String(text || '').trim().split(/\s+/u).filter(Boolean).length
export const normalizeAnswer = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')

export function gradeQuestion(question, answer) {
  if (question.type === 'essay' || question.type === 'spoken') return null
  if (question.type === 'multiple') {
    const selected = Array.isArray(answer) ? [...new Set(answer.map(normalizeAnswer))].sort() : []
    const expected = [...new Set(question.answer.map(normalizeAnswer))].sort()
    return selected.length === expected.length && selected.every((a, i) => a === expected[i])
  }
  if (Array.isArray(answer) || (answer !== null && typeof answer === 'object')) return false
  const normalized = normalizeAnswer(answer)
  if (!normalized || (question.maxWords && wordCount(normalized) > question.maxWords)) return false
  // Accepted spelling variants are explicit author data; no fuzzy matching for exam marks.
  return (Array.isArray(question.answer) ? question.answer : [question.answer]).some(a => normalizeAnswer(a) === normalized)
}

export function validateAnswers(paper, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw badRequest('答案格式不正确')
  const ids = new Map(paper.questions.map(q => [q.id, q]))
  for (const [id, value] of Object.entries(answers)) {
    const q = ids.get(id)
    if (!q) throw badRequest('答案包含不属于本试卷的题号')
    if (q.type === 'multiple') {
      if (!Array.isArray(value) || value.length > 20 || value.some(v => typeof v !== 'string' || v.length > 200)) throw badRequest('多选答案格式不正确')
    } else if (typeof value !== 'string' || value.length > (q.type === 'essay' ? 30000 : q.type === 'spoken' ? 15000 : 500)) {
      throw badRequest('答案类型或长度不正确')
    }
  }
  return answers
}

export function validatePaper(paper) {
  if (!paper || !SKILLS.includes(paper.skill) || typeof paper.title !== 'string' || !paper.title.trim() || paper.title.length > 190) throw badRequest('试卷标题或科目不正确')
  if (!Number.isInteger(paper.durationSeconds) || paper.durationSeconds < 60 || paper.durationSeconds > 7200) throw badRequest('试卷时长应为 60–7200 秒')
  if (!Array.isArray(paper.questions) || !paper.questions.length || paper.questions.length > 100) throw badRequest('每份试卷需包含 1–100 题')
  if (!Array.isArray(paper.sections) || paper.sections.length > 10) throw badRequest('试卷分段不正确')
  const sectionIds = new Set()
  for (const section of paper.sections) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(section.id) || sectionIds.has(section.id)) throw badRequest('材料编号重复或不正确')
    sectionIds.add(section.id)
    if (typeof section.text !== 'string' || section.text.length > 50000) throw badRequest('材料正文不正确')
    if (section.audioUrl && !/^\/api\/v1\/ielts\/audio\/[a-zA-Z0-9_.-]+$/.test(section.audioUrl)) throw badRequest('听力音频必须来自已审核的本站素材')
    if(section.chart){
      const c=section.chart
      if(!['bar','line','table'].includes(c.kind)||!Array.isArray(c.labels)||!c.labels.length||c.labels.length>24||c.labels.some(x=>typeof x!=='string')||!Array.isArray(c.series)||!c.series.length||c.series.length>6||c.series.some(s=>typeof s.name!=='string'||!Array.isArray(s.values)||s.values.length!==c.labels.length||s.values.some(v=>!Number.isFinite(v)||v<0)))throw badRequest('图表数据不正确，请填写一致的标签和非负数值')
    }
    if(section.diagram){
      const d=section.diagram
      if(!['map','process'].includes(d.kind)||!Array.isArray(d.nodes)||!d.nodes.length||d.nodes.length>30||d.nodes.some(n=>typeof n.id!=='string'||typeof n.label!=='string'||n.label.length>100||![n.x,n.y].every(v=>Number.isFinite(v)&&v>=0&&v<=500)))throw badRequest('流程图或地图节点不正确')
      if(d.edges&&(!Array.isArray(d.edges)||d.edges.length>60||d.edges.some(e=>!d.nodes.some(n=>n.id===e.from)||!d.nodes.some(n=>n.id===e.to))))throw badRequest('图示连接不正确')
    }
  }
  const ids = new Set()
  for (const q of paper.questions) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(q.id) || ids.has(q.id) || !sectionIds.has(q.sectionId)) throw badRequest('题号重复或材料关联错误')
    ids.add(q.id)
    if (![...OBJECTIVE_TYPES, 'essay', 'spoken'].includes(q.type) || typeof q.prompt !== 'string' || !q.prompt.trim()) throw badRequest('题型或题干不正确')
    const subjective = ['essay', 'spoken'].includes(q.type)
    if ((['listening', 'reading'].includes(paper.skill) && subjective) || (paper.skill === 'writing' && q.type !== 'essay') || (paper.skill === 'speaking' && q.type !== 'spoken')) throw badRequest('科目与题型不匹配')
    if (!subjective && (!q.answer || !q.explanation || !q.evidence)) throw badRequest('客观题必须包含答案、解析和原文依据')
    if (!subjective && (Array.isArray(q.answer) ? !q.answer.length || q.answer.some(a => typeof a !== 'string') : typeof q.answer !== 'string')) throw badRequest('标准答案格式不正确')
    if (q.maxWords && (!Number.isInteger(q.maxWords) || q.maxWords < 1 || q.maxWords > 20)) throw badRequest('字数限制不正确')
    if (q.options && (!Array.isArray(q.options) || q.options.some(o => typeof o.value !== 'string' || typeof o.label !== 'string'))) throw badRequest('选项格式不正确')
    if(q.targetWords&&(!Array.isArray(q.targetWords)||q.targetWords.length>10||q.targetWords.some(w=>typeof w!=='string'||w.length>100)))throw badRequest('关联词汇格式不正确')
  }
  return paper
}

export function publicPaper(paper, { reveal = false, mode = 'practice' } = {}) {
  const visible = structuredClone(paper)
  visible.questions = visible.questions.map(q => {
    if (reveal) return q
    const { answer, explanation, evidence, targetWords, ...safe } = q
    return safe
  })
  if (!reveal && paper.skill === 'listening') {
    visible.sections = visible.sections.map(({ text, transcript, segments, ...section }) => ({ ...section, ...(mode === 'practice' ? { transcriptAvailableAfterSubmit: true } : {}) }))
  }
  return visible
}

export function objectiveReport(paper, answers) {
  const questions = paper.questions.map(q => ({ id: q.id, type: q.type, correct: gradeQuestion(q, answers[q.id]), answer: answers[q.id] ?? '', expected: q.answer ?? null, explanation: q.explanation || '', evidence: q.evidence || '', sectionId: q.sectionId }))
  const scored = questions.filter(q => q.correct !== null)
  const byType = Object.fromEntries([...new Set(scored.map(q => q.type))].map(type => {
    const items = scored.filter(q => q.type === type)
    return [type, { total: items.length, correct: items.filter(q => q.correct).length }]
  }))
  return { skill: paper.skill, total: scored.length, correct: scored.filter(q => q.correct).length, questions, byType, band: null, note: scored.length ? '原创练习结果仅展示正确题数，未经校准，不换算为官方雅思分数。' : '已保存作答，可申请 AI 练习反馈或交由教师复核。' }
}

export function deadlinePassed(attempt, now = Date.now()) {
  return attempt.mode === 'mock' && attempt.deadline_at && new Date(attempt.deadline_at).getTime() <= now
}

export function validateFeedback(raw, paper, answers) {
  if (!raw || typeof raw.summary !== 'string' || !Array.isArray(raw.corrections) || !Array.isArray(raw.criteria)) throw badRequest('评语格式不完整')
  const criteria = paper.skill === 'writing' ? ['task', 'coherence', 'lexical', 'grammar'] : ['coherence', 'lexical', 'grammar']
  const corrections = raw.corrections.map(c => {
    const original = answers[c.questionId]
    if (typeof original !== 'string' || typeof c.quote !== 'string' || !c.quote.trim() || !original.includes(c.quote) || typeof c.replacement !== 'string' || typeof c.explanation !== 'string') throw badRequest('评语缺少可核对的原文依据')
    return { questionId: c.questionId, quote: c.quote, replacement: c.replacement, explanation: c.explanation, offset: original.indexOf(c.quote) }
  })
  const validated = criteria.map(key => {
    const item = raw.criteria.find(c => c.key === key)
    if (!item || typeof item.feedback !== 'string') throw badRequest('评估维度缺失')
    // Scores are optional; every scored judgement requires a verifiable answer quotation.
    const evidence = Array.isArray(item.evidence) ? item.evidence.filter(e => typeof answers[e.questionId] === 'string' && typeof e.quote === 'string' && e.quote.trim() && answers[e.questionId].includes(e.quote)) : []
    const band = paper.skill === 'writing' && evidence.length && Number.isFinite(item.band) && item.band >= 0 && item.band <= 9 ? Math.round(item.band * 2) / 2 : null
    return { key, feedback: item.feedback, evidence, band }
  })
  return { summary: raw.summary.slice(0, 3000), corrections, criteria: validated, pronunciation: { state: 'not_assessed', note: '转写文字不能证明发音表现。请结合原录音由教师复核。' }, overallBand: null, disclaimer: 'AI 练习参考，不能预测官方考试成绩。' }
}
