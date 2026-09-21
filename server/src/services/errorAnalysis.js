/**
 * 错因分析引擎（PRD 4.2.3，核心亮点功能）
 *
 * 本文件是纯函数实现：只根据「对错 / 犹豫时长 / 错误选项归属 / 历史混淆次数」做判定，
 * 不触碰数据库，便于单测覆盖全部分支。数据库查询与落库在 studyService 中完成。
 */

export const ERROR_TYPES = {
  GUESS: 'guess',
  VAGUE: 'vague',
  FORM_CONFUSION: 'form_confusion',
  MEANING_CONFUSION: 'meaning_confusion',
  SYSTEMATIC_CONFUSION: 'systematic_confusion',
  SPELLING_WEAK: 'spelling_weak',
}

export const ERROR_TYPE_LABELS = {
  [ERROR_TYPES.GUESS]: '盲猜 / 生疏',
  [ERROR_TYPES.VAGUE]: '记忆模糊',
  [ERROR_TYPES.FORM_CONFUSION]: '形近词混淆',
  [ERROR_TYPES.MEANING_CONFUSION]: '近义词混淆',
  [ERROR_TYPES.SYSTEMATIC_CONFUSION]: '系统性混淆',
  [ERROR_TYPES.SPELLING_WEAK]: '拼写薄弱',
}

/** 各错因对应的系统响应文案（PRD 4.2.3 表格右列） */
export const ERROR_TYPE_ACTIONS = {
  [ERROR_TYPES.GUESS]: '归为全新学习，缩短复习间隔并增加重复次数',
  [ERROR_TYPES.VAGUE]: '标记低置信度，优先安排例句/短文等语境化复习',
  [ERROR_TYPES.FORM_CONFUSION]: '触发易混词对比卡片，强化词形差异',
  [ERROR_TYPES.MEANING_CONFUSION]: '触发易混词对比卡片，辨析核心语义区别',
  [ERROR_TYPES.SYSTEMATIC_CONFUSION]: '生成专项巩固练习，集中辨析这一组词',
  [ERROR_TYPES.SPELLING_WEAK]: '推送拼词类小游戏，强化字母顺序记忆',
}

export const ERROR_ANALYSIS = {
  /** 快于该时长就选错，判定为盲猜 */
  BLIND_GUESS_MS: 1500,
  /** 慢于该时长最终选错，判定为记忆模糊 */
  SLOW_MS: 6000,
  /** 同一组词累计答错达到该次数，升级为系统性混淆 */
  SYSTEMATIC_THRESHOLD: 3,
}

/** 答错后的重学间隔（天）。盲猜代表完全没记住，最短时间内再见一次。 */
const RELEARN_DAYS = {
  [ERROR_TYPES.GUESS]: 0.25,
  [ERROR_TYPES.VAGUE]: 0.5,
  [ERROR_TYPES.FORM_CONFUSION]: 1,
  [ERROR_TYPES.MEANING_CONFUSION]: 1,
  [ERROR_TYPES.SYSTEMATIC_CONFUSION]: 0.5,
  [ERROR_TYPES.SPELLING_WEAK]: 1,
}

/** 易混词组存在时的间隔折扣（PRD：易混词组的复习间隔要更短） */
export const CONFUSION_INTERVAL_FACTOR = 0.7

export function relearnDaysFor(errorType) {
  return RELEARN_DAYS[errorType] ?? 1
}

export function labelOf(errorType) {
  return ERROR_TYPE_LABELS[errorType] ?? '未知错因'
}

export function isConfusionType(errorType) {
  return (
    errorType === ERROR_TYPES.FORM_CONFUSION ||
    errorType === ERROR_TYPES.MEANING_CONFUSION ||
    errorType === ERROR_TYPES.SYSTEMATIC_CONFUSION
  )
}

