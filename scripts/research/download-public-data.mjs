// Independent offline research only. Never loads project environment or connects to a database.
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import { createWriteStream, createReadStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { gunzipSync, gzipSync, constants as zlibConstants } from 'node:zlib'
import { Agent, setGlobalDispatcher } from 'undici'
setGlobalDispatcher(new Agent({ connect: { timeout: 60000 } }))

const root = path.resolve(process.argv.find((arg, i) => i > 1 && !arg.startsWith('--')) || 'output/public-research-20261119')
await mkdir(root, { recursive: true })
async function json(url) {
  let last
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
      return await response.json()
    } catch (e) { last = e; console.log(`Retry metadata ${attempt + 1}: ${new URL(url).hostname}`) }
  }
  throw last
}
async function hashFile(file, algorithm) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function download(url, filename, expected = {}) {
  const file = path.join(root, filename)
  if (expected.md5) {
    try { if (await hashFile(file, 'md5') === expected.md5) return { filename, cached: true, md5: expected.md5 } } catch {}
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(1200000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  let bytes = 0, last = 0
  const meter = new Transform({ transform(chunk, _, done) {
    bytes += chunk.length
    if (Date.now() - last > 20000) { console.log(`${filename}: ${(bytes / 1e6).toFixed(1)} MB`); last = Date.now() }
    done(null, chunk)
  } })
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(file + '.part'))
  const md5 = await hashFile(file + '.part', 'md5')
  if (expected.bytes && bytes !== expected.bytes) throw new Error('File size mismatch')
  if (expected.md5 && md5 !== expected.md5) throw new Error('MD5 mismatch')
  await rename(file + '.part', file)
  return { filename, bytes, md5, sha256: await hashFile(file, 'sha256'), url, retrievedAt: new Date().toISOString() }
}

const metadataUrl = 'https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/N8XJME'
const metadata = process.argv.includes('--offline')
  ? JSON.parse(await readFile(path.join(root, 'duolingo-metadata.json'), 'utf8'))
  : await json(metadataUrl)
await writeFile(path.join(root, 'duolingo-metadata.json'), JSON.stringify(metadata, null, 2))
const version = metadata.data.latestVersion
if (!version.termsOfUse.includes('by-nc/4.0')) throw new Error('Review changed dataset terms before downloading')
const data = version.files.find(file => file.dataFile.id === 3091087)
if (!data || data.restricted) throw new Error('Expected public file unavailable')
console.log('Verified dataset terms: CC BY-NC 4.0; local noncommercial research only')
const extras = [
  ['https://raw.githubusercontent.com/duolingo/halflife-regression/master/README.md', 'hlr-README.md'],
  ['https://raw.githubusercontent.com/duolingo/halflife-regression/master/experiment.py', 'hlr-experiment.py'],
  ['https://raw.githubusercontent.com/duolingo/halflife-regression/master/LICENSE.md', 'hlr-LICENSE.md'],
  ['https://aclanthology.org/P16-1174.pdf', 'settles-meeder-2016.pdf'],
  ['https://www.wgtn.ac.nz/__data/assets/file/0025/40966/The-updated-Vocabulary-Levels-Test-B.pdf', 'updated-vlt-B.pdf'],
]
const manifest = { metadataUrl, license: 'CC BY-NC 4.0', citation: 'Settles & Meeder (2016), DOI 10.18653/v1/P16-1174; dataset DOI 10.7910/DVN/N8XJME', files: [] }
async function preparePrefix() {
  const prefixPath = path.join(root, data.dataFile.filename + '.part')
  const requested = Number(process.argv.find(arg => arg.startsWith('--sample-bytes='))?.split('=')[1] || 956764)
  if (!Number.isSafeInteger(requested) || requested < 10000 || requested > 10 * 1024 * 1024) throw new Error('Sample must be 10000..10485760 compressed bytes')
  let prefix
  try { prefix = await readFile(prefixPath) } catch {}
  if (!prefix || prefix.length < requested) {
    if (process.argv.includes('--offline')) throw new Error('Requested source prefix is not cached')
    const response = await fetch('https://dataverse.harvard.edu/api/access/datafile/3091087', {
      headers: { Range: `bytes=0-${requested - 1}` }, signal: AbortSignal.timeout(1200000),
    })
    if (![200, 206].includes(response.status)) throw new Error(`Prefix HTTP ${response.status}`)
    if (response.status === 206 && !/^bytes 0-/.test(response.headers.get('content-range') || '')) throw new Error('Unexpected byte range')
    const reader = response.body.getReader(), chunks = []
    let size = 0
    try {
      while (size < requested) {
        const { done, value } = await reader.read()
        if (done) break
        const part = value.subarray(0, requested - size)
        chunks.push(part); size += part.length
      }
    } finally { await reader.cancel() }
    if (size !== requested) throw new Error('Incomplete prefix; retry without treating as complete sample')
    prefix = Buffer.concat(chunks)
    await writeFile(prefixPath, prefix)
  }
  prefix = prefix.subarray(0, requested)
  // A prefix is not a complete gzip archive. Recover complete lines explicitly and
  // label the resulting re-compressed sample; never claim the publisher MD5 matched.
  const raw = gunzipSync(prefix, { finishFlush: zlibConstants.Z_SYNC_FLUSH }).toString('utf8')
  const complete = raw.slice(0, raw.lastIndexOf('\n') + 1)
  const recovered = gzipSync(complete)
  await writeFile(path.join(root, 'duolingo-prefix-sample.csv.gz'), recovered)
  const provenance = { type: 'incomplete-download prefix, complete recovered CSV records only',
    compressedPrefixBytes: prefix.length, compressedPrefixSha256: createHash('sha256').update(prefix).digest('hex'),
    recoveredSampleSha256: createHash('sha256').update(recovered).digest('hex'),
    rows: complete.split('\n').length - 2, fullDatasetDownloaded: false, fullFileChecksumVerified: false,
    sourceUrl: 'https://dataverse.harvard.edu/api/access/datafile/3091087',
    fullFileExpectedMD5: data.dataFile.md5, bias: 'contiguous source-file prefix; not random or representative', retrievedAt: new Date().toISOString() }
  await writeFile(path.join(root, 'sample-provenance.json'), JSON.stringify(provenance, null, 2))
  manifest.sample = provenance
}
if (process.argv.includes('--offline')) {
  await preparePrefix()
  console.log(JSON.stringify(manifest.sample, null, 2))
  process.exit(0)
}
const downloads = extras.map(async ([url, filename]) => {
  try { manifest.files.push(await download(url, filename)) } catch (e) { manifest.files.push({ filename, error: e.message }) }
})
downloads.push((async () => {
  try {
    const inventory = []
    let url = 'https://api.osf.io/v2/nodes/s8gvp/files/osfstorage/?page[size]=100'
    while (url) { const page = await json(url); inventory.push(...page.data); url = page.links.next }
    const node = await json('https://api.osf.io/v2/nodes/s8gvp/')
    const license = await json(node.data.relationships.license.links.related.href)
    await writeFile(path.join(root, 'image-study-osf-inventory.json'), JSON.stringify({ node, license, files: inventory }, null, 2))
    console.log('OSF inventory:', inventory.map(f => `${f.attributes.kind}: ${f.attributes.name}`).join('; '))
    // Save analysis source if public, without redistributing third-party images.
    await Promise.all(inventory.filter(f => /\.Rmd$|^Experiment [1-4] Data\.xlsx$|^Data Headings Explanation.xlsx$/i.test(f.attributes.name)).map(async f => {
      const filename = 'osf-' + f.attributes.name.replace(/[^a-zA-Z0-9.]/g, '-')
      manifest.files.push(await download(f.links.download, filename, { md5: f.attributes.extra.hashes.md5, bytes: f.attributes.size }))
    }))
  } catch (e) { manifest.osfError = e.message }
})())
if (process.argv.includes('--full')) downloads.push((async () => manifest.files.push(await download(
  'https://dataverse.harvard.edu/api/access/datafile/3091087', data.dataFile.filename,
  { md5: data.dataFile.md5, bytes: data.dataFile.filesize })))())
else downloads.push(preparePrefix())
await Promise.all(downloads)
await writeFile(path.join(root, 'download-manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify(manifest, null, 2))
