import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { config } from '../src/config.js'
import { createClient, createOnboardedUser, getTestServer, playSession } from './helpers/setup.js'

const IMAGE = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'
const TEXT_ENDPOINT = 'https://memory-text.example.test/v1/chat/completions'
const SCENE = 'A mug tips over and a stream of coffee lands on the desk.'

function useTextProvider(t) {
  const original = { ...config.ai }
  t.after(() => Object.assign(config.ai, original))
  Object.assign(config.ai, { apiKey: 'test-text-key', baseUrl: 'https://memory-text.example.test/v1' })
}

function sceneResponse(options) {
  const { targetWord } = JSON.parse(JSON.parse(options.body).messages[1].content)
  const content = JSON.stringify({ scene: SCENE, explanation: `${targetWord}：杯子翻倒，咖啡洒在桌面上。` })
  return Response.json({ choices: [{ message: { content } }] })
}

async function waitForCard(client, path, token) {
  let card
  for (let attempt = 0; attempt < 50; attempt++) {
    card = (await client.get(path, { token })).data
    if (card.selected.status !== 'pending') break
    await delay(20)
  }
  return card
}

test('错词记忆图后台生成、去重、按词义保存并隔离账号', async t => {
  const server = await getTestServer()
  const client = createClient(server.baseUrl)
  const owner = await createOnboardedUser(client)
  const other = await createOnboardedUser(client)
  const { session, items } = await playSession(client, owner, { strategy: 'all-wrong', maxAnswers: 2 })
  const [first, second] = items
  const sense = first.word.definitions[0]
  const path = `/api/v1/words/${first.wordId}/memory-image`
  const request = { token: owner.token, body: { sense, sessionId: session.id } }
  const originalConfig = { ...config.wordImages }
  t.after(() => Object.assign(config.wordImages, originalConfig))
  Object.assign(config.wordImages, { baseUrl: 'https://images.example.test/v1', apiKey: 'test-image-key', dailyQuota: 2, siliconFlow: false })
  useTextProvider(t)

  const upstream = Promise.withResolvers()
  const prompts = []
  const inputs = []
  let invalidScene = false
  const realFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === TEXT_ENDPOINT) {
      inputs.push(JSON.parse(JSON.parse(options.body).messages[1].content))
      return invalidScene ? Response.json({ choices: [{ message: { content: '{"scene":""}' } }] }) : sceneResponse(options)
    }
    if (url !== 'https://images.example.test/v1/images/generations') return realFetch(url, options)
    prompts.push(JSON.parse(options.body))
    return upstream.promise
  })

  assert.equal((await client.get(path)).status, 401)
  assert.equal((await client.post(path, { ...request, token: other.token })).status, 403)
  assert.equal((await client.post(path, { ...request, body: { sense: '不在词库中的释义' } })).status, 400)
  assert.equal((await client.post(path, { ...request, body: { sense, sessionId: session.id + 10000 } })).status, 400)
  assert.equal((await client.get(path, { token: owner.token })).data.selected.status, 'empty')
  assert.equal(prompts.length, 0)

  const submissions = await Promise.all([client.post(path, request), client.post(path, request)])
  assert.deepEqual(submissions.map(response => response.data?.status), ['pending', 'pending'])
  assert.equal(inputs.length, 1)
  assert.equal(inputs[0].targetWord, first.word.spelling)
  assert.equal(inputs[0].targetMeaning, sense)
  assert.ok(inputs[0].wrongChoice?.meaning)
  assert.ok(inputs[0].wrongChoice?.spelling)
  assert.equal(prompts.length, 1)
  assert.ok(prompts[0].prompt.includes(SCENE))
  assert.equal(prompts[0].output_format, 'webp')
  assert.equal((await client.get(path, { token: owner.token })).data.selected.status, 'pending')
  assert.equal((await client.post(`/api/v1/words/${second.wordId}/memory-image`, {
    token: owner.token, body: { sense: second.word.definitions[0] },
  })).status, 429)

  upstream.resolve(Response.json({ data: [{ b64_json: IMAGE }] }))
  const card = await waitForCard(client, path, owner.token)
  assert.equal(card.selected.status, 'ready')
  assert.equal(card.image, IMAGE)
  assert.equal(card.explanation, `${first.word.spelling}：杯子翻倒，咖啡洒在桌面上。`)
  assert.equal((await client.get(path, { token: other.token })).data.image, null)
  invalidScene = true
  assert.equal((await client.post(path, { ...request, body: { ...request.body, regenerate: true } })).data.status, 'pending')
  const preserved = await waitForCard(client, path, owner.token)
  assert.equal(preserved.image, IMAGE)
  assert.equal(preserved.explanation, card.explanation)
  assert.equal(preserved.selected.generationError, 'scene')
  config.wordImages.apiKey = ''
  assert.equal((await client.post(path, request)).data.status, 'ready')
  assert.equal((await client.get(path, { token: owner.token })).data.image, IMAGE)
  assert.equal(prompts.length, 1)
})

test('硅基流动使用统一插画提示词，从受信任链接下载图片并转为 WebP', async t => {
  const server = await getTestServer()
  const client = createClient(server.baseUrl)
  const { token } = await createOnboardedUser(client)
  const { items } = await playSession(client, { token }, { strategy: 'all-wrong', maxAnswers: 1 })
  const word = items[0].word
  const sense = word.definitions[0]
  const path = `/api/v1/words/${word.id}/memory-image`
  const originalConfig = { ...config.wordImages }
  t.after(() => Object.assign(config.wordImages, originalConfig))
  Object.assign(config.wordImages, {
    baseUrl: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors', apiKey: 'test-image-key', dailyQuota: 2, siliconFlow: true,
  })
  useTextProvider(t)

  const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#E9E1D7' } }).jpeg().toBuffer()
  const imageUrl = 'https://sc-maas.oss-cn-shanghai.aliyuncs.com/outputs/test.jpeg?signature=test'
  const blockedUrl = 'https://untrusted.example.test/outputs/test.jpeg'
  const generations = []
  const downloads = []
  const realFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === TEXT_ENDPOINT) return sceneResponse(options)
    if (url === 'https://api.siliconflow.cn/v1/images/generations') {
      generations.push(options)
      return Response.json({ images: [{ url: generations.length === 1 ? blockedUrl : imageUrl }] })
    }
    if (url === imageUrl || url === blockedUrl) {
      downloads.push(options)
      return new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } })
    }
    return realFetch(url, options)
  })

  const request = { token, body: { sense } }
  assert.equal((await client.post(path, request)).data.status, 'pending')
  assert.equal((await waitForCard(client, path, token)).selected.status, 'failed')
  assert.equal(downloads.length, 0)
  assert.equal((await client.post(path, request)).data.status, 'pending')
  const card = await waitForCard(client, path, token)
  assert.equal(card.selected.status, 'ready')
  assert.equal((await sharp(Buffer.from(card.image, 'base64')).metadata()).format, 'webp')
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].headers, undefined)
  assert.equal(downloads[0].redirect, 'error')

  const { model, prompt, image_size, negative_prompt } = JSON.parse(generations[0].body)
  assert.equal(model, 'Kwai-Kolors/Kolors')
  assert.equal(image_size, '1024x1024')
  assert.ok(prompt.includes(SCENE))
  assert.ok(prompt.includes('Morandi') && prompt.includes('#E9E1D7'))
  assert.match(negative_prompt, /photorealism/)
  assert.equal(generations[0].headers.Authorization, 'Bearer test-image-key')
})
