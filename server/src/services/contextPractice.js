import { z } from 'zod'

export const SCENES = [
  { id: 'library', title: '向图书馆借书', task: '你想借一本有关环境的书，询问能借多久，以及何时归还。用 2–3 句英文表达，可以夹中文求助。', words: ['borrow', 'return', 'environment'], opening: 'Hello! How can I help you at the library today?', example: 'I would like to borrow a book about the environment. How long can I keep it? When should I return it?' },
  { id: 'hotel', title: '预订旅馆', task: '预订一个住两晚的房间，询问是否含早餐。用 2–3 句英文表达。', words: ['book', 'available', 'include'], opening: 'Welcome! What kind of room are you looking for?', example: 'I would like to book a room for two nights. Is a double room available? Does the price include breakfast?' },
  { id: 'ielts', title: '雅思话题：保护环境', task: '提出一条保护环境的建议，并说明原因。尝试使用至少两个目标词。', words: ['environment', 'reduce', 'pollution'], opening: 'What can people do to protect the environment?', example: 'People can take public transport to reduce pollution. This helps protect the environment.' },
]
export const feedbackSchema = z.object({
  reply: z.string().trim().min(1).max(2000),
  corrected: z.string().trim().min(1).max(3000),
  summary: z.string().trim().min(1).max(1500),
  corrections: z.array(z.object({ type: z.enum(['grammar', 'word_usage', 'spelling', 'chinese_help']), original: z.string().min(1).max(1000), replacement: z.string().min(1).max(1000), explanation: z.string().min(1).max(1500) })).max(10),
  weakWords: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z'-]*$/).max(60)).max(10),
})
export function validateFeedback(value, answer) {
  const parsed = feedbackSchema.parse(value)
  if (parsed.corrections.some(c => !answer.includes(c.original))) throw new Error('纠错引用未出现在原文中')
  return parsed
}
