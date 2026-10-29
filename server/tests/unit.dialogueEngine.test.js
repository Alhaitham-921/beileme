import test from 'node:test'
import assert from 'node:assert/strict'
import { DIALOGUE_SCENES, sceneFor, difficultyFor, recoverTurn, validateTurn, validateReport, updateTargetUsage, buildHelp, buildEvidence, buildTurnMessages, buildReportMessages, containsWord } from '../src/services/dialogueEngine.js'

const scene = sceneFor('bank', 'beginner')
const fresh = () => scene.targets.map(t => ({ word: t.word, sense: t.sense, status: 'unused', helpLevel: 0 }))
const turn = (patch = {}) => ({ reply: 'There is a path by the river.', translation: '河边有一条小路。', mixedLanguage: false, corrections: [], usedTargets: [], taskComplete: false, ...patch })
const report = (patch = {}) => ({ summary: '继续练习河岸的表达。', corrections: [], weakWords: [], reinforcement: [], grammarWeaknesses: [], ...patch })
const session = (patch = {}) => ({ scene, difficulty: 'beginner', strictness: 'balanced', targetUsage: fresh(), messages: [{ role: 'assistant', text: scene.opening }], ...patch })

test('classic scenes expose distinct bank senses and adapt difficulty without mutating templates', () => {
  assert.deepEqual(DIALOGUE_SCENES.map(item => item.id), ['restaurant', 'directions', 'bank', 'hotel', 'interview', 'shopping', 'campus'])
  assert.equal(scene.targets.find(t => t.word === 'bank').sense, '河岸')
  const finance = sceneFor('bank', 'advanced', 'finance')
  assert.equal(finance.targets.find(t => t.word === 'bank').sense, '银行')
  assert.equal(finance.difficulty, 'advanced')
  assert.ok(finance.speechRate > scene.speechRate)
  assert.equal(scene.showTranslation, true)
  finance.targets[0].sense = 'changed'
  assert.equal(sceneFor('bank', 'advanced', 'finance').targets[0].sense, '银行')
  assert.throws(() => sceneFor('bank', 2, 'unknown'))
  assert.equal(difficultyFor({ assessment: { total: 12, bands: [{ band: 1, tested: 4, mastery: 0.9 }] }, selfLevel: '6000 以上' }), 'beginner')
  for (const template of DIALOGUE_SCENES) {
    const generated = sceneFor(template.id, 'advanced')
    assert.equal(generated.difficulty, 'advanced')
    assert.ok(generated.targets.length >= 3 && generated.targets.length <= 5)
    for (const target of generated.targets) {
      assert.ok(target.sense && target.phrase)
      assert.ok(containsWord(target.example, target.word))
    }
  }
})

test('new target words recognize regular inflections without treating substrings or short words as evidence', () => {
  assert.equal(containsWord('I have two reservations.', 'reservation'), true)
  assert.equal(containsWord('I studied in London.', 'study'), true)
  assert.equal(containsWord('I exchanged the shirt.', 'exchange'), true)
  assert.equal(containsWord('We are planning the project.', 'plan'), true)
  assert.equal(containsWord('This is a classroom.', 'room'), false)
  assert.equal(containsWord('This is a banker.', 'bank'), false)
  assert.equal(containsWord('It is nice.', 'as'), false)
  assert.equal(containsWord('The student asked me.', 'ask'), true)
})

test('custom vocabulary accepts common irregular and short verb forms while grounding turn evidence', () => {
  for (const [word, sentence] of [
    ['buy', 'I bought a book.'], ['try', 'I tried the local food.'], ['make', 'I made a reservation.'],
    ['take', 'I took the bus.'], ['choose', 'I chose a quiet room.'], ['child', 'The children are here.'],
    ['be', 'They were happy.'], ['have', 'I had breakfast.'], ['die', 'The battery is dying.'],
    ['travel', 'I travelled to London.'], ['prefer', 'I preferred the other room.'],
  ]) {
    assert.equal(containsWord(sentence, word), true, `${word}: ${sentence}`)
    const custom = { targets: [{ word, sense: '本场景义项' }] }
    const validated = validateTurn(turn({ usedTargets: [{ word, sense: '本场景义项', correct: true }] }), sentence, custom)
    assert.equal(validated.usedTargets[0].word, word)
  }
  assert.equal(containsWord('I talked about it.', 'talk'), true)
  assert.equal(containsWord('It is nice.', 'as'), false)
  assert.equal(containsWord('I visited the market.', 'buy'), false)
})

