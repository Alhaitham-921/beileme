import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyError,
  ERROR_TYPES,
  ERROR_ANALYSIS,
  relearnDaysFor,
  isConfusionType,
} from '../src/services/errorAnalysis.js'

test('答对不产生错因标签，只区分置信度', () => {
  const fast = classifyError({ isCorrect: true, hesitationMs: 1000 })
  assert.equal(fast.type, null)
  assert.equal(fast.confidence, 'high')
  assert.equal(fast.needConfusableCard, false)

  const slow = classifyError({ isCorrect: true, hesitationMs: 8000 })
  assert.equal(slow.type, null)
  assert.equal(slow.confidence, 'low')
})

test('极短时间就选错 → 盲猜，并按全新学习缩短复习间隔（PRD 4.2.3）', () => {
  const result = classifyError({ isCorrect: false, hesitationMs: 900 })
  assert.equal(result.type, ERROR_TYPES.GUESS)
  assert.equal(relearnDaysFor(result.type), 0.25)
})

test('犹豫很久最终选错 → 记忆模糊', () => {
  const result = classifyError({ isCorrect: false, hesitationMs: 9000 })
  assert.equal(result.type, ERROR_TYPES.VAGUE)
  assert.equal(result.needConfusableCard, false)
})

test('选错的释义属于形近词 → 形近混淆并触发对比卡片', () => {
  const result = classifyError({
    isCorrect: false,
    hesitationMs: 4000,
    confusion: { relationType: 'form', relatedWordId: 42, priorCount: 0 },
  })
  assert.equal(result.type, ERROR_TYPES.FORM_CONFUSION)
  assert.equal(result.matchedRelatedWordId, 42)
  assert.equal(result.needConfusableCard, true)
})

test('选错的释义属于近义词 → 语义混淆', () => {
  const result = classifyError({
    isCorrect: false,
    hesitationMs: 4000,
    confusion: { relationType: 'meaning', relatedWordId: 7, priorCount: 0 },
  })
  assert.equal(result.type, ERROR_TYPES.MEANING_CONFUSION)
  assert.equal(result.needConfusableCard, true)
})

test('反复在同一组词间答错 → 升级为系统性混淆', () => {
  const third = classifyError({
    isCorrect: false,
    hesitationMs: 4000,
    confusion: { relationType: 'form', relatedWordId: 42, priorCount: ERROR_ANALYSIS.SYSTEMATIC_THRESHOLD - 1 },
  })
  assert.equal(third.type, ERROR_TYPES.SYSTEMATIC_CONFUSION)
  assert.equal(third.confusionCount, ERROR_ANALYSIS.SYSTEMATIC_THRESHOLD)

  // 次数不够时仍是普通混淆
  const first = classifyError({
    isCorrect: false,
    hesitationMs: 4000,
    confusion: { relationType: 'form', relatedWordId: 42, priorCount: 0 },
  })
  assert.equal(first.type, ERROR_TYPES.FORM_CONFUSION)
})

test('拼写模式下字母顺序错误 → 拼写薄弱，并建议拼词游戏', () => {
  const result = classifyError({ isCorrect: false, hesitationMs: 500, spellingMistake: true })
  assert.equal(result.type, ERROR_TYPES.SPELLING_WEAK)
  assert.equal(result.needSpellingGame, true)
  assert.equal(result.needConfusableCard, false)
})

test('拼写错误的判定优先于盲猜', () => {
  // 反应很快但明确是拼错，不该被归为盲猜
  const result = classifyError({ isCorrect: false, hesitationMs: 200, spellingMistake: true })
  assert.equal(result.type, ERROR_TYPES.SPELLING_WEAK)
})

test('没有混淆证据时，中间地带退化为记忆模糊而不是硬套混淆', () => {
  const result = classifyError({ isCorrect: false, hesitationMs: 3000, confusion: null })
  assert.equal(result.type, ERROR_TYPES.VAGUE)
})

test('犹豫时长为 0 时不误判为盲猜（客户端可能未上报）', () => {
  const result = classifyError({ isCorrect: false, hesitationMs: 0 })
  assert.equal(result.type, ERROR_TYPES.VAGUE)
})

test('每种错因都带有对应的系统响应文案', () => {
  const cases = [
    { isCorrect: false, hesitationMs: 800 },
    { isCorrect: false, hesitationMs: 9000 },
    { isCorrect: false, hesitationMs: 3000, confusion: { relationType: 'form', relatedWordId: 1 } },
    { isCorrect: false, hesitationMs: 3000, confusion: { relationType: 'meaning', relatedWordId: 1 } },
    { isCorrect: false, hesitationMs: 300, spellingMistake: true },
  ]

  for (const input of cases) {
    const result = classifyError(input)
    assert.ok(result.label, '应带中文错因名称')
    assert.ok(result.action, '应带系统响应建议')
    assert.ok(result.relearnDays > 0 && result.relearnDays <= 1)
  }
})

test('isConfusionType 只认三种混淆类错因', () => {
  assert.equal(isConfusionType(ERROR_TYPES.FORM_CONFUSION), true)
  assert.equal(isConfusionType(ERROR_TYPES.MEANING_CONFUSION), true)
  assert.equal(isConfusionType(ERROR_TYPES.SYSTEMATIC_CONFUSION), true)
  assert.equal(isConfusionType(ERROR_TYPES.GUESS), false)
  assert.equal(isConfusionType(ERROR_TYPES.SPELLING_WEAK), false)
})
