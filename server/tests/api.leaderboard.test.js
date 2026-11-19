import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query, execute } from '../src/db/pool.js'
import { todayKey, businessDayStartUtc, addDays } from '../src/utils/time.js'

let client, words, cloneBook
const users = []
before(async () => {
  client = createClient((await getTestServer()).baseUrl)
  words = await query('SELECT id FROM words ORDER BY id LIMIT 5')
})
after(async () => {
  for (const id of users) await execute('DELETE FROM users WHERE id=?', [id])
  if (cloneBook) await execute('DELETE FROM wordbooks WHERE id=?', [cloneBook])
})
async function user() {
  const value = await createOnboardedUser(client)
  users.push(value.userId)
  return value
}
async function answer(owner, word, at = new Date(), source = 'study') {
  await execute(`INSERT INTO answer_logs (user_id,word_id,result,quality,source,created_at)
    VALUES (?,?,1,4,?,?)`, [owner.userId, word, source, at])
}
async function board(owner, period = 'total') {
  const response = await client.get(`/api/v1/stats/leaderboard?period=${period}`, { token: owner.token })
  assert.equal(response.status, 200)
  return response.data
}

test('rankings require login, validate periods and return zero for a new learner', async () => {
  assert.equal((await client.get('/api/v1/stats/leaderboard')).status, 401)
  const owner = await user()
  assert.equal((await client.get('/api/v1/stats/leaderboard?period=x', { token: owner.token })).status, 400)
  assert.deepEqual((await board(owner)).me, { rank: null, words: 0, name: '我', isMe: true, avatarUrl: null })
})

test('total deduplicates repeat answers and the same spelling across books; ties share a rank and contacts stay private', async () => {
  const owner = await user(), peer = await user()
  for (const value of [owner, peer]) {
    for (const word of words.slice(0, 3)) await answer(value, word.id)
  }
  await answer(owner, words[0].id, new Date(), 'review')
  await answer(owner, words[3].id, new Date(), 'game')
  cloneBook = (await execute("INSERT INTO wordbooks (code,name,scope) VALUES ('ranking-dedupe','Ranking test','custom')")).insertId
  const clone = await execute(`INSERT INTO words (wordbook_id,spelling,spelling_norm,definitions,examples)
    SELECT ?,spelling,spelling_norm,definitions,examples FROM words WHERE id=?`, [cloneBook, words[0].id])
  await answer(owner, clone.insertId)
  const result = await board(owner), other = await board(peer)
  assert.equal(result.me.words, 3)
  assert.equal(result.me.rank, other.me.rank)
  assert.ok(result.items.some(item => item.name === `学习者·${String(peer.userId).padStart(4, '0')}`))
  const raw = JSON.stringify(result)
  assert.ok(!raw.includes(peer.email) && !raw.includes('测试用户'))
  assert.ok(result.items.every(item => Object.keys(item).sort().join() === 'avatarUrl,isMe,name,rank,words'))
})

test('daily ranking uses the local midnight boundary, includes reviews, excludes tomorrow and deduplicates today', async () => {
  const owner = await user()
  const start = businessDayStartUtc(todayKey()), end = businessDayStartUtc(addDays(todayKey(), 1))
  await answer(owner, words[0].id, new Date(start.getTime() - 1000))
  await answer(owner, words[1].id, start, 'review')
  await answer(owner, words[1].id, new Date(start.getTime() + 1000))
  await answer(owner, words[2].id, new Date(end.getTime() - 1000))
  await answer(owner, words[3].id, end)
  await answer(owner, words[4].id, start, 'reading')
  const result = await board(owner, 'daily')
  assert.equal(result.me.words, 2)
  assert.equal(result.date, todayKey())
  assert.equal((await board(owner)).me.words, 4)
})

test('a learner below the first 50 still sees their own rank and total', async () => {
  const owner = await user()
  await answer(owner, words[0].id)
  for (let i = 0; i < 55; i++) {
    const inserted = await execute("INSERT INTO users (email,password_hash) VALUES (?, 'test-only')", [`ranking-${i}@example.com`])
    users.push(inserted.insertId)
    await answer({ userId: inserted.insertId }, words[0].id)
    await answer({ userId: inserted.insertId }, words[1].id)
  }
  const result = await board(owner)
  assert.equal(result.items.length, 50)
  assert.ok(result.me.rank > 50)
  assert.equal(result.me.words, 1)
  assert.ok(!result.items.some(item => item.isMe))
})
