import { z } from 'zod'

export const EXPLANATION_VALIDATION_VERSION = 'assessment-explanation-v2'
const labels = { foundation: '高频基础', standard: '常规难度', challenge: '更有挑战' }

// The model chooses the emphasis and order. Factual conclusions are rendered from
// verified records, so a valid citation cannot smuggle in a contradictory sentence.
export function assessmentConclusions(baseline) {
  if (!baseline.synthesis) return []
  const facts = new Set(baseline.facts.map(fact => fact.id))
  const conclusions = []
  const add = (id, evidenceIds, text) => {
    if (evidenceIds.every(id => facts.has(id))) conclusions.push({ id, evidenceIds, text })
  }
  const summary = baseline.synthesis
  add(`synthesis-${summary.decision}`, ['synthesis', ...summary.evidenceIds], `${summary.title}。${summary.detail}`)
  for (const trend of summary.trends) add(`trend-${trend.level}-${trend.status}`, [`trend-${trend.level}`], trend.text)
  for (const comparison of baseline.comparisons) {
    const change = comparison.change
    if (change === null) continue
    add(`comparison-${comparison.level}-${comparison.direction}`, ['comparison'],
      change > 0 ? `本次${labels[comparison.level]}词义辨认的正确率较上次提高；单次变化仍需结合跨日趋势观察。`
        : change < 0 ? `本次${labels[comparison.level]}词义辨认的正确率较上次降低；先查看薄弱词和近期学习，不能仅凭一次结果判定能力退步。`
          : `本次${labels[comparison.level]}词义辨认的正确率与上次相同，仍需结合不同日期和实际练习观察。`)
  }
  add('current-reference', ['current'], '本次词义辨认可以帮助选择试学起点，是否采用由你决定；这不是整体英语能力或长期掌握程度的认证。')
  if (facts.has('recurring')) add('recurring-weakness', ['recurring'], '部分词义在历史和本次都未答出，可优先巩固这些重复出现的薄弱项。')
  if (facts.has('recovered')) add('answered-again', ['recovered'], '部分曾经未答出的词义本次答出，仍需用后续独立回忆检查稳定性。')
  const { study, collocations, recall } = baseline.learning
  add(study.total ? 'study-records' : 'study-missing', ['study'], study.total
    ? '近期已有日常学习与复习记录，可以结合这些表现安排练习；作答次数本身不代表掌握程度。'
    : '近期缺少日常学习与复习记录，先通过实际学习积累依据，暂不推断这方面的能力。')
  add(collocations.total ? 'collocations-records' : 'collocations-missing', ['collocations'], collocations.total
    ? collocations.correct < collocations.total ? '近期搭配记录中仍有未答出的内容，可先复习错搭配；这项判断仅针对搭配练习。'
      : '近期记录中的搭配均已答出，可以继续按间隔复习；这些记录尚不足以证明长期掌握。'
    : '近期没有搭配练习记录，暂时无法判断短语运用表现，可以自愿补充练习。')
  add(recall.total ? 'recall-records' : 'recall-missing', ['recall'], recall.total
    ? recall.independent < recall.total ? '近期延迟复测仍有提示后答出或未答出的情况，建议继续到期复测，检查能否独立回忆。'
      : '近期已完成的延迟复测均为独立答出，可以继续观察后续表现，不将有限记录等同于永久记住。'
    : '近期没有已完成的延迟复测，暂时不能判断记忆是否稳定；可先练习，再在到期日独立回忆。')
  return conclusions
}

const selectionSchema = z.object({
  observations: z.array(z.object({ conclusionId: z.string().min(1).max(100) }).strict()).min(1).max(3),
  nextSteps: z.array(z.object({ actionId: z.string().min(1).max(100) }).strict()).min(1).max(2),
}).strict()

export function validateAssessmentSelection(reply, baseline, allowed = assessmentConclusions(baseline)) {
  const selection = selectionSchema.parse(reply)
  const conclusions = new Map(allowed.map(item => [item.id, item]))
  const actions = new Map(baseline.recommendations.map(item => [item.id, item]))
  const ids = selection.observations.map(item => item.conclusionId)
  const actionIds = selection.nextSteps.map(item => item.actionId)
  if (new Set(ids).size !== ids.length || new Set(actionIds).size !== actionIds.length ||
      ids.some(id => !conclusions.has(id)) || actionIds.some(id => !actions.has(id)))
    throw new Error('Explanation selected an unsupported or duplicate conclusion/action')
  if (!ids.includes(`synthesis-${baseline.synthesis?.decision}`))
    throw new Error('Explanation omitted the evidence-backed comprehensive conclusion')
  const priorities = baseline.synthesis.priorityActions.filter(id => actions.has(id))
  if (priorities.length && !actionIds.some(id => priorities.includes(id)))
    throw new Error('Explanation omitted the supported practice priority')
  return { validationVersion: EXPLANATION_VALIDATION_VERSION,
    observations: ids.map(id => { const item = conclusions.get(id); return { conclusionId: id,
      evidenceId: item.evidenceIds[0], evidenceIds: item.evidenceIds, explanation: item.text } }),
    nextSteps: actionIds.map(actionId => ({ actionId, explanation: actions.get(actionId).detail })) }
}

export function validatedSavedExplanation(saved, baseline) {
  if (saved?.validationVersion !== EXPLANATION_VALIDATION_VERSION) return null
  try {
    const verified = validateAssessmentSelection({
      observations: saved.observations.map(({ conclusionId }) => ({ conclusionId })),
      nextSteps: saved.nextSteps.map(({ actionId }) => ({ actionId })),
    }, baseline)
    return { ...saved, ...verified }
  } catch { return null }
}
