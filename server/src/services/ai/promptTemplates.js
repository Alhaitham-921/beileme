/**
 * AI 生成的 Prompt 模板（PRD 4.3 / 4.4）。
 *
 * 所有生成请求都必须经过这里的模板，这是「预设约束」的落地点：
 * 无论使用官方额度还是用户自带 Key，都不能绕过模板变成通用聊天工具（PRD 4.8）。
 *
 * ── 关于「省 token」的设计取舍 ─────────────────────────────
 * Prompt 里的每个字都要花钱，因此这里刻意做了几件事：
 *  1. 目标词用单行紧凑格式 `adapt(v. 适应/改编)`，**不带例句**——
 *     例句对「写一篇新文章」帮助很小，却往往占掉输入 token 的一半
 *  2. 释义只取前 2 条，够模型判断词义即可
 *  3. 用户画像压成一行摘要，而不是把字段逐条铺开
 *  4. 多个易错词合并成一次请求（buildErrorCardBatchPrompt），
 *     避免「一个词一次调用」这种最烧钱的写法
 *  5. 输出结构尽量扁平，并要求不输出解释性文字，减少无效的输出 token
 */

/** 话题池随机抽取是「相同词表不同用户/不同时间生成结果不同」的保证之一（PRD 4.4 第 2 条） */
export const TOPIC_POOL = ['科技', '环保', '校园', '旅行', '职场', '健康', '文化', '生活']

/** 提示词里最多出现的释义条数：再多只增加 token，不提升质量 */
const MAX_DEFINITIONS_IN_PROMPT = 2

/** 单次请求里最多合并多少个错词的卡片 */
export const MAX_CARDS_PER_REQUEST = 6

/** 学习目标 → 文章体裁风格（PRD 4.3.1） */
const GOAL_STYLES = {
  小学: '简短对话或图文式短文，句子极短，全部使用最基础的词汇',
  中考: '贴近校园生活的记叙文或应用文（如日记、通知、书信），句子简短，多用具体场景',
  高考: '叙事与议论结合，允许出现少量定语从句和状语从句',
  四级: '说明文或议论文，结构清晰，允许使用常见的连接词与举例论证',
  六级: '偏思辨的议论文或科普说明文，句间逻辑更严密，可使用较复杂句式',
  考研: '学术倾向的说明文或评论，允许较长难句和抽象表述',
  雅思: '学术类文章（Academic），客观陈述、数据与因果分析为主',
  托福: '学术讲座风格的说明文，术语密度略高，强调定义与例证',
  纯兴趣: '轻松有趣的短文，贴近日常生活与个人体验，语气友好',
  自定义: '通用说明文，保证可读性与学习价值',
}

/** 难度分级 → 句式与用词约束（PRD 4.4：可略高于当前水平，但不可断层） */
const DIFFICULTY_GUIDES = {
  1: '句子平均 8-10 词，只用简单句，全部高频基础词',
  2: '句子平均 10-14 词，以简单句为主，可少量并列句',
  3: '句子平均 14-18 词，可适度使用定语从句、状语从句',
  4: '句子平均 18-22 词，允许名词性从句与非谓语结构',
  5: '句子平均 22-26 词，允许长难句与较多抽象词，但逻辑仍需清晰',
}

/**
 * System Prompt：内容规范的强约束，对所有生成类型生效。
 * 它每次请求都会发送，所以写得紧凑——但这几条约束一条都不能省，
 * 它们正是「不跑题、不超纲、不被当成通用聊天工具」的保证。
 */
export const SYSTEM_PROMPT = `你是「背了么」英语学习产品的内容生成引擎，只按固定结构填充学习内容，不提供任何与英语学习无关的服务。

约定：
1. 内容必须服务于给定词表与学习目标，不得跑题发散。
2. 用词难度与给定难度等级匹配：可略高于学习者水平，但不可断层、不可大量超纲。
3. 内容健康、积极、适合学习场景，不得涉及暴力、色情、政治敏感或歧视。
4. 输出结构固定，你只填充内容，不得增删字段。
5. 请勿与常见范文雷同，尽量原创，相同词表也要在场景与细节上做出差异化。
6. 只输出要求的 JSON，不要解释性文字，不要用 Markdown 代码块包裹。`

/** 按学习目标取体裁风格 */
export function styleForGoal(goal) {
  return GOAL_STYLES[goal] || GOAL_STYLES.纯兴趣
}

/** 按难度等级取句式约束 */
export function guideForDifficulty(difficulty) {
  const level = Math.min(5, Math.max(1, Number.parseInt(difficulty, 10) || 3))
  return DIFFICULTY_GUIDES[level]
}

/**
 * 按话题权重加权随机抽取话题（权重随用户行为演化，实现「越用越懂你」）
 */
