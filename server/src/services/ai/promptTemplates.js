/**
 * AI 生成的 Prompt 模板（PRD 4.3 / 4.4）
 *
 * 所有生成请求都必须经过这里的模板，这是「预设约束」的落地点：
 * 无论使用官方额度还是用户自带 Key，都不能绕过模板变成通用聊天工具（PRD 4.8）。
 */

/** 话题池随机抽取是「相同词表不同用户/不同时间生成结果不同」的保证之一（PRD 4.4 第 2 条） */
export const TOPIC_POOL = ['科技', '环保', '校园', '旅行', '职场', '健康', '文化', '生活']

/** 学习目标 → 文章体裁风格（PRD 4.3.1） */
const GOAL_STYLES = {
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
  1: '句子平均 8-10 词，只使用简单句，全部为高频基础词',
  2: '句子平均 10-14 词，以简单句为主，可少量使用并列句',
  3: '句子平均 14-18 词，可适度使用定语从句、状语从句',
  4: '句子平均 18-22 词，允许使用名词性从句与非谓语结构',
  5: '句子平均 22-26 词，允许长难句与较多抽象词汇，但仍需逻辑清晰',
}

/**
 * System Prompt：内容规范的强约束，对所有生成类型生效。
 */
export const SYSTEM_PROMPT = `你是「背了么」英语学习产品的内容生成引擎，只负责按固定结构填充学习内容，不提供任何与英语学习无关的服务。

必须严格遵守以下约定：
1. 内容必须服务于当前学习目标与给定词表，不得跑题、不得发散到无关话题。
2. 用词难度必须与给定难度等级匹配：可略高于学习者当前水平，但不可断层，不得出现严重超纲词。
3. 内容必须健康、积极、适合学习场景；不得涉及暴力、色情、政治敏感、歧视等不适宜内容。
4. 输出结构为固定格式，你只负责填充内容，不得增删或改变结构。
5. 请勿与常见范文雷同，尽量原创，避免模板化表达；相同词表也要在具体场景、人物、细节上做出差异化。
6. 只输出要求的 JSON，不要输出任何解释性文字、不要使用 Markdown 代码块包裹。`

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

function wordsBlock(words) {
  return words
    .map((word) => {
      const definitions = (word.definitions || []).join('；')
      const example = word.example ? `　例：${word.example}` : ''
      return `- ${word.spelling}（${word.pos || '—'}，${definitions}）${example}`
    })
    .join('\n')
}

function weakWordsBlock(weakWords = []) {
  if (!weakWords.length) return '（暂无历史易混词记录）'
  return weakWords
    .map((item) => `- ${item.spelling}：${(item.definitions || []).join('；')}`)
    .join('\n')
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
  memoryPrefs = [],
  minWords = 150,
  maxWords = 250,
} = {}) {
  const prefsHint = memoryPrefs.length
    ? `学习者的记忆偏好：${memoryPrefs.join('、')}，请相应地调整内容侧重（例如偏好语境阅读则加强上下文线索，偏好词根词缀则尽量使用同根词）。`
    : ''

  const user = `【任务】为英语学习者撰写一篇巩固短文。

【话题】${topic}
【体裁风格】${styleForGoal(profile.goal)}
【难度要求】${guideForDifficulty(difficulty)}
【篇幅】${minWords}-${maxWords} 个英文单词

【必须自然融入的目标词】
${wordsBlock(words)}

【学习者历史易混词（若能在文中制造对比语境，将显著提升辨析效果）】
${weakWordsBlock(weakWords)}

【学习者画像摘要】目标：${profile.goal || '未指定'}；自评词汇量：${profile.selfLevel || '不确定'}；每日投入：${profile.dailyTime || '未指定'}
${prefsHint}

【硬性要求】
1. 目标词必须全部出现在文中，形式自然，不得生硬堆砌；如确有个别词无法自然融入，最多允许 1 个词替换为其同根词。
2. 文中每个目标词都用 Markdown 加粗包裹，例如 **abandon**。
3. 文章要有一个具体、独特的场景或叙事视角，避免泛泛而谈的模板化开头。
4. 文末附生词表，与文中出现的词一一对应。

只输出如下 JSON：
{
  "title": "英文标题",
  "body": "正文，目标词用 ** 加粗",
  "glossary": [{"spelling": "单词", "definition": "中文释义"}],
  "topicUsed": "${topic}"
}`

  return { system: SYSTEM_PROMPT, user }
}

/**
 * 阅读理解练习题生成（PRD 4.3.2）
 */
