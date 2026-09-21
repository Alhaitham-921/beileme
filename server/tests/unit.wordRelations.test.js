import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  levenshtein,
  formSimilarity,
  meaningSimilarity,
  buildRelations,
  buildRelationsBulk,
  diffSpelling,
} from '../src/services/wordRelations.js'

test('levenshtein：基础距离正确', () => {
  assert.equal(levenshtein('abc', 'abc'), 0)
  assert.equal(levenshtein('abc', 'abd'), 1)
  assert.equal(levenshtein('adapt', 'adopt'), 1)
  assert.equal(levenshtein('', 'abc'), 3)
  assert.equal(levenshtein('abc', ''), 3)
})

test('formSimilarity：经典易混对得分高，无关词得分低', () => {
  const adaptAdopt = formSimilarity('adapt', 'adopt')
  const accessAssess = formSimilarity('access', 'assess')
  const abandonAbility = formSimilarity('abandon', 'ability')

  assert.ok(adaptAdopt > 0.6, `adapt/adopt 实际 ${adaptAdopt}`)
  assert.ok(accessAssess > 0.6, `access/assess 实际 ${accessAssess}`)
  assert.ok(abandonAbility < 0.5, `abandon/ability 实际 ${abandonAbility}`)
  assert.equal(formSimilarity('word', 'word'), 1)
  assert.equal(formSimilarity('', 'word'), 0)
})

test('formSimilarity：大小写不敏感', () => {
  assert.equal(formSimilarity('Adapt', 'adopt'), formSimilarity('adapt', 'adopt'))
})

test('meaningSimilarity：共享释义的近义词得分高', () => {
  const synonym = meaningSimilarity(['能力', '才能'], ['能力', '容量'])
  const unrelated = meaningSimilarity(['能力', '才能'], ['古代的', '古老的'])

  assert.ok(synonym > 0.2, `近义对实际 ${synonym}`)
  assert.ok(unrelated < 0.05, `无关对实际 ${unrelated}`)
  assert.equal(meaningSimilarity([], ['能力']), 0)
})

test('buildRelations：同一对词双向各生成一条关系', () => {
  const words = [
    { id: 1, spelling: 'adapt', definitions: ['适应', '改编'] },
    { id: 2, spelling: 'adopt', definitions: ['采用', '收养'] },
    { id: 3, spelling: 'banana', definitions: ['香蕉'] },
  ]

  const relations = buildRelations(words)
  const pair = relations.filter(
    (relation) =>
      (relation.word_id === 1 && relation.related_word_id === 2) ||
      (relation.word_id === 2 && relation.related_word_id === 1)
  )

  assert.equal(pair.length, 2, '形近关系应双向各一条')
  assert.ok(pair.every((relation) => relation.relation_type === 'form'))
  assert.equal(relations.some((relation) => relation.related_word_id === 3), false)
})

