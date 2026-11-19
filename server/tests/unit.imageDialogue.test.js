import test from 'node:test'
import assert from 'node:assert/strict'
import { buildImageScenarioMessages, validateImageScenario, copiedImageHelp } from '../src/services/imageDialogueEngine.js'
import { buildTurnMessages } from '../src/services/dialogueEngine.js'

const image = { wordId: 1, word: 'bank', sense: '河岸', imagePath: '/private-image', explanation: '两个人在河岸散步。' }
const scene = () => ({ title: '河边散步', location: '公园河边', role: '散步的朋友', userRole: '同行的朋友',
  task: '聊聊河边的散步路线。', goals: ['描述散步的地方', '商量接下来的路线'],
  targets: [{ word: 'bank', sense: '河岸', phrase: 'river bank', example: 'Let us walk along the river bank.' }],
  opening: 'Where would you like to walk?', openingTranslation: '你想去哪里散步？', example: 'Let us walk along the river bank.' })

test('image scenario keeps the selected sense and server-provided image snapshot', () => {
  const result = validateImageScenario({ ...scene(), memoryImage: { imagePath: 'forged' } }, image, 'beginner')
  assert.deepEqual(result.memoryImage, image)
  assert.equal(result.maxTurns, 3)
  assert.equal(result.targets.length, 1)
  const wrong = scene(); wrong.targets[0].sense = '银行'
  assert.throws(() => validateImageScenario(wrong, image, 'beginner'), /原始词义/)
})

test('image context is input data and three-turn instructions do not inherit six-turn rules', () => {
  const messages = buildImageScenarioMessages(image, 'beginner')
  assert.deepEqual(JSON.parse(messages[1].content).memoryImage, { word: 'bank', sense: '河岸', explanation: image.explanation })
  assert.ok(!messages[0].content.includes(image.explanation))
  const turn = buildTurnMessages({ scene: validateImageScenario(scene(), image, 'beginner'), maxTurns: 3, mode: 'task', messages: [] }, 'Hello')
  assert.match(turn[0].content, /第三轮简短回应并收尾/)
  assert.doesNotMatch(turn[0].content, /至少6轮/)
  assert.match(turn[0].content, /不要断言未核实/)
})

test('copying a previously shown answer remains assisted while a new sentence can be independent', () => {
  const session = { scene: { memoryImage: image, targets: scene().targets }, helpEvents: [{ level: 4, example: 'Let us walk along the river bank.' }] }
  assert.deepEqual(copiedImageHelp(session, 'Let us walk along the river bank!'), { level: 4, words: ['bank'] })
  assert.equal(copiedImageHelp(session, 'I like this river bank.'), null)
})