export function buildQuizPrompt({ article = {}, words = [], profile = {}, difficulty = 3, count = 3 } = {}) {
  const user = `【任务】基于下面这篇短文，生成 ${count} 道阅读理解题。

【短文标题】${article.title || ''}
【短文正文】
${article.body || ''}

【考查目标词】
${wordsBlock(words)}

【难度要求】${guideForDifficulty(difficulty)}
【学习目标】${profile.goal || '未指定'}

【题型分布要求】
1. 至少 1 道词汇题：考查目标词在文中的具体含义。
2. 至少 1 道细节理解题：答案必须能在文中直接定位。
3. 至少 1 道推理判断题：需要结合上下文推断。
${['四级', '六级', '雅思', '托福', '考研'].includes(profile.goal) ? '4. 另加 1 道长难句理解或翻译题。' : ''}

【硬性要求】
1. 每题 4 个选项，只有一个正确答案，干扰项必须合理且不与原文矛盾。
2. 每题都要给出解析，说明正确选项的依据，并指出错误选项的问题。
3. 词汇题必须直接对应上面的目标词。

只输出如下 JSON：
{
  "questions": [
    {
      "type": "vocabulary | detail | inference | translation",
      "stem": "题干",
      "options": ["A 选项", "B 选项", "C 选项", "D 选项"],
      "answerIndex": 0,
      "explanation": "解析",
      "targetWord": "对应的目标词，没有则为空字符串"
    }
  ]
}`

  return { system: SYSTEM_PROMPT, user }
}

/**
 * 错因巩固内容生成（PRD 4.3.3）：针对易混词生成对比记忆卡片
 */
export function buildErrorCardPrompt({ word, relatedWords = [], errorBreakdown = {}, profile = {} } = {}) {
  const related = relatedWords
    .map(
      (item) =>
        `- ${item.spelling}（${item.pos || '—'}，${(item.definitions || []).join('；')}）　关系：${
          item.relationType === 'form' ? '形近' : '近义'
        }，相似度 ${item.score}`
    )
    .join('\n')

  const user = `【任务】为一个容易混淆的单词生成对比记忆卡片。

【目标词】${word.spelling}（${word.pos || '—'}，${(word.definitions || []).join('；')}）
【例句】${word.example || '（无）'}

【容易与它混淆的词】
${related || '（无）'}

【该词的历史错因统计】盲猜 ${errorBreakdown.guess || 0} 次；记忆模糊 ${errorBreakdown.vague || 0} 次；形近混淆 ${errorBreakdown.formConfusion || 0} 次；近义混淆 ${errorBreakdown.meaningConfusion || 0} 次；拼写薄弱 ${errorBreakdown.spellingWeak || 0} 次
【学习目标】${profile.goal || '未指定'}
【难度要求】${guideForDifficulty(profile.selfLevel ? 3 : 3)}

【硬性要求】
1. 明确说明这几个词在含义和用法上的核心区别。
2. 为每个词各给一个能体现区别的英文例句，并附中文翻译。
3. 给出一句简短好记的记忆口诀或联想（中文即可），要贴近错因，不要空泛。
4. 若错因以形近为主，重点讲词形差异；若以语义为主，重点讲使用场景差异。

只输出如下 JSON：
{
  "headline": "一句话点明核心区别",
  "distinctions": [{"spelling": "单词", "coreMeaning": "核心语义", "usage": "用法差异说明", "example": "英文例句", "translation": "中文翻译"}],
  "mnemonic": "记忆口诀或联想",
  "formTip": "词形差异提示"
}`

  return { system: SYSTEM_PROMPT, user }
}

/**
 * 本周薄弱点小结（PRD 4.3.3）：把统计数据交给模型写成自然语言结论
 */
export function buildWeakSummaryPrompt({ stats = {}, profile = {} } = {}) {
  const distribution = (stats.errorDistribution?.items || [])
    .map((item) => `- ${item.label}：${item.count} 次（${item.percent}%）`)
    .join('\n')

  const topWords = (stats.topWrongWords || [])
    .map((item) => `- ${item.spelling}（${(item.definitions || []).join('；')}）：错 ${item.wrongTimes} 次，错因 ${item.errorTypes.join('、')}`)
    .join('\n')

  const user = `【任务】根据下面的学习数据，写一份本周薄弱点小结，直接对学习者说话。

【统计周期】最近 ${stats.days || 7} 天
【错因分布】
${distribution || '（本周无错题）'}

【错误最多的单词】
${topWords || '（无）'}

【学习目标】${profile.goal || '未指定'}

【硬性要求】
1. 用第二人称，语气鼓励但不空洞，不要堆砌夸奖。
2. 必须基于数据给出结论，不得编造统计里没有的现象。
3. 给出 2-3 条具体、可执行的下一步建议。

只输出如下 JSON：
{
  "headline": "一句话总结本周状态",
  "observations": ["观察 1", "观察 2"],
  "suggestions": ["建议 1", "建议 2", "建议 3"]
}`

  return { system: SYSTEM_PROMPT, user }
}

/**
 * 解析模型返回的 JSON。模型偶尔会用 ```json 包裹，这里统一剥离后再解析。
 * @throws {Error} 内容不是合法 JSON 时抛出，由上层决定是否重试
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
  pickTopic,
  styleForGoal,
  guideForDifficulty,
  buildArticlePrompt,
  buildQuizPrompt,
  buildErrorCardPrompt,
  buildWeakSummaryPrompt,
  parseJsonResponse,
}