test('free practice follows the conversation and does not request early completion', () => {
  const messages = buildTurnMessages(session({ mode: 'free', maxTurns: 24 }), 'Can we discuss another option?')
  assert.match(messages[0].content, /taskComplete始终为false/)
  assert.match(messages[0].content, /最多24轮/)
  assert.match(messages[0].content, /允许用户改变谈话方向/)
  assert.doesNotMatch(messages[0].content, /至少6轮/)
  assert.match(buildTurnMessages(session({ mode: 'task', maxTurns: 16 }), 'Hello.')[0].content, /最多16轮/)
})

test('turn validation rejects invented target usage and wrong target sense', () => {
  const bank = { word: 'bank', sense: '河岸', correct: true }
  assert.throws(() => validateTurn(turn({ usedTargets: [bank] }), 'Thank you.', scene), /证据/)
  assert.throws(() => validateTurn(turn({ usedTargets: [{ ...bank, sense: '银行' }] }), 'The bank is nearby.', scene), /义项/)
  assert.throws(() => validateTurn(turn({ usedTargets: [bank] }), 'The banker is nearby.', scene), /证据/)
  assert.equal(validateTurn(turn({ usedTargets: [bank] }), 'Both banks are beautiful.', scene).usedTargets.length, 1)
})

test('sense misuse overrides model success and correction excerpts must be grounded', () => {
  const correction = { type: 'sense_misuse', original: 'bank', replacement: 'river bank', explanation: '这里说的是河岸。' }
  const result = validateTurn(turn({ corrections: [correction], usedTargets: [{ word: 'bank', sense: '河岸', correct: true }] }), 'Can I open a bank here?', scene)
  assert.equal(result.usedTargets[0].correct, false)
  assert.equal(result.corrections[0].originalSentence, 'Can I open a bank here?')
  assert.equal(result.corrections[0].correctedSentence, 'Can I open a river bank here?')
  assert.throws(() => validateTurn(turn({ corrections: [correction] }), 'Hello.', scene), /引用/)
  assert.throws(() => validateTurn(turn({ corrections: Array(6).fill(correction) }), 'bank', scene))
})

test('mixed Chinese always requires an English model and never counts that model as use', () => {
  assert.throws(() => validateTurn(turn(), '我想沿河岸散步。', scene), /完整英文/)
  const result = validateTurn(turn({ helpEnglish: 'I would like to walk along the river bank.' }), '我想沿河岸散步。', scene)
  assert.equal(result.mixedLanguage, true)
  assert.deepEqual(result.usedTargets, [])
  assert.throws(() => validateTurn(turn({ helpEnglish: 'I would like to walk along the 河岸.' }), '河岸', scene), /完整英文/)
})

test('assisted repetition remains assisted until a later independent use', () => {
  const response = turn({ usedTargets: [{ word: 'bank', sense: '河岸', correct: true }] })
  const assisted = updateTargetUsage(fresh(), response, 'The river bank is quiet.', 4)
  assert.equal(assisted.find(t => t.word === 'bank').status, 'assisted')
  assert.equal(assisted.find(t => t.word === 'bank').independent, false)
  const independent = updateTargetUsage(assisted, response, 'I like walking along this bank.', 0)
  assert.equal(independent.find(t => t.word === 'bank').status, 'independent')
  assert.equal(independent.find(t => t.word === 'bank').helpLevel, 4)
  assert.equal(buildEvidence(session({ targetUsage: independent }))[0].status, 'weak')
})

test('unattempted words yield no evidence, explicit help weighs more with stronger help', () => {
  assert.deepEqual(buildEvidence(session()), [])
  const helpTurn = { usedTargets: [{ word: 'bank', sense: '河岸', correct: false }], helpRequest: true, corrections: [] }
  const level2 = buildEvidence(session({ targetUsage: updateTargetUsage(fresh(), helpTurn, '', 2) }))[0]
  const level4 = buildEvidence(session({ targetUsage: updateTargetUsage(fresh(), helpTurn, '', 4) }))[0]
  assert.equal(level2.status, 'weak')
  assert.ok(level4.weight > level2.weight)
  assert.deepEqual(buildEvidence(session(), report({ weakWords: ['sit'] })), [])
})