/**
 * 判定一次作答的错因。
 *
 * @param {object} input
 * @param {boolean} input.isCorrect 是否答对
 * @param {number} input.hesitationMs 犹豫时长
 * @param {boolean} [input.spellingMistake] 拼写模式下字母顺序错误
 * @param {object|null} [input.confusion] 错误选项命中的易混词信息
 * @param {'form'|'meaning'} [input.confusion.relationType] 与当前词的关系类型
 * @param {number} [input.confusion.relatedWordId] 命中的易混词 id
 * @param {number} [input.confusion.priorCount] 该词对该易混词的历史错误次数
 * @param {number} [input.priorErrorCount] 该单词的历史错误总数
 * @param {object} [options] 阈值覆盖，主要供测试使用
 * @returns {{
 *   type: string|null, label: string|null, action: string|null,
 *   matchedRelatedWordId: number|null, confusionCount: number,
 *   needConfusableCard: boolean, needSpellingGame: boolean, relearnDays: number,
 *   confidence: 'high'|'low'
 * }}
 */
export function classifyError(input = {}, options = {}) {
  const {
    blindGuessMs = ERROR_ANALYSIS.BLIND_GUESS_MS,
    slowMs = ERROR_ANALYSIS.SLOW_MS,
    systematicThreshold = ERROR_ANALYSIS.SYSTEMATIC_THRESHOLD,
  } = options

  const { isCorrect, hesitationMs = 0, spellingMistake = false, confusion = null } = input

  // 答对的情况：只区分「熟练」与「低置信度」，不产生错因标签
  if (isCorrect) {
    const confidence = Number(hesitationMs) > 3000 ? 'low' : 'high'
    return {
      type: null,
      label: null,
      action: confidence === 'low' ? '低置信度正确，复习间隔适度缩短' : null,
      matchedRelatedWordId: null,
      confusionCount: 0,
      needConfusableCard: false,
      needSpellingGame: false,
      relearnDays: 1,
      confidence,
    }
  }

  const build = (type, extra = {}) => ({
    type,
    label: labelOf(type),
    action: ERROR_TYPE_ACTIONS[type],
    matchedRelatedWordId: extra.matchedRelatedWordId ?? null,
    confusionCount: extra.confusionCount ?? 0,
    needConfusableCard: isConfusionType(type),
    needSpellingGame: type === ERROR_TYPES.SPELLING_WEAK,
    relearnDays: relearnDaysFor(type),
    confidence: 'low',
  })

  // 1) 拼写模式字母顺序错误 → 拼写薄弱（游戏/拼写模式专有信号）
  if (spellingMistake) {
    return build(ERROR_TYPES.SPELLING_WEAK)
  }

  // 2) 极短时间就选错 → 盲猜，说明根本没记住，按全新学习处理
  const hesitation = Number(hesitationMs) || 0
  if (hesitation > 0 && hesitation < blindGuessMs) {
    return build(ERROR_TYPES.GUESS)
  }

  // 3) 选错的释义属于形近词/近义词 → 词形或语义混淆
  if (confusion && confusion.relatedWordId != null) {
    const priorCount = Number(confusion.priorCount || 0)
    const confusionCount = priorCount + 1

    // 反复在同一组词间答错 → 升级为系统性混淆，需要专项巩固而非单张卡片
    if (confusionCount >= systematicThreshold) {
      return build(ERROR_TYPES.SYSTEMATIC_CONFUSION, {
        matchedRelatedWordId: confusion.relatedWordId,
        confusionCount,
      })
    }

    const type =
      confusion.relationType === 'form' ? ERROR_TYPES.FORM_CONFUSION : ERROR_TYPES.MEANING_CONFUSION
    return build(type, { matchedRelatedWordId: confusion.relatedWordId, confusionCount })
  }

  // 4) 犹豫很久最终选错 → 记忆模糊，优先语境化复习（后两步与第 2 步共同覆盖中间地带）
  return build(ERROR_TYPES.VAGUE)
}

export default {
  ERROR_TYPES,
  ERROR_TYPE_LABELS,
  ERROR_ANALYSIS,
  classifyError,
  relearnDaysFor,
  labelOf,
  isConfusionType,
}
