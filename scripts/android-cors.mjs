import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import path from 'node:path'

const androidOrigin = 'https://localhost'
const defaultOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']

/** Update only CORS_ORIGIN; never print or reconstruct the other .env values. */
export function mergeAndroidCors(source) {
  const configured = parseEnv(source).CORS_ORIGIN
  const origins = configured?.trim()
    ? configured.split(',').map(value => value.trim()).filter(Boolean)
    : defaultOrigins
  if (origins.includes('*')) return source
  const value = [...new Set([...origins, androidOrigin])].join(',')
  const line = `CORS_ORIGIN=${value}`
  const pattern = /^[\t ]*(?:export[\t ]+)?CORS_ORIGIN[\t ]*=[^\r\n]*/gm
  if (pattern.test(source)) return source.replace(pattern, line)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return `${source}${source.endsWith('\n') || !source ? '' : newline}${line}${newline}`
}

async function main() {
  const filename = path.resolve(fileURLToPath(new URL('../server/.env', import.meta.url)))
  let source
  try {
    source = await readFile(filename, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.log('server/.env is missing. Follow README.md to configure the backend, then run android:setup again.')
    return
  }
  const next = mergeAndroidCors(source)
  if (next !== source) {
    await writeFile(filename, next, 'utf8')
    console.log('Added the Android local origin to backend CORS. Restart an already-running backend to apply it.')
  } else {
    console.log('Backend CORS already allows the Android local origin.')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Could not update backend CORS: ${error.code || error.name}`)
    process.exitCode = 1
  })
}
