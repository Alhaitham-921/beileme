import sharp from 'sharp'
const GENERATION_TIMEOUT_MS=120000, MAX_IMAGE_BYTES=1024*1024, MAX_DOWNLOAD_BYTES=8*MAX_IMAGE_BYTES
const PNG_SIGNATURE=Buffer.from('89504e470d0a1a0a','hex'),JPEG_SIGNATURE=Buffer.from('ffd8ff','hex')
const isWebp=b=>b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'
const NEGATIVE_PROMPT = 'photorealism, 3D render, high saturation, neon colors, gradients, glossy surfaces, grain, heavy shadows, ' +
  'busy background, collage, extra objects, multiple panels, typography, letters, captions, logos, decorative frame'

async function downloadSiliconFlowImage(value, signal) {
  const url = typeof value === 'string' ? URL.parse(value) : null
  const trustedHost = url && (url.hostname.endsWith('.siliconflow.cn') ||
    /^(sc-maas|sf-maas-uat-prod|sf-maas-prod)\.oss-cn-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname))
  if (!trustedHost || url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new Error('Unexpected SiliconFlow image host')
  }

  // The signed download URL authorizes the request. Keep the API key on the generation endpoint.
  let response
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(url.href, { signal, redirect: 'error' })
    } catch (error) {
      if (attempt || signal.aborted) throw error
      continue
    }
    if (attempt || response.status < 500) break
    await response.body?.cancel()
  }
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel()
    throw new Error(`Invalid SiliconFlow download (${response.status})`)
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > MAX_DOWNLOAD_BYTES) throw new Error('SiliconFlow image exceeds the download limit')
    chunks.push(chunk)
  }
  const image = Buffer.concat(chunks, size)
  if (!image.subarray(0, 8).equals(PNG_SIGNATURE) && !image.subarray(0, 3).equals(JPEG_SIGNATURE) && !isWebp(image)) {
    throw new Error('Unsupported SiliconFlow image format')
  }
  return image
}

export async function generateProviderImage(scene, timings, style, settings) {
  const { baseUrl, apiKey, model, siliconFlow } = settings
  const prompt = `Depict this exact scene, keeping the described action, objects and positions: ${scene}\n${style}`
  const body = siliconFlow
    ? { model, prompt, image_size: '1024x1024', ...(model === 'Kwai-Kolors/Kolors'
      ? { negative_prompt: NEGATIVE_PROMPT, num_inference_steps: 20, guidance_scale: 7.5 } : {}) }
    : { model, prompt, n: 1, size: '1024x1024', quality: 'low', output_format: 'webp', output_compression: 75 }
  const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
  const requestedAt = performance.now()
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Image provider HTTP ${response.status}`)
  }
  const payload = await response.json()
  timings.providerMs = Math.round(performance.now() - requestedAt)
  const receivedAt = performance.now()
  let image
  if (siliconFlow) {
    image = await downloadSiliconFlowImage(payload?.images?.[0]?.url, signal)
  } else {
    const encoded = payload?.data?.[0]?.b64_json
    if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
      throw new Error('Invalid image payload')
    }
    image = Buffer.from(encoded, 'base64')
    if (image.toString('base64') !== encoded) throw new Error('Invalid base64 image')
  }
  timings.downloadMs = Math.round(performance.now() - receivedAt)
  const decodedAt = performance.now()
  const normalized = await sharp(image, { limitInputPixels: 4096 * 4096, autoOrient: true })
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  if (normalized.length > MAX_IMAGE_BYTES || !isWebp(normalized)) throw new Error('Invalid WebP image')
  timings.normalizeMs = Math.round(performance.now() - decodedAt)
  return normalized
}