export function pickTopic(topicWeights = {}, random = Math.random) {
  const pool = TOPIC_POOL.filter((topic) => topicWeights[topic] != null)
  const topics = pool.length ? pool : TOPIC_POOL
  const weights = topics.map((topic) => Math.max(0.05, Number(topicWeights[topic] ?? 1)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)

  let cursor = random() * total
  for (let i = 0; i < topics.length; i += 1) {
    cursor -= weights[i]
    if (cursor <= 0) return topics[i]
  }
  return topics[topics.length - 1]
}

/**
 * 目标词 → 紧凑单行文本。输入 token 的大头就在这里，所以：
 * 不带例句、释义最多 2 条、用 `; ` 分隔。
 * 例：`adapt(v. 适应/改编); ability(n. 能力/才能)`
 */
export function wordsBlockCompact(words = []) {
  return words
    .map((word) => {
      const pos = word.pos ? `${word.pos} ` : ''
      const definitions = (word.definitions || []).slice(0, MAX_DEFINITIONS_IN_PROMPT).join('/')
      return `${word.spelling}(${pos}${definitions})`
    })
    .join('; ')
}

/** 易混词 → 只给拼写与一个释义，用于在文中制造对比语境（PRD 4.3.1） */
export function confusableBlockCompact(weakWords = []) {
  if (!weakWords.length) return ''
  return weakWords
    .map((item) => `${item.spelling}(${(item.definitions || [])[0] || ''})`)
    .join('; ')
}

/** 用户画像 → 一行摘要，避免把字段逐条铺开占 token（PRD 4.4 第 1 条） */
export function profileLineCompact(profile = {}) {
  const parts = [`目标:${profile.goal || '未指定'}`]
  if (profile.selfLevel) parts.push(`词汇量:${profile.selfLevel}`)
  if (Array.isArray(profile.memoryPrefs) && profile.memoryPrefs.length) {
    parts.push(`记忆偏好:${profile.memoryPrefs.join('/')}`)
  }
  return parts.join(' ')
}

/**
 * 个性化短文生成（PRD 4.3.1）
 */
export function buildArticlePrompt({
  words = [],
  profile = {},
  topic,
  difficulty = 3,
  weakWords = [],
  minWords = 150,
  maxWords = 250,
} = {}) {
  const confusables = confusableBlockCompact(weakWords)

  const user = `写一篇英语巩固短文。
话题：${topic}
体裁：${styleForGoal(profile.goal)}
难度：${guideForDifficulty(difficulty)}
篇幅：${minWords}-${maxWords} 个英文单词
目标词（必须全部自然出现，文中用 ** 加粗）：${wordsBlockCompact(words)}
${confusables ? `易混词（如能制造对比语境更好）：${confusables}\n` : ''}学习者：${profileLineCompact(profile)}

要求：场景具体独特，避免模板化开头；不得生硬堆砌目标词；文末附生词表。
只输出 JSON：
{"title":"英文标题","body":"正文，目标词用 ** 加粗","glossary":[{"spelling":"单词","definition":"中文释义"}],"topicUsed":"${topic}"}`

  return { system: SYSTEM_PROMPT, user }
}

/**
 * 阅读理解练习题生成（PRD 4.3.2）
 */
export function buildQuizPrompt({ article = {}, words = [], profile = {}, difficulty = 3, count = 3 } = {}) {
  const academic = ['四级', '六级', '雅思', '托福', '考研'].includes(profile.goal)

  const user = `基于下面这篇短文出 ${count} 道阅读理解题。

标题：${article.title || ''}
正文：
${article.body || ''}

考查词：${wordsBlockCompact(words)}
难度：${guideForDifficulty(difficulty)}　学习者：${profileLineCompact(profile)}

题型分布：至少 1 道词汇题（考查目标词在文中的含义）、1 道细节理解题（答案可在文中直接定位）、1 道推理判断题。
${academic ? '再加 1 道长难句理解或翻译题。' : ''}
要求：每题 4 个选项、只有 1 个正确答案、干扰项合理；每题都要给解析，说明正确项依据与错误项的问题。

只输出 JSON：
{"questions":[{"type":"vocabulary|detail|inference|translation","stem":"题干","options":["A","B","C","D"],"answerIndex":0,"explanation":"解析","targetWord":"对应目标词，没有则为空"}]}`

  return { system: SYSTEM_PROMPT, user }
}

/**
 * 错因巩固卡片 · 批量版（PRD 4.2.3 / 4.3.3）
 *
 * 这是成本控制里最关键的一处：把 N 个易错词合并进一次请求。
 * 逐词调用会产生 N 倍的 system prompt 与固定开销，合并后固定成本只付一次。
 *
 * @param {{words?:Array, profile?:object}} params
 *   words 元素形如：
 *   { spelling, pos, definitions, relatedWords:[{spelling, relationType}],
 *     errorBreakdown:{ guess, vague, formConfusion, meaningConfusion, spellingWeak } }
 */
export function buildErrorCardBatchPrompt({ words = [], profile = {} } = {}) {
  const list = words.slice(0, MAX_CARDS_PER_REQUEST)

  const items = list
    .map((word, index) => {
      const related = (word.relatedWords || [])
        .slice(0, 3)
        .map((item) => `${item.spelling}(${item.relationType === 'form' ? '形近' : '近义'})`)
        .join(' ')

      const breakdown = word.errorBreakdown || {}
      const errors = [
        breakdown.guess ? `盲猜 ${breakdown.guess} 次` : '',
        breakdown.vague ? `记忆模糊 ${breakdown.vague} 次` : '',
        breakdown.formConfusion ? `形近混淆 ${breakdown.formConfusion} 次` : '',
        breakdown.meaningConfusion ? `近义混淆 ${breakdown.meaningConfusion} 次` : '',
        breakdown.spellingWeak ? `拼写薄弱 ${breakdown.spellingWeak} 次` : '',
      ]
        .filter(Boolean)
        .join('、')

      const glossary = (word.definitions || []).slice(0, MAX_DEFINITIONS_IN_PROMPT).join('/')
      return (
        `${index + 1}. ${word.spelling}(${word.pos ? `${word.pos} ` : ''}${glossary})` +
        `${related ? ` 易混:${related}` : ''}${errors ? ` 历史错因:${errors}` : ''}`
      )
    })
    .join('\n')

  const user = `为下列易错词各生成一张对比记忆卡片。这些词是学习者反复混淆或记不住的。
${items}
学习者：${profileLineCompact(profile)}

每个词都要给出：一句话点明核心区别、各词的核心语义与用法差异、能体现区别的英文例句及中文翻译、
一句好记的记忆口诀（要结合上面的错因，不要空泛）。错因以形近为主就重点讲词形差异，以语义为主就重点讲使用场景。

只输出 JSON：
{"cards":[{"spelling":"单词","headline":"一句话核心区别","distinctions":[{"spelling":"单词","coreMeaning":"核心语义","usage":"用法差异","example":"英文例句","translation":"中文翻译"}],"mnemonic":"记忆口诀","formTip":"词形差异提示"}]}`

  return { system: SYSTEM_PROMPT, user }
}

/**
 * 本周薄弱点小结（PRD 4.3.3）：统计数据由服务端算好，模型只负责表述
 */
export function buildWeakSummaryPrompt({ stats = {}, profile = {} } = {}) {
  const distribution = (stats.errorDistribution?.items || [])
    .map((item) => `${item.label} ${item.count}次(${item.percent}%)`)
    .join('、')

  const topWords = (stats.topWrongWords || [])
    .slice(0, 5)
    .map((item) => `${item.spelling}(${(item.definitions || [])[0] || ''}) 错${item.wrongTimes}次`)
    .join('; ')

  const user = `根据下列学习数据写一份最近 ${stats.days || 7} 天的薄弱点小结，直接对学习者说话。

错因分布：${distribution || '本周无错题'}
高频错词：${topWords || '无'}
学习者：${profileLineCompact(profile)}

要求：用第二人称，语气鼓励但不空洞；结论必须基于上面的数据，不得编造统计里没有的现象；
给出 2-3 条具体可执行的下一步建议。

只输出 JSON：
{"headline":"一句话总结本周状态","observations":["观察1","观察2"],"suggestions":["建议1","建议2"]}`

  return { system: SYSTEM_PROMPT, user }
}

/**
 * 解析模型返回的 JSON。模型偶尔会用 ```json 包裹，这里统一剥离后再解析。
 * @throws {Error} 内容不是合法 JSON 时抛出，由上层决定是否降级
 */
export function parseJsonResponse(content) {
  if (typeof content !== 'string') throw new Error('AI 返回内容不是字符串')
  const trimmed = content.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const candidate = fenced ? fenced[1] : trimmed

  try {
    return JSON.parse(candidate)
  } catch {
    // 兜底：截取第一个 { 到最后一个 } 之间的内容
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1))
    }
    throw new Error('AI 返回内容不是合法 JSON')
  }
}

export default {
  SYSTEM_PROMPT,
  TOPIC_POOL,
  MAX_CARDS_PER_REQUEST,
  pickTopic,
  styleForGoal,
  guideForDifficulty,
  wordsBlockCompact,
  confusableBlockCompact,
  profileLineCompact,
  buildArticlePrompt,
  buildQuizPrompt,
  buildErrorCardBatchPrompt,
  buildWeakSummaryPrompt,
  parseJsonResponse,
}
