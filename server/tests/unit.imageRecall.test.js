import assert from 'node:assert/strict'
import test from 'node:test'
import { buildImageRecallRounds, matchesImageRecall } from '../../src/utils/imageRecall.js'

const picture = (spelling, sense, key) => ({ spelling, sense, imagePath: '/image/' + key })

test('内置练习每组有五道九宫格题，题图不依赖接口', () => {
  const rounds = buildImageRecallRounds([], () => 0.5)
  assert.equal(rounds.length, 5)
  for (const { options } of rounds) {
    assert.equal(new Set(options.map(option => option.key)).size, 9)
    assert.ok(options.every(option => option.url.startsWith('data:image/svg+xml,')))
    assert.ok(options.some(option => option.correct))
    assert.ok(options.some(option => !option.correct))
  }
})

test('同词可多选，重复释义和含相同释义的干扰图不会出现在题中', () => {
  const saved = [
    picture('charge', '收费', 1),
    picture('Charge', '使充电', 2),
    picture('charge', '收费；收取费用', 3),
    picture('bill', '账单；收费', 4),
  ]
  const round = buildImageRecallRounds(saved, () => 0.5).find(item => item.spelling.toLowerCase() === 'charge')
  assert.equal(round.options.length, 9)
  assert.ok(!round.options.some(option => option.spelling === 'bill'))
  const correct = round.options.filter(option => option.correct).map(option => option.key)
  const wrong = round.options.find(option => !option.correct).key
  assert.equal(correct.length, 2)
  assert.equal(matchesImageRecall(round, correct), true)
  assert.equal(matchesImageRecall(round, [correct[0]]), false)
  assert.equal(matchesImageRecall(round, [...correct, wrong]), false)
})