test('help is limited to current scene words and grows from keyword to full example', () => {
  assert.equal(buildHelp(session(), { level: 2, word: 'bank' }).hint, 'river bank')
  assert.equal(buildHelp(session(), { level: 4, word: 'bank' }).example, 'Is there a path along the river bank nearby?')
  assert.throws(() => buildHelp(session(), { level: 4, word: 'menu' }), /目标词/)
})

test('report rejects unseen weak words and fabricated original sentences', () => {
  const data = session({ messages: [{ role: 'user', text: 'I sit here yesterday.' }] })
  const correction = { type: 'grammar', original: 'sit', replacement: 'sat', explanation: '昨天用过去时。', grammarTag: 'tense' }
  const result = validateReport(report({ corrections: [correction], weakWords: ['sit'], reinforcement: [{ word: 'sit', prompt: '请表达：我昨天坐在这里。', answer: 'I sat here yesterday.', explanation: 'sit的过去式是sat。' }], grammarWeaknesses: ['编造的语法问题'] }), data)
  assert.equal(result.corrections[0].correctedSentence, 'I sat here yesterday.')
  assert.deepEqual(result.grammarWeaknesses, [])
  assert.throws(() => validateReport(report({ weakWords: ['bank'] }), data), /证据/)
  assert.throws(() => validateReport(report({ corrections: [{ ...correction, originalSentence: 'I sit at the bank.' }] }), data), /引用/)
})

test('weekly grammar signal needs the same grounded type in two different user messages', () => {
  const correction = { type: 'grammar', original: 'sit', replacement: 'sat', explanation: '使用过去时。', grammarTag: 'tense' }
  const data = session({ messages: [{ role: 'user', text: 'I sit here yesterday.', corrections: [correction] }, { role: 'user', text: 'I sit there last week.', corrections: [correction] }] })
  assert.deepEqual(validateReport(report(), data).grammarWeaknesses, ['时态'])
})

test('report derives weak target and reinforcement from correction even if model omitted weakWords', () => {
  const correction = { type: 'sense_misuse', original: 'bank', replacement: 'river bank', explanation: '此处指河岸。' }
  const data = session({ messages: [{ role: 'user', text: 'Can I open a bank here?' }] })
  const result = validateReport(report({ corrections: [correction] }), data)
  assert.deepEqual(result.weakWords, ['bank'])
  assert.equal(result.reinforcement[0].word, 'bank')
  assert.equal(buildEvidence(data, result)[0].status, 'weak')
  assert.ok(buildEvidence(data, result)[0].tags.includes('sense_misuse'))
})

test('help evidence survives an empty transcript and missing report weakWords', () => {
  const data = session({ helpEvents: [{ level: 4, word: 'bank' }] })
  const result = validateReport(report(), data)
  assert.deepEqual(result.weakWords, ['bank'])
  assert.equal(result.reinforcement.length, 1)
  assert.equal(buildEvidence(data, result)[0].status, 'weak')
  assert.equal(buildEvidence(data, result)[0].helpLevel, 4)
})

test('model cannot label a correctly used word weak without an error or assistance', () => {
  const data = session({ messages: [{ role: 'user', text: 'May I sit here?' }] })
  const result = validateReport(report({ weakWords: ['sit'] }), data)
  assert.deepEqual(result.weakWords, [])
  assert.deepEqual(buildEvidence(data, result), [])
})

test('Chinese helpWord must be a target in the English demonstration', () => {
  assert.equal(validateTurn(turn({ helpEnglish: 'May I sit here?', helpWord: 'sit' }), '我能坐这里吗', scene).helpWord, 'sit')
  assert.throws(() => validateTurn(turn({ helpEnglish: 'May I sit here?', helpWord: 'bank' }), '我能坐这里吗', scene), /求助词/)
})

test('word-specific help does not downgrade other independently used targets', () => {
  const response = turn({ assistanceWord: 'bank', usedTargets: [{ word: 'bank', sense: '河岸', correct: true }, { word: 'nearby', sense: '在附近', correct: true }] })
  const result = updateTargetUsage(fresh(), response, 'Is there a river bank nearby?', 4)
  assert.equal(result.find(t => t.word === 'bank').status, 'assisted')
  assert.equal(result.find(t => t.word === 'nearby').status, 'independent')
})

