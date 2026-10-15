import test from 'node:test'
import assert from 'node:assert/strict'
import { morphologyEntries, morphologyGroups, getMorphology } from '../../src/data/morphology.js'

test('curated decompositions preserve exact spelling and valid group references', () => {
  assert.equal(new Set(morphologyEntries.map(e => e.word)).size, morphologyEntries.length)
  for (const entry of morphologyEntries) {
    assert.equal(entry.parts.map(p => p.text).join(''), entry.word)
    assert.ok(morphologyGroups.some(g => g.id === entry.group))
    assert.ok(entry.parts.every(p => p.meaning && p.type))
    assert.ok(entry.meaning && entry.hint)
  }
})
test('explicit lookup handles spelling changes and rejects coincidental prefixes', () => {
  assert.equal(getMorphology(' Happiness ').parts[0].text, 'happi')
  assert.match(getMorphology('usable').hint, /省略/)
  assert.equal(getMorphology('uncle'), null)
  assert.equal(getMorphology('read'), null)
  assert.equal(getMorphology('bank'), null)
  assert.equal(getMorphology(undefined), null)
  const entry = getMorphology('import')
  assert.ok(entry.family.some(w => w.word === 'export'))
  assert.ok(entry.family.every(w => w.group === 'port' && w.word !== 'import'))
})
