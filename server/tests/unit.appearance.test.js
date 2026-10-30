import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
// Load Vue before the DOM stub; these tests exercise settings, not DOM rendering.
import 'vue'

const settingsKey = 'beileme.appearance.v1'
let moduleRevision = 0

async function importTheme() {
  // Vite turns asset imports into URLs. Stub just that boundary in Node so the
  // real theme module can be tested without decoding backgrounds or rewriting it.
  const hook = registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('.jpg')) return { format: 'module', source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
      return nextLoad(url, context)
    },
  })
  try { return await import(`../../src/stores/theme.js?appearance-test=${++moduleRevision}`) }
  finally { hook.deregister() }
}

async function mountSettings(t, saved) {
  const originals = new Map(['window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const records = new Map(saved === undefined ? [] : [[settingsKey, typeof saved === 'string' ? saved : JSON.stringify(saved)]])
  const properties = new Map(), listeners = new Map()
  const root = { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } }
  const storage = {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, String(value)),
    removeItem: key => records.delete(key),
  }
  for (const [key, value] of Object.entries({ document: { documentElement: root }, window: { addEventListener: (name, listener) => listeners.set(name, listener) }, localStorage: storage })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const theme = await importTheme()
  theme.initializeTheme()
  return { theme, records, properties, listeners, root, storage }
}

test('old or damaged appearance preferences keep the existing glass appearance', async t => {
  const { theme, properties } = await mountSettings(t, { dim: 40, material: 'glass' })
  assert.equal(theme.appearance.dim, 40)
  assert.equal(theme.appearance.glassTransparency, 24)
  assert.equal(properties.get('--glass-opacity'), '0.76')
  assert.equal(properties.get('--glass-study-opacity'), '0.88')
  assert.equal(properties.get('--glass-backdrop-brightness'), '1.000')

  globalThis.localStorage.setItem(settingsKey, '{broken-json')
  const fresh = await importTheme()
  fresh.initializeTheme()
  assert.equal(fresh.appearance.glassTransparency, fresh.defaultAppearance.glassTransparency)
})

test('glass transparency applies immediately and survives reloading the settings module', async t => {
  const { theme, records, properties } = await mountSettings(t)
  const previousAlpha = Number(properties.get('--glass-opacity'))
  theme.setAppearance({ glassTransparency: 52 })
  assert.equal(theme.appearance.glassTransparency, 52)
  assert.equal(JSON.parse(records.get(settingsKey)).glassTransparency, 52)
  assert(Number(properties.get('--glass-opacity')) < previousAlpha)
  assert(Number(properties.get('--glass-opacity')) > 0)
  assert(Number(properties.get('--glass-study-opacity')) > Number(properties.get('--glass-opacity')))
  assert(Number(properties.get('--glass-backdrop-brightness')) > 0)
  assert.equal(properties.has('opacity'), false, 'text opacity must not be changed along with glass backgrounds')

  const reloaded = await importTheme()
  reloaded.initializeTheme()
  assert.equal(reloaded.appearance.glassTransparency, 52)
})

test('out of range or malformed transparency cannot make glass invisible or corrupt its styles', async t => {
  const { theme, properties } = await mountSettings(t)
  theme.setAppearance({ glassTransparency: -50 })
  assert.equal(theme.appearance.glassTransparency, 0)
  assert.equal(Number(properties.get('--glass-opacity')), 1)
  theme.setAppearance({ glassTransparency: 500 })
  assert.equal(theme.appearance.glassTransparency, 70)
  assert(Number(properties.get('--glass-opacity')) > 0)
  assert.equal(Number(properties.get('--glass-backdrop-brightness')), 0.8, 'high transparency should keep the scenery visible')
  for (const value of [null, '', 'not-a-number', Number.NaN, Number.POSITIVE_INFINITY]) {
    theme.setAppearance({ glassTransparency: value })
    assert.equal(theme.appearance.glassTransparency, theme.defaultAppearance.glassTransparency)
  }
})

test('material changes keep the saved transparency, other tabs update it, and reset restores defaults', async t => {
  const { theme, records, listeners, root } = await mountSettings(t, { glassTransparency: 45 })
  theme.setAppearance({ material: 'solid' })
  assert.equal(root.dataset.material, 'solid')
  assert.equal(theme.appearance.glassTransparency, 45)
  theme.setAppearance({ material: 'glass' })
  assert.equal(theme.appearance.glassTransparency, 45)

  listeners.get('storage')({ key: settingsKey, newValue: JSON.stringify({ glassTransparency: 60 }) })
  assert.equal(theme.appearance.glassTransparency, 60)
  await theme.resetAppearance()
  assert.equal(theme.appearance.glassTransparency, 24)
  assert.equal(JSON.parse(records.get(settingsKey)).glassTransparency, 24)
})
