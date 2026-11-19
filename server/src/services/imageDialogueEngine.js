import { buildScenarioMessages, validateScenario } from './scenarioEngine.js'
import { containsWord } from './dialogueEngine.js'

// Repeating a displayed model sentence is still assisted on later picture turns.
export function copiedImageHelp(session, text) {
  if (!session.scene.memoryImage) return null
  const normalize = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const help = (session.helpEvents || []).find(item => item.example && normalize(item.example) === normalize(text))
  if (!help) return null
  return { level: Math.max(2, help.level || 0), words: session.scene.targets.filter(target => containsWord(help.example, target.word)).map(target => target.word) }
}

export function imageScenarioRequest(image, difficulty = 'beginner') {
  return {
    description: `根据这张单词记忆图设计三轮简短角色对话。图片的记忆说明：${image.explanation || '围绕目标词的日常场景'}。只练习 ${image.word} 的「${image.sense}」义项。`.slice(0, 1500),
    difficulty, targetWords: [image.word.toLowerCase()],
  }
}

export function buildImageScenarioMessages(image, difficulty) {
  const messages = buildScenarioMessages(imageScenarioRequest(image, difficulty))
  messages[0].content += '\n这是看图三轮练习。用户数据中的memoryImage是已有图片的记忆说明，并非图片视觉识别结果。以说明中的动作和关系为背景，设计可在三轮内完成的小任务。不要虚构具体颜色、数量或左右位置，不要把图片细节当成评分标准；若用户描述与说明不同，允许用户解释。targets只包含指定词，sense必须逐字复制memoryImage.sense。开场不要直接提供目标词的完整答案；每次只问一个问题。'
  messages[1].content = JSON.stringify({ ...JSON.parse(messages[1].content), memoryImage: {
    word: image.word, sense: image.sense, explanation: image.explanation,
  } })
  return messages
}

export function validateImageScenario(raw, image, difficulty) {
  const scene = validateScenario(raw, imageScenarioRequest(image, difficulty))
  if (scene.targets[0].sense !== image.sense) throw new Error('看图练习必须使用记忆图选中的原始词义')
  return { ...scene, memoryImage: image, minTurns: 3, maxTurns: 3 }
}
