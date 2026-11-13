import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { config } from '../src/config.js'
import { createClient, createOnboardedUser, getTestServer, playSession } from './helpers/setup.js'

const IMAGE = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#e9e1d7' } }).webp().toBuffer()
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
  let scenePrompt
  let invalidScene = false
  const realFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === TEXT_ENDPOINT) {
      const messages = JSON.parse(options.body).messages
      scenePrompt = messages[0].content
      inputs.push(JSON.parse(messages[1].content))
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
  assert.equal(inputs[0].partOfSpeech, first.word.pos)
  assert.match(scenePrompt, /decisive instant/)
  assert.match(scenePrompt, /Chinese targetMeaning takes priority/)
  assert.ok(inputs[0].wrongChoice?.meaning)
  assert.ok(inputs[0].wrongChoice?.spelling)
  assert.equal(prompts.length, 1)
  assert.ok(prompts[0].prompt.includes(SCENE))
  assert.equal(prompts[0].output_format, 'webp')
  assert.equal((await client.get(path, { token: owner.token })).data.selected.status, 'pending')
  assert.equal((await client.post(`/api/v1/words/${second.wordId}/memory-image`, {
    token: owner.token, body: { sense: second.word.definitions[0] },
  })).status, 429)

  upstream.resolve(Response.json({ data: [{ b64_json: IMAGE.toString('base64') }] }))
  const card = await waitForCard(client, path, owner.token)
  assert.equal(card.selected.status, 'ready')
  assert.equal(card.image, undefined)
  assert.match(card.imagePath, /^\/words\/\d+\/memory-image\/[a-f0-9]{64}\/[a-f0-9]{64}$/)
  assert.equal(card.explanation, `${first.word.spelling}：杯子翻倒，咖啡洒在桌面上。`)
  assert.equal((await client.get(path, { token: other.token })).data.imagePath, null)
  const imageUrl = server.baseUrl + '/api/v1' + card.imagePath
  assert.equal((await fetch(imageUrl)).status, 401)
  assert.equal((await fetch(imageUrl, { headers: { Authorization: `Bearer ${other.token}` } })).status, 404)
  const image = await fetch(imageUrl, { headers: { Authorization: `Bearer ${owner.token}` } })
  assert.equal(image.headers.get('content-type'), 'image/webp')
  assert.match(image.headers.get('cache-control'), /private/)
  assert.match(image.headers.get('vary'), /Authorization/i)
  assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width, 640)
  const library = '/api/v1/words/memory-images'
  const saved = (await client.get(library, { token: owner.token })).data.items
  assert.deepEqual(saved, [{
    wordId: first.wordId, spelling: first.word.spelling, sense, definitions: first.word.definitions,
    explanation: card.explanation, imagePath: card.imagePath + '/tile',
  }])
  assert.deepEqual((await client.get(library, { token: other.token })).data.items, [])
  const tile = await fetch(imageUrl + '/tile', { headers: { Authorization: `Bearer ${owner.token}` } })
  assert.equal((await sharp(Buffer.from(await tile.arrayBuffer())).metadata()).width, 256)
  invalidScene = true
  const learnerCue = '希望画出杯口朝下和流向桌面的咖啡。'
  assert.equal((await client.post(path, { ...request, body: { ...request.body, regenerate: true, learnerCue } })).data.status, 'pending')
  const preserved = await waitForCard(client, path, owner.token)
  assert.equal(inputs.at(-1).learnerCue, learnerCue)
  assert.equal(inputs.at(-1).previousClue, card.explanation)
  assert.equal(preserved.imagePath, card.imagePath)
  assert.equal(preserved.explanation, card.explanation)
  assert.equal(preserved.selected.generationError, 'scene')
  config.wordImages.apiKey = ''
  assert.equal((await client.post(path, request)).data.status, 'ready')
  assert.equal((await client.get(path, { token: owner.token })).data.imagePath, card.imagePath)
  assert.equal(prompts.length, 1)
})

