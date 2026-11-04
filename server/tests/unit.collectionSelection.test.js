import test from 'node:test'
import assert from 'node:assert/strict'
import {toggleCollectionIds,allCollectionIdsSelected} from '../../src/utils/collectionSelection.js'
test('selection survives source and page changes and overlapping words are only counted once',()=>{
  let selected=toggleCollectionIds(new Set(),[1,2,3],true)
  selected=toggleCollectionIds(selected,[3,4,5],true)
  assert.deepEqual([...selected],[1,2,3,4,5])
  assert.ok(allCollectionIdsSelected(selected,[3,4,5]))
  selected=toggleCollectionIds(selected,[3,4,5],false)
  assert.deepEqual([...selected],[1,2]);assert.equal(allCollectionIdsSelected(selected,[3,4,5]),false)
})
test('select-all includes every page, without the former sixty-word truncation',()=>{
  const ids=Array.from({length:137},(_,i)=>i+1)
  const selected=toggleCollectionIds(new Set([200]),ids,true)
  assert.equal(selected.size,138);assert.ok(allCollectionIdsSelected(selected,ids))
  assert.equal(allCollectionIdsSelected(selected,[]),false)
  assert.deepEqual([...toggleCollectionIds(selected,[0,-1,NaN],true)], [...selected])
})
