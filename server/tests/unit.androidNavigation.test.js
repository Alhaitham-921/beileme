import test from 'node:test'
import assert from 'node:assert/strict'
import { fixedTabs, normalizeTabIds, tabMatches, drawerSwipe, navigationModules, mainNavigation } from '../../src/utils/androidNavigation.js'
import { initializeNavigation, saveNavigation, selectedTabIds, androidTabs } from '../../src/stores/navigation.js'

test('custom navigation rejects fixed slots, unknown modules and duplicate choices', () => {
  assert.deepEqual(fixedTabs.map(tab => tab.id), ['today'])
  assert.deepEqual(normalizeTabIds(['today', 'study', 'missing']), ['notebooks', 'practice', 'leaderboard', 'more'])
  assert.equal(new Set(normalizeTabIds(['leaderboard', 'leaderboard', 'leaderboard', 'leaderboard'])).size, 4)
  assert.deepEqual(normalizeTabIds(null), ['notebooks', 'practice', 'leaderboard', 'more'])
  assert.deepEqual(normalizeTabIds(['notebooks', 'practice', 'more']), ['notebooks', 'practice', 'more', 'leaderboard'])
  assert.equal(tabMatches(fixedTabs[0], '/settings'), false)
  assert.equal(tabMatches(fixedTabs[0], '/assessment'), true)
  assert.equal(tabMatches(fixedTabs[0], '/study'), true)
})

test('navigation saves separately per account and always keeps Today in the first slot', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key), setItem: (key, value) => values.set(key, value),
  } })
  try {
    initializeNavigation('navigation-test-a')
    saveNavigation(['leaderboard', 'settings', 'lookup', 'roots'])
    assert.deepEqual(androidTabs.value.map(tab => tab.id), ['today', 'leaderboard', 'settings', 'lookup', 'roots'])
    initializeNavigation('navigation-test-b')
    assert.deepEqual(selectedTabIds.value, ['notebooks', 'practice', 'leaderboard', 'more'])
    initializeNavigation('navigation-test-a')
    assert.deepEqual(selectedTabIds.value, ['leaderboard', 'settings', 'lookup', 'roots'])
    initializeNavigation(null)
    assert.deepEqual(selectedTabIds.value, ['notebooks', 'practice', 'leaderboard', 'more'])
    values.set('beileme:android-tabs:navigation-test-b', '{broken')
    initializeNavigation('navigation-test-b')
    assert.deepEqual(selectedTabIds.value, ['notebooks', 'practice', 'leaderboard', 'more'])
  } finally {
    initializeNavigation(null)
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})

test('drawer swipes reject vertical scrolling, wrong direction, small moves and slow drags', () => {
  const gesture = { startX: 50, startY: 100, endX: 170, endY: 110, elapsedMs: 250 }
  assert.equal(drawerSwipe(gesture), true)
  assert.equal(drawerSwipe({...gesture,endY:250}), false)
  assert.equal(drawerSwipe({...gesture,endX:80}), false)
  assert.equal(drawerSwipe({...gesture,endX:0}), false)
  assert.equal(drawerSwipe({...gesture,elapsedMs:1500}), false)
  assert.equal(drawerSwipe({...gesture,startX:170,endX:50,direction:'close'}), true)
})

test('removed and nested modules cannot stay in custom tabs; nested pages highlight their parent', () => {
  const old = ['ielts', 'speech', 'collocations', 'article']
  assert.deepEqual(normalizeTabIds(old), ['notebooks', 'practice', 'leaderboard', 'more'])
  assert.deepEqual(normalizeTabIds(['ielts', 'settings', 'practice', 'notebooks']), ['leaderboard', 'settings', 'practice', 'notebooks'])
  assert.ok(![...navigationModules, ...mainNavigation].some(module=>old.includes(module.id)))
  const notebooks = navigationModules.find(module=>module.id==='notebooks')
  const review = navigationModules.find(module=>module.id==='review')
  assert.equal(tabMatches(notebooks, '/notebooks/collocations'), true)
  assert.equal(tabMatches(review, '/review/article'), true)
  assert.equal(tabMatches(review, '/review/images'), true)
  assert.equal(tabMatches(notebooks, '/review/article'), false)
})