test('内置练习图可按自己的理解更换，结果只对当前账号生效', async t => {
  const server = await getTestServer()
  const client = createClient(server.baseUrl)
  const owner = await createOnboardedUser(client)
  const other = await createOnboardedUser(client)
  const path = '/api/v1/words/memory-images/examples/example-0'
  const learnerCue = '画光穿过窗户照在地板上，亮斑边缘清楚一些。'
  const original = { ...config.wordImages }
  t.after(() => Object.assign(config.wordImages, original))
  Object.assign(config.wordImages, { baseUrl: 'https://images.example.test/v1', apiKey: 'test-image-key', dailyQuota: 2, siliconFlow: false })
  useTextProvider(t)

  const realFetch = globalThis.fetch
  const inputs = []
  let imageFails = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === TEXT_ENDPOINT) {
      inputs.push(JSON.parse(JSON.parse(options.body).messages[1].content))
      return sceneResponse(options)
    }
    if (url === 'https://images.example.test/v1/images/generations') {
      return imageFails ? new Response(null, { status: 502 }) : Response.json({ data: [{ b64_json: IMAGE.toString('base64') }] })
    }
    return realFetch(url, options)
  })
  const post = body => client.post(path, { token: owner.token, body })
  async function waitForReplacement() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { data } = await client.get(path, { token: owner.token })
      if (data.status !== 'pending') return data
      await delay(20)
    }
    assert.fail('Replacement stayed pending')
  }

  assert.equal((await client.post(path, { body: {} })).status, 401)
  assert.equal((await post({ learnerCue: '长'.repeat(301) })).status, 400)
  assert.equal((await client.post(path.replace('example-0', 'example-99999'), { token: owner.token, body: {} })).status, 404)
  assert.equal((await post({ learnerCue: '  ' + learnerCue + '  ' })).data.status, 'pending')
  const replacement = await waitForReplacement()
  assert.equal(replacement.status, 'ready')
  assert.equal(inputs[0].targetWord, 'light')
  assert.equal(inputs[0].targetMeaning, '光线')
  assert.equal(inputs[0].learnerCue, learnerCue)
  const library = '/api/v1/words/memory-images'
  assert.deepEqual((await client.get(library, { token: owner.token })).data.replacements, [replacement])
  assert.deepEqual((await client.get(library, { token: other.token })).data.replacements, [])
  const imageUrl = server.baseUrl + '/api/v1' + replacement.imagePath
  assert.equal((await fetch(imageUrl, { headers: { Authorization: `Bearer ${other.token}` } })).status, 404)
  const tile = await fetch(imageUrl, { headers: { Authorization: `Bearer ${owner.token}` } })
  assert.equal((await sharp(Buffer.from(await tile.arrayBuffer())).metadata()).width, 256)

  imageFails = true
  assert.equal((await post({})).data.status, 'pending')
  const preserved = await waitForReplacement()
  assert.equal(preserved.generationError, 'image')
  assert.equal(preserved.imagePath, replacement.imagePath)
  assert.equal((await post({})).status, 429)
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
      if (downloads.length === 1) return new Response(null, { status: 502 })
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
  const response = await fetch(server.baseUrl + '/api/v1' + card.imagePath, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format, 'webp')
  assert.equal(downloads.length, 2)
  assert.equal(downloads[0].headers, undefined)
  assert.equal(downloads[0].redirect, 'error')

  const { model, prompt, image_size, negative_prompt, batch_size } = JSON.parse(generations[0].body)
  assert.equal(model, 'Kwai-Kolors/Kolors')
  assert.equal(image_size, '1024x1024')
  assert.ok(prompt.includes(SCENE))
  assert.ok(prompt.includes('Morandi') && prompt.includes('#E9E1D7'))
  assert.match(negative_prompt, /photorealism/)
  assert.equal(batch_size, undefined)
  assert.equal(generations[0].headers.Authorization, 'Bearer test-image-key')
})
