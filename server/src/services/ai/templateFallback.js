/**
 * 零成本兜底内容（PRD 4.3.6 第 3 条的降级机制）。
 *
 * 当用户没有配置 API Key、当日额度用尽、或调用失败时，接口不应该直接报错，
 * 而是返回一份用**本地数据**组装出来的复习材料：
 *   - 释义、音标、词性直接取词库字段
 *   - 易混词对比取 word_relations 的算法结果（本来就不消耗 AI）
 *   - 例句取词库预置例句；开源词表没有例句的位置会明确标注
 *
 * 重要的是：这不是「假装生成了一篇短文」。没有大模型就无法凭空写出短文，
 * 硬编一篇假的只会误导用户。所以这里返回的是**结构化的复习清单**，
 * 并在响应里标明 source: 'template'，让前端如实告知用户这是本地内容。
 */

/** 一份复习清单最多列多少个词，避免响应过大 */
export const TEMPLATE_MAX_WORDS = 20

/**
 * 组装复习清单。
 * @param {object} params
 * @param {Array<{id:number, spelling:string, phonetic:string, pos:string, definitions:string[], example:string}>} params.words
 * @param {Record<number, Array<{spelling:string, definitions:string[], relationType:'form'|'meaning', score:number}>>} [params.relatedMap]
 * @param {string} [params.reason] 触发兜底的原因，直接展示给用户
 */
export function buildReviewSheet({ words = [], relatedMap = {}, reason = 'ai_unavailable' }) {
  const items = words.slice(0, TEMPLATE_MAX_WORDS).map((word) => {
    const related = relatedMap[word.id] || []
    const formLike = related.filter((item) => item.relationType === 'form')
    const meaningLike = related.filter((item) => item.relationType === 'meaning')

    return {
      wordId: word.id,
      spelling: word.spelling,
      phonetic: word.phonetic || '',
      pos: word.pos || '',
      definitions: word.definitions || [],
      /** 开源词表多数没有例句，前端需按是否为空决定是否展示 */
      example: word.example || '',
      confusables: related.slice(0, 4).map((item) => ({
        spelling: item.spelling,
        definitions: item.definitions,
        relationType: item.relationType,
        score: item.score,
      })),
      /** 给用户的本地记忆提示：按最可能的混淆类型给一句可执行的建议 */
      hint: buildHint({ formLike, meaningLike, hasExample: Boolean(word.example) }),
    }
  })

  return {
    source: 'template',
    reason,
    title: `复习清单 · ${items.length} 个单词`,
    body: `本页由词库本地数据组装（未调用 AI）。逐词看一遍释义与易混词对比，效果同样够用。`,
    items,
  }
}

function buildHint({ formLike, meaningLike, hasExample }) {
  if (formLike.length && meaningLike.length) return '这些词既长得像、意思也接近，重点看词形差异'
  if (formLike.length) return `注意与 ${formLike[0].spelling} 的词形差异`
  if (meaningLike.length) return `与 ${meaningLike[0].spelling} 意思接近，注意使用场景区别`
  if (!hasExample) return '暂无例句，可结合释义自行造句'
  return '结合例句记忆'
}

/**
 * 兜底版的错因巩固卡片：直接复用算法算出的形近/近义对比，
 * 与 AI 版返回同样的卡片结构，前端不需要为兜底单独写一套渲染。
 */
export function buildTemplateErrorCards({ words = [], relatedMap = {}, reason = 'ai_unavailable' }) {
  const cards = words.map((word) => {
    const related = relatedMap[word.id] || []
    return {
      wordId: word.id,
      spelling: word.spelling,
      headline: related.length
        ? `与 ${related.slice(0, 2).map((item) => item.spelling).join('、')} 容易混淆`
        : '暂未找到易混词',
      distinctions: [
        {
          spelling: word.spelling,
          coreMeaning: (word.definitions || []).join('；'),
          usage: '',
          example: word.example || '',
          translation: '',
        },
        ...related.slice(0, 3).map((item) => ({
          spelling: item.spelling,
          coreMeaning: (item.definitions || []).join('；'),
          usage: item.relationType === 'form' ? '词形相近，注意拼写差异' : '语义相近，注意使用场景',
          example: '',
          translation: '',
        })),
      ],
      mnemonic: '',
      formTip: related.length ? '对照上表逐字母比较拼写差异' : '',
    }
  })

  return { source: 'template', reason, cards }
}

export default { buildReviewSheet, buildTemplateErrorCards, TEMPLATE_MAX_WORDS }
