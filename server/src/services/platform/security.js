import crypto from 'node:crypto'
import net from 'node:net'
import dns from 'node:dns/promises'
import { Agent, fetch as undiciFetch } from 'undici'
import { ApiError } from '../../utils/errors.js'
const blockedV6 = new net.BlockList()
for(const [address,prefix] of [['2001:db8::',32],['2001::',32],['2001:2::',48],['2002::',16]])blockedV6.addSubnet(address,prefix,'ipv6')

export function publicAddress(address) {
  const ip = address.toLowerCase().split('%')[0]
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0))
  }
  if (net.isIPv6(ip)) {
    if (ip.startsWith('::ffff:')) return publicAddress(ip.slice(7))
    // Only globally routable unicast IPv6; excludes loopback, link-local and ULA.
    return /^[23][0-9a-f]{0,3}:/.test(ip) && !blockedV6.check(ip,'ipv6')
  }
  return false
}

export async function validatePublicUrl(value, lookup = dns.lookup) {
  let url
  try { url = new URL(value) } catch { throw new ApiError(400, 'AI_URL_INVALID', '服务地址不正确') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !['', '443'].includes(url.port)) throw new ApiError(400, 'AI_URL_UNSAFE', '服务地址必须是标准 HTTPS 地址，不可包含凭据或自定义端口')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const records = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true })
  if (!records.length || records.some(r => !publicAddress(r.address))) throw new ApiError(400, 'AI_URL_PRIVATE', '服务地址不能指向本机、内网或保留地址')
  return { url, records }
}

export async function safeProviderFetch(url, options = {}) {
  const target = await validatePublicUrl(String(url))
  // Pin DNS results into the transport; validation alone permits DNS rebinding.
  const dispatcher = new Agent({ connect: { lookup(_host, opts, callback) {
    const candidates = opts.family ? target.records.filter(r => r.family === opts.family) : target.records
    if (!candidates.length) return callback(new Error('No validated address for requested family'))
    if (opts.all) callback(null, candidates)
    else callback(null, candidates[0].address, candidates[0].family)
  } } })
  try {
    const response = await undiciFetch(url, { ...options, dispatcher, redirect: 'error' })
    // Consume the bounded provider response before closing its private dispatcher.
    const max = 4 * 1024 * 1024
    const chunks = []; let size = 0
    for await (const chunk of response.body || []) {
      size += chunk.length
      if (size > max) throw new ApiError(502, 'AI_RESPONSE_TOO_LARGE', '服务商响应过大')
      chunks.push(chunk)
    }
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers })
  } finally { await dispatcher.close() }
}

export function rateKey(...values) {
  return crypto.createHash('sha256').update(values.join(':')).digest('hex')
}
