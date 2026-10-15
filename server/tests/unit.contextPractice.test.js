import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { validateFeedback } from '../src/services/contextPractice.js'
import { parseWordlist } from '../src/services/wordlist/parse.js'
test('feedback rejects invented evidence', () => {
  const valid = { reply: 'Hello!', corrected: 'I borrowed a book.', summary: '注意过去式', corrections: [{ type: 'grammar', original: 'borrow', replacement: 'borrowed', explanation: '过去时使用过去式' }], weakWords: ['borrow'] }
  assert.ok(validateFeedback(valid, 'I borrow a book yesterday.'))
  assert.throws(() => validateFeedback(valid, 'Hello'))
})
test('bundled IELTS source parses into distinct words with definitions', () => {
  const text = fs.readFileSync(new URL('../../third_party/ielts/vocabulary.txt', import.meta.url), 'utf8')
  const { entries } = parseWordlist(text, 'ielts-pipe')
  assert.ok(entries.length > 1500)
  assert.equal(new Set(entries.map(w => w.spelling)).size, entries.length)
  assert.ok(entries.every(w => w.definitions.length))
})