test('buildRelations：perTypeLimit 限制每个词每种关系类型的候选数量', () => {
  // 形近但释义各不相同：只会产生 form 关系
  const words = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    spelling: `adapt${String.fromCharCode(97 + index)}`,
    definitions: [`甲${index}`],
  }))

  const relations = buildRelations(words, { perTypeLimit: 2 })
  const counts = new Map()
  for (const relation of relations) {
    const key = `${relation.word_id}|${relation.relation_type}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  assert.ok(counts.size > 0, '应至少产生一些关系')
  for (const [key, count] of counts) {
    assert.ok(count <= 2, `${key} 候选不应超过 2，实际 ${count}`)
  }
})

test('buildRelations：同一个词可以同时保留形近与近义两类候选', () => {
  const words = [
    { id: 1, spelling: 'adapt', definitions: ['适应'] },
    // 形近（adapt/adapts）但释义不同
    { id: 2, spelling: 'adapts', definitions: ['甲'] },
    // 近义（共享「适应」）但词形不相似
    { id: 3, spelling: 'adjust', definitions: ['适应'] },
  ]

  const relations = buildRelations(words, { perTypeLimit: 2 })
  const typesForWord1 = new Set(
    relations.filter((relation) => relation.word_id === 1).map((relation) => relation.relation_type)
  )

  assert.ok(typesForWord1.has('form'), '应保留形近候选')
  assert.ok(typesForWord1.has('meaning'), '应保留近义候选')
})

test('buildRelations：无关词之间不生成任何关系', () => {
  const words = [
    { id: 1, spelling: 'apple', definitions: ['苹果'] },
    { id: 2, spelling: 'zebra', definitions: ['斑马'] },
  ]
  assert.equal(buildRelations(words).length, 0)
})

test('diffSpelling：拆出公共前后缀与差异段，供词形高亮', () => {
  const diff = diffSpelling('adapt', 'adopt')
  assert.equal(diff.prefix, 'ad')
  assert.equal(diff.suffix, 'pt')
  assert.equal(diff.aMiddle, 'a')
  assert.equal(diff.bMiddle, 'o')

  // 拼回去必须还原原词
  assert.equal(diff.prefix + diff.aMiddle + diff.suffix, 'adapt')
  assert.equal(diff.prefix + diff.bMiddle + diff.suffix, 'adopt')
})

test('diffSpelling：完全相同的词差异段为空', () => {
  const diff = diffSpelling('word', 'word')
  assert.equal(diff.aMiddle, '')
  assert.equal(diff.bMiddle, '')
})

test('diffSpelling：前缀型差异（like / likely）能正确切分', () => {
  const diff = diffSpelling('like', 'likely')
  assert.equal(diff.prefix, 'like')
  assert.equal(diff.aMiddle, '')
  assert.equal(diff.bMiddle, 'ly')
})

describe('大规模词库的关系计算（buildRelationsBulk）', () => {
  const words = [
    { id: 1, spelling: 'adapt', definitions: ['适应', '改编'] },
    { id: 2, spelling: 'adopt', definitions: ['采用', '收养'] },
    { id: 3, spelling: 'effect', definitions: ['影响', '效果'] },
    // 首字母与 effect 不同，但属于最经典的元音互换型形近混淆
    { id: 4, spelling: 'affect', definitions: ['影响', '感动'] },
    { id: 5, spelling: 'banana', definitions: ['香蕉'] },
    { id: 6, spelling: 'principal', definitions: ['校长', '主要的'] },
    { id: 7, spelling: 'principle', definitions: ['原则', '原理'] },
    { id: 8, spelling: 'achieve', definitions: ['实现', '达到'] },
    { id: 9, spelling: 'accomplish', definitions: ['完成', '实现'] },
  ]

  test('能找到同首字母的形近对', () => {
    const relations = buildRelationsBulk(words)
    const found =
      relations.some((r) => r.word_id === 1 && r.related_word_id === 2 && r.relation_type === 'form') &&
      relations.some((r) => r.word_id === 6 && r.related_word_id === 7 && r.relation_type === 'form')
    assert.ok(found, 'adapt/adopt 与 principal/principle 都应被识别')
  })

  test('元音开头的词跨首字母也能识别形近（effect / affect）', () => {
    const relations = buildRelationsBulk(words)
    const pair = relations.find(
      (r) => r.word_id === 3 && r.related_word_id === 4 && r.relation_type === 'form'
    )
    assert.ok(pair, 'effect/affect 首字母不同，但必须被识别为形近混淆')
    assert.ok(pair.score > 0.8, `相似度应较高，实际 ${pair?.score}`)
  })

  test('近义关系依赖共享释义，不共享则不应误连', () => {
    const relations = buildRelationsBulk(words)
    const synonym = relations.find(
      (r) => r.word_id === 8 && r.related_word_id === 9 && r.relation_type === 'meaning'
    )
    assert.ok(synonym, 'achieve / accomplish 共享「实现」，应识别为近义')

    const spurious = relations.find(
      (r) => (r.word_id === 5 || r.related_word_id === 5) && r.relation_type === 'meaning'
    )
    assert.equal(spurious, undefined, 'banana 与任何词都不构成近义关系')
  })

  test('关系是双向记录的', () => {
    const relations = buildRelationsBulk(words)
    const forward = relations.filter((r) => r.word_id === 1 && r.related_word_id === 2)
    const backward = relations.filter((r) => r.word_id === 2 && r.related_word_id === 1)
    assert.equal(forward.length, 1)
    assert.equal(backward.length, 1)
  })

  test('遵守 perTypeLimit', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      spelling: `adapt${String.fromCharCode(97 + index)}`,
      definitions: ['适应'],
    }))
    const relations = buildRelationsBulk(many, { perTypeLimit: 2 })

    const counts = new Map()
    for (const relation of relations) {
      const key = `${relation.word_id}|${relation.relation_type}`
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    for (const [key, count] of counts) {
      assert.ok(count <= 2, `${key} 超出上限：${count}`)
    }
  })

  test('与全量两两比较的结果一致（同一批小数据集）', () => {
    const bulk = buildRelationsBulk(words)
    const exact = buildRelations(words)

    // 用「关键词对 + 类型」集合比较，避免受同分候选的排序差异影响
    const keyOf = (list) =>
      new Set(list.map((r) => `${r.word_id}->${r.related_word_id}:${r.relation_type}`))

    const bulkKeys = keyOf(bulk)
    const exactKeys = keyOf(exact)
    for (const key of exactKeys) {
      assert.ok(bulkKeys.has(key), `分桶实现漏掉了 ${key}`)
    }
  })

  test('空输入与单词输入不会报错', () => {
    assert.deepEqual(buildRelationsBulk([]), [])
    assert.deepEqual(buildRelationsBulk(null), [])
    assert.deepEqual(buildRelationsBulk([{ id: 1, spelling: 'only', definitions: ['唯一'] }]), [])
  })
})