test('all words from a demonstrated sentence are assisted while a new target stays independent', () => {
  const response = turn({ assistanceWords: ['bank', 'nearby'], usedTargets: [
    { word: 'bank', sense: '河岸', correct: true }, { word: 'nearby', sense: '在附近', correct: true }, { word: 'sit', sense: '坐', correct: true },
  ] })
  const result = updateTargetUsage(fresh(), response, 'May I sit here? Is there a river bank nearby?', 4)
  assert.equal(result.find(t => t.word === 'bank').status, 'assisted')
  assert.equal(result.find(t => t.word === 'nearby').status, 'assisted')
  assert.equal(result.find(t => t.word === 'sit').status, 'independent')
  const evidence = buildEvidence(session({ targetUsage: result }))
  assert.equal(evidence.find(t => t.word === 'nearby').status, 'weak')
  assert.equal(evidence.find(t => t.word === 'sit').independentSuccess, true)
})

test('assistance that contains no target does not fabricate target weakness', () => {
  const data = session({ helpEvents: [{ level: 3, word: null, example: 'Thank you for your help.' }] })
  assert.deepEqual(validateReport(report(), data).weakWords, [])
  assert.deepEqual(buildEvidence(data), [])
  const response = turn({ assistanceWords: [], usedTargets: [{ word: 'sit', sense: '坐', correct: true }] })
  assert.equal(updateTargetUsage(fresh(), response, 'May I sit here?', 3).find(t => t.word === 'sit').status, 'independent')
})

test('prompts include role, strictness, exact word sense, transcript and capped report structure', () => {
  const data = session({ strictness: 'strict', messages: [{ role: 'assistant', text: 'Hello.' }, { role: 'user', text: 'May I sit here?' }] })
  const messages = buildTurnMessages(data, 'Thank you.')
  const input = JSON.parse(messages.at(-1).content)
  assert.equal(input.currentUserText, 'Thank you.')
  assert.deepEqual(input.transcript, [{ role: 'assistant', content: 'Hello.' }, { role: 'user', content: 'May I sit here?' }])
  assert.deepEqual(messages.map(message => message.role), ['system', 'user'])
  assert.match(messages[0].content, /河岸/)
  assert.match(messages[0].content, /strict/)
  assert.match(messages[0].content, /至少6轮/)
  const final = buildReportMessages(data)
  assert.match(final[1].content, /May I sit here/)
  assert.match(final[0].content, /最多5条/)
})


test('conversation recovery drops ungrounded feedback while retaining usable reply and verified claims', () => {
  const text = 'The bank is nearby.'
  const valid = { type: 'grammar', original: 'is', replacement: 'was', explanation: '时态建议' }
  const result = recoverTurn(turn({ corrections: [valid, { ...valid, original: 'imagined quote' }, { type: 'unknown' }],
    usedTargets: [{ word: 'bank', sense: '河岸', correct: true }, { word: 'bank', sense: '河岸', correct: true }, { word: 'sit', sense: '坐', correct: true }] }), text, scene)
  assert.equal(result.reply, turn().reply)
  assert.equal(result.corrections.length, 1)
  assert.deepEqual(result.usedTargets.map(t => t.word), ['bank'])
  assert.equal(validateTurn(result, text, scene).corrections[0].originalSentence, text)
})

test('recovery rejects missing core reply or Chinese assistance and preserves sense corrections', () => {
  assert.throws(() => recoverTurn({ reply: 'incomplete' }, 'Hello', scene))
  assert.throws(() => recoverTurn(turn({ reply: '' }), 'Hello', scene))
  assert.throws(() => recoverTurn(turn(), '我想去河边', scene), /完整英文/)
  const result = recoverTurn(turn({ corrections: [{ type: 'sense_misuse', original: 'bank', replacement: 'river bank', explanation: '此处是河岸' }], usedTargets: [{word:'bank',sense:'河岸',correct:true}], helpWord:'invented' }), 'The bank is nearby.', scene)
  assert.equal(result.usedTargets[0].correct, false)
  assert.equal(result.helpWord, undefined)
})
