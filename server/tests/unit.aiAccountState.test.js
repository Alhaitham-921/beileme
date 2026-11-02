import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import api from '../../src/api/index.js'
import { useAiStore } from '../../src/stores/ai.js'
import { useAuthStore } from '../../src/stores/auth.js'

test('old account status cannot overwrite new account after a delayed response', async () => {
  setActivePinia(createPinia())
  const original = api.ai.status
  let finish
  api.ai.status = () => new Promise(resolve => { finish = resolve })
  try {
    const ai = useAiStore()
    const pending = ai.loadStatus()
    ai.resetAccount()
    ai.status = { mode: 'none', keys: [] }
    finish({ mode: 'user', keys: [{ id: 1, isActive: true, decryptable: true }] })
    await pending
    assert.equal(ai.mode, 'none')
    assert.equal(ai.key, null)
  } finally { api.ai.status = original }
})
test('login restores saved AI settings and logout clears the page cache', async () => {
  setActivePinia(createPinia())
  const old = { login: api.auth.login, logout: api.auth.logout, status: api.ai.status }
  api.auth.login = async () => ({ user: { id: 42 }, profile: { isOnboarded: true }, tokens: { accessToken: 'test-only' } })
  api.auth.logout = async () => ({})
  api.ai.status = async () => ({ mode: 'user', keys: [{ id: 9, provider: 'custom', isActive: true, decryptable: true }] })
  try {
    const auth = useAuthStore(), ai = useAiStore()
    await auth.login({ account: 'demo', password: 'demo' })
    await Promise.resolve()
    assert.equal(ai.key.id, 9)
    await auth.logout()
    assert.equal(ai.status, null)
    assert.equal(ai.key, null)
  } finally { api.auth.login = old.login; api.auth.logout = old.logout; api.ai.status = old.status }
})


test('cancelled cards cannot overwrite a newer generation even when the old request finishes late',async()=>{
 setActivePinia(createPinia());const old=api.content.generateErrorCards,oldStatus=api.ai.status,jobs=[]
 api.content.generateErrorCards=(body,options)=>new Promise(resolve=>jobs.push({resolve,options}));api.ai.status=async()=>({mode:'none'})
 try{const ai=useAiStore(),first=ai.generateErrorCards({wordIds:[1]});ai.cancelCards();assert.equal(jobs[0].options.signal.aborted,true)
 const second=ai.generateErrorCards({wordIds:[2]});jobs[0].resolve({cards:[{spelling:'old'}]});await first;assert.equal(ai.loading.generate,true);assert.deepEqual(ai.cards,[])
 jobs[1].resolve({cards:[{spelling:'current'}]});await second;assert.equal(ai.cards[0].spelling,'current');assert.equal(ai.loading.generate,false)
 }finally{api.content.generateErrorCards=old;api.ai.status=oldStatus}
})
