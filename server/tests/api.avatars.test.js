import { getTestServer, createClient, createOnboardedUser, playSession } from './helpers/setup.js'
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

let client, baseUrl
before(async () => { baseUrl=(await getTestServer()).baseUrl; client=createClient(baseUrl) })
const picture = async color => (await sharp({create:{width:400,height:200,channels:3,background:color}}).png().withMetadata().toBuffer()).toString('base64')

test('avatars are normalized, shown in rankings, authenticated and removed only for their owner', async () => {
  const owner=await createOnboardedUser(client), peer=await createOnboardedUser(client)
  const uploaded=await client.put('/api/v1/profile/avatar',{token:owner.token,body:{image:await picture('#879b9e')}})
  assert.equal(uploaded.status,200)
  const url=uploaded.data.avatarUrl
  assert.match(url,/^\/profile\/avatars\/\d+\/[a-f0-9]{32}$/)
  const me=await client.get('/api/v1/auth/me',{token:owner.token})
  assert.equal(me.data.user.avatarUrl,url)
  const image=await fetch(`${baseUrl}/api/v1${url}`,{headers:{Authorization:`Bearer ${peer.token}`}})
  assert.equal(image.status,200)
  assert.equal(image.headers.get('content-type'),'image/webp')
  const metadata=await sharp(Buffer.from(await image.arrayBuffer())).metadata()
  assert.equal(metadata.width,256);assert.equal(metadata.height,256);assert.equal(metadata.exif,undefined)
  assert.equal((await client.get(`/api/v1${url}`)).status,401)
  await playSession(client,owner,{maxAnswers:1})
  const ranking=await client.get('/api/v1/stats/leaderboard',{token:owner.token})
  assert.equal(ranking.data.me.avatarUrl,url)
  // A different account's delete endpoint always addresses that account alone.
  await client.del('/api/v1/profile/avatar',{token:peer.token})
  assert.equal((await client.get(`/api/v1${url}`,{token:peer.token})).status,200)
  await client.del('/api/v1/profile/avatar',{token:owner.token})
  assert.equal((await client.get(`/api/v1${url}`,{token:peer.token})).status,404)
  assert.equal((await client.get('/api/v1/auth/me',{token:owner.token})).data.user.avatarUrl,null)
})

test('avatar uploads reject invalid images, active SVG and excessive data', async () => {
  const user=await createOnboardedUser(client)
  for (const image of ['not-an-image',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64'),'A'.repeat(700001)]) {
    assert.equal((await client.put('/api/v1/profile/avatar',{token:user.token,body:{image}})).status,400)
  }
  assert.equal((await client.put('/api/v1/profile/avatar',{body:{image:await picture('red')}})).status,401)
})

test('replacing an avatar changes its revision so other devices see the new image', async () => {
  const user=await createOnboardedUser(client)
  const first=await client.put('/api/v1/profile/avatar',{token:user.token,body:{image:await picture('blue')}})
  const next=await client.put('/api/v1/profile/avatar',{token:user.token,body:{image:await picture('green')}})
  assert.notEqual(first.data.avatarUrl,next.data.avatarUrl)
  assert.equal((await client.get(`/api/v1${first.data.avatarUrl}`,{token:user.token})).status,404)
  assert.equal((await client.get(`/api/v1${next.data.avatarUrl}`,{token:user.token})).status,200)
})
