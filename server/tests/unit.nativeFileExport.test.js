import test from 'node:test'
import assert from 'node:assert/strict'
import { saveExportFile } from '../../src/utils/nativeFileExport.js'

test('native export writes unmodified binary data to private cache and shares its file URI', async () => {
  const bytes = new Uint8Array(90000).map((_, index) => index % 256)
  const blob = new Blob([bytes], { type: 'application/pdf' })
  let saved, shared
  const name = '背了么-登机小结.pdf'
  const uri = `file:///data/user/0/app/cache/reports/${name}`
  const loadPlugins = async () => ({
    Directory: { Cache: 'CACHE' },
    Filesystem: { writeFile: async options => { saved = options; return { uri } } },
    Share: { share: async options => { shared = options } },
  })
  assert.equal(await saveExportFile(blob, name, { native: true, loadPlugins }), name)
  assert.equal(saved.directory, 'CACHE')
  assert.equal(saved.path, `reports/${name}`)
  assert.equal(saved.recursive, true)
  assert.equal(saved.encoding, undefined, 'native binary writes must omit text encoding')
  assert.deepEqual(new Uint8Array(Buffer.from(saved.data, 'base64')), bytes)
  assert.deepEqual(shared.files, [uri])
  assert.equal(shared.title, name)
})

test('canceling a native share is quiet while real sharing or storage errors remain visible', async () => {
  const storageError = new Error('No space left')
  const shareError = new Error('Share provider unavailable')
  for (const [cause, phase, canceled] of [
    [new Error('Share canceled'), 'share', true],
    [new Error('Share cancelled'), 'share', true],
    [Object.assign(new Error('Canceled'), { name: 'AbortError' }), 'share', true],
    [shareError, 'share', false],
    [storageError, 'write', false],
  ]) {
    let shareCalls = 0
    const loadPlugins = async () => ({
      Directory: { Cache: 'CACHE' },
      Filesystem: { writeFile: async () => { if (phase === 'write') throw cause; return { uri: 'file:///cache/report.png' } } },
      Share: { share: async () => { shareCalls++; throw cause } },
    })
    const result = saveExportFile(new Blob(['report']), 'report.png', { native: true, loadPlugins })
    if (canceled) assert.equal(await result, null)
    else await assert.rejects(result, error => error === cause)
    assert.equal(shareCalls, phase === 'write' ? 0 : 1)
  }
})

test('browser export keeps a download link and revokes its blob URL after the download starts', async t => {
  let clicked = false, removed = false, revoked = false, cleanup
  const link = { click() { clicked = true }, remove() { removed = true } }
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: tag => { assert.equal(tag, 'a'); return link },
    body: { appendChild: element => assert.equal(element, link) },
  } })
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
  })
  const blob = new Blob(['png'], { type: 'image/png' })
  t.mock.method(URL, 'createObjectURL', value => { assert.equal(value, blob); return 'blob:report' })
  t.mock.method(URL, 'revokeObjectURL', value => { assert.equal(value, 'blob:report'); revoked = true })
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { assert.equal(delay, 60000); cleanup = callback })
  const name = await saveExportFile(blob, 'report.png', { native: false, loadPlugins: () => assert.fail('web must not load native plugins') })
  assert.equal(name, 'report.png')
  assert.equal(link.href, 'blob:report')
  assert.equal(link.download, 'report.png')
  assert.equal(clicked, true)
  assert.equal(removed, true)
  assert.equal(revoked, false)
  cleanup()
  assert.equal(revoked, true)
})
