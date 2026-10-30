import { computed, reactive, ref } from 'vue'
import moonlakeUrl from '../assets/backgrounds/moonlake.jpg'
import mistUrl from '../assets/backgrounds/mist.jpg'
import coastUrl from '../assets/backgrounds/coast.jpg'

const SETTINGS_KEY = 'beileme.appearance.v1'
const FALLBACK_IMAGE_KEY = 'beileme.appearance.image.v1'
const DATABASE_NAME = 'beileme-appearance'
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const MAX_SAVED_BYTES = 1600 * 1024
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export const accentPresets = [
  { id: 'moonlight', name: '冷月银蓝', color: '#9AAEFF' },
  { id: 'midnight', name: '午夜蓝', color: '#709DDB' },
  { id: 'violet', name: '雾紫', color: '#B09ADA' },
  { id: 'aurora', name: '极光青', color: '#79C4BE' },
  { id: 'forest', name: '森林绿', color: '#91B79B' },
  { id: 'rosewood', name: '蔷薇红', color: '#D99AA9' },
  { id: 'amber', name: '琥珀金', color: '#D7B67C' },
]

export const backgrounds = [
  { id: 'moonlake', name: '月下静湖', description: '月光 · 远山 · 静水', url: moonlakeUrl, dim: 48 },
  { id: 'mist', name: '雾隐山林', description: '薄雾 · 松林 · 山谷', url: mistUrl, dim: 44 },
  { id: 'coast', name: '暮色海岸', description: '蓝调 · 岩岸 · 海风', url: coastUrl, dim: 48 },
]

export const defaultAppearance = Object.freeze({
  material: 'glass', accent: '#9AAEFF', background: 'moonlake',
  position: 'center', dim: 48, blur: 0, glassTransparency: 24, density: 'comfortable',
})
export const appearance = reactive({ ...defaultAppearance })
export const uploadedBackgroundUrl = ref('')
export const storageStatus = ref('')
export const backgroundUrl = computed(() => appearance.background === 'uploaded'
  ? uploadedBackgroundUrl.value
  : backgrounds.find(item => item.id === appearance.background)?.url || '')

// Legacy consumers share the new dark palette.
export const theme = ref('frost')
export const themes = [{ id: 'frost', name: '月下', description: '沉浸式暗色界面' }]
let initialized = false
let databasePromise
let imageRevision = 0
let uploadGeneration = 0
let hasUploadedImage = false
let imageStorage = ''

function normalizeColor(value) {
  if (typeof value !== 'string') return null
  const color = value.trim()
  if (/^#[\da-f]{6}$/i.test(color)) return color.toUpperCase()
  if (/^#[\da-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map(c => c + c).join('')}`.toUpperCase()
  return null
}

function normalizeSettings(value = {}) {
  const finiteRange = (input, min, max, fallback) => Number.isFinite(Number(input))
    ? Math.round(Math.min(max, Math.max(min, Number(input)))) : fallback
  return {
    material: ['glass', 'solid'].includes(value.material) ? value.material : defaultAppearance.material,
    accent: normalizeColor(value.accent) || defaultAppearance.accent,
    background: [...backgrounds.map(item => item.id), 'none', 'uploaded'].includes(value.background)
      ? value.background : defaultAppearance.background,
    position: ['center', 'top', 'bottom', 'left', 'right'].includes(value.position)
      ? value.position : defaultAppearance.position,
    dim: finiteRange(value.dim, 0, 85, defaultAppearance.dim),
    blur: finiteRange(value.blur, 0, 24, defaultAppearance.blur),
    glassTransparency: value.glassTransparency == null || value.glassTransparency === ''
      ? defaultAppearance.glassTransparency
      : finiteRange(value.glassTransparency, 0, 70, defaultAppearance.glassTransparency),
    density: ['comfortable', 'compact'].includes(value.density) ? value.density : defaultAppearance.density,
  }
}

function luminance(rgb) {
  return rgb.map(value => {
    const v = value / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
}

function applyToDocument() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = 'frost'
  root.dataset.material = appearance.material
  root.dataset.density = appearance.density
  const glassAlpha = 1 - appearance.glassTransparency / 100
  root.style.setProperty('--glass-opacity', glassAlpha.toFixed(2))
  root.style.setProperty('--glass-study-opacity', ((1 + glassAlpha) / 2).toFixed(2))
  root.style.setProperty('--glass-preview-opacity', Math.max(0, glassAlpha - 0.03).toFixed(2))
  // Drawers and conversation surfaces start opaque; soften them only beyond the
  // default setting so existing saved appearances keep their current layering.
  root.style.setProperty('--glass-elevated-opacity', Math.min(1, glassAlpha + 0.24).toFixed(2))
  // Gently shade the backdrop at higher transparency without hiding the scenery;
  // the separate background dim control remains available for brighter photos.
  root.style.setProperty('--glass-backdrop-brightness', Math.max(0.8, 1 - Math.max(0, appearance.glassTransparency - 24) / 230).toFixed(3))
  const rgb = appearance.accent.match(/[\da-f]{2}/gi).map(channel => parseInt(channel, 16))
  let readableRgb = rgb
  // Preserve the chosen value in preferences, but keep controls and accent text visible on dark surfaces.
  while ((luminance(readableRgb) + 0.05) / (luminance([25, 33, 49]) + 0.05) < 4.5) {
    readableRgb = readableRgb.map(channel => Math.min(255, channel + 8))
  }
  const appliedAccent = `#${readableRgb.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  const brightness = luminance(readableRgb)
  const contrastDark = (brightness + 0.05) / (luminance([11, 16, 32]) + 0.05)
  const contrastWhite = 1.05 / (brightness + 0.05)
  root.style.setProperty('--accent', appliedAccent)
  root.style.setProperty('--accent-deep', `rgb(${readableRgb.join(' ')})`)
  root.style.setProperty('--accent-soft', `rgba(${readableRgb.join(', ')}, 0.14)`)
  root.style.setProperty('--accent-shadow', `rgba(${readableRgb.join(', ')}, 0.18)`)
  root.style.setProperty('--on-accent', contrastDark >= contrastWhite ? '#0B1020' : '#FFFFFF')
  root.style.setProperty('--color-accent', appliedAccent)
  root.style.setProperty('--color-accent-hover', `rgb(${readableRgb.join(' ')})`)
  root.style.setProperty('--color-accent-soft', `rgba(${readableRgb.join(', ')}, 0.14)`)
  root.style.backgroundColor = '#0c1320'
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...appearance, imageRevision, hasUploadedImage }))
    storageStatus.value = ''
  } catch {
    storageStatus.value = '当前浏览器无法保存设置；本次访问仍可正常使用。'
  }
}

export function setAppearance(patch) {
  Object.assign(appearance, normalizeSettings({ ...appearance, ...patch }))
  applyToDocument()
  persistSettings()
}
export function setTheme() { applyToDocument() }

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('本地图片存储不可用')); return }
      const request = indexedDB.open(DATABASE_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('本地图片存储被其他页面占用'))
    }).catch(error => { databasePromise = undefined; throw error })
  }
  return databasePromise
}

async function imageTransaction(mode, action) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('images', mode)
    const request = action(transaction.objectStore('images'))
    transaction.oncomplete = () => resolve(request?.result)
    transaction.onerror = () => reject(transaction.error || request?.error)
    transaction.onabort = () => reject(transaction.error || new Error('本地图片存储失败'))
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('无法读取图片，请重试。'))
    reader.readAsDataURL(blob)
  })
}

async function saveImage(blob) {
  try {
    await imageTransaction('readwrite', store => store.put(blob, 'background'))
    try { localStorage.removeItem(FALLBACK_IMAGE_KEY) } catch { /* Image is saved in IndexedDB. */ }
    return 'database'
  } catch {
    // A bounded fallback also supports browsers that disable IndexedDB in file:// contexts.
    const dataUrl = await blobToDataUrl(blob)
    try { localStorage.setItem(FALLBACK_IMAGE_KEY, dataUrl) } catch {
      throw new Error('浏览器的本地存储空间不足，图片未保存。请清理空间后重试。')
    }
    return 'fallback'
  }
}

async function loadImage() {
  const generation = uploadGeneration
  if (!hasUploadedImage) {
    replaceUploadedUrl('')
    imageStorage = ''
    return
  }
  let fallback = ''
  try { fallback = localStorage.getItem(FALLBACK_IMAGE_KEY) || '' } catch { /* Try IndexedDB. */ }
  let image = fallback.startsWith('data:image/jpeg;base64,') && fallback.length < MAX_SAVED_BYTES * 1.4 ? fallback : null
  if (!image) {
    try { image = await imageTransaction('readonly', store => store.get('background')) } catch { /* No stored image. */ }
  }
  if (generation !== uploadGeneration) return
  if (typeof image === 'string') {
    replaceUploadedUrl(image)
    imageStorage = 'fallback'
  }
  else if (image instanceof Blob && image.size <= MAX_SAVED_BYTES && image.type === 'image/jpeg') {
    replaceUploadedUrl(URL.createObjectURL(image))
    imageStorage = 'database'
  } else {
    replaceUploadedUrl('')
    hasUploadedImage = false
    imageStorage = ''
    if (appearance.background === 'uploaded') {
      setAppearance({ background: defaultAppearance.background })
      storageStatus.value = '之前的本地背景已不可用，已恢复月下静湖。'
    }
  }
}

function replaceUploadedUrl(url) {
  const previous = uploadedBackgroundUrl.value
  uploadedBackgroundUrl.value = url
  if (previous.startsWith('blob:')) URL.revokeObjectURL(previous)
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张图片无法打开，请换一张完整的 JPG、PNG、WebP 或 AVIF 图片。'))
    }
    image.src = url
  })
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片处理失败，请换一张图片。')), 'image/jpeg', quality)
  })
}

export async function uploadBackground(file) {
  if (!file || !imageTypes.has(file.type)) throw new Error('请选择 JPG、PNG、WebP 或 AVIF 格式的图片。')
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error('图片大小需要在 12 MB 以内，请压缩后重试。')
  const generation = ++uploadGeneration
  const image = await decodeImage(file)
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
    throw new Error('图片尺寸过大或无效，请使用不超过 4000 万像素的图片。')
  }
  const ratio = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器无法处理图片，请尝试其他浏览器。')
  context.fillStyle = '#101824'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  // All brightness analysis and compression happen locally.
  const sample = document.createElement('canvas')
  sample.width = sample.height = 24
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  sampleContext.drawImage(canvas, 0, 0, 24, 24)
  const pixels = sampleContext.getImageData(0, 0, 24, 24).data
  let lightness = 0
  for (let i = 0; i < pixels.length; i += 4) lightness += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722
  lightness /= 24 * 24 * 255
  const recommendedDim = Math.round(Math.min(75, Math.max(38, 35 + lightness * 48)))
  let blob = await canvasBlob(canvas, 0.86)
  if (blob.size > MAX_SAVED_BYTES) blob = await canvasBlob(canvas, 0.65)
  if (blob.size > MAX_SAVED_BYTES) blob = await canvasBlob(canvas, 0.45)
  if (blob.size > MAX_SAVED_BYTES) throw new Error('这张图片处理后仍然过大，请降低分辨率后重试。')
  if (generation !== uploadGeneration) return
  const savedStorage = await saveImage(blob)
  if (generation !== uploadGeneration) return
  replaceUploadedUrl(URL.createObjectURL(blob))
  imageRevision = Date.now()
  hasUploadedImage = true
  imageStorage = savedStorage
  setAppearance({ background: 'uploaded', position: 'center', dim: recommendedDim, blur: 0 })
  return { recommendedDim }
}

export async function removeUploadedBackground() {
  ++uploadGeneration
  // Keep the existing selection intact if its actual saved copy cannot be deleted.
  try {
    if (imageStorage === 'database') await imageTransaction('readwrite', store => store.delete('background'))
    if (imageStorage === 'fallback') localStorage.removeItem(FALLBACK_IMAGE_KEY)
  } catch {
    throw new Error('浏览器暂时无法删除这张背景，请稍后重试。原背景已保留。')
  }
  try { localStorage.removeItem(FALLBACK_IMAGE_KEY) } catch { /* The active saved copy is already deleted. */ }
  hasUploadedImage = false
  imageStorage = ''
  replaceUploadedUrl('')
  imageRevision = Date.now()
  setAppearance({ background: appearance.background === 'uploaded' ? defaultAppearance.background : appearance.background })
}

export async function resetAppearance() {
  ++uploadGeneration
  await removeUploadedBackground()
  setAppearance(defaultAppearance)
}

export function initializeTheme() {
  if (initialized) return
  initialized = true
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      Object.assign(appearance, normalizeSettings(raw))
      imageRevision = Number(raw.imageRevision) || 0
      hasUploadedImage = raw.hasUploadedImage === true || raw.background === 'uploaded' && raw.hasUploadedImage !== false
    }
  } catch { /* Missing or damaged saved preferences use the default appearance. */ }
  applyToDocument()
  void loadImage()
  window.addEventListener('storage', event => {
    if (event.key !== SETTINGS_KEY) return
    try {
      const saved = JSON.parse(event.newValue || 'null')
      const revision = Number(saved?.imageRevision) || 0
      hasUploadedImage = saved?.hasUploadedImage === true || saved?.background === 'uploaded' && saved?.hasUploadedImage !== false
      Object.assign(appearance, normalizeSettings(saved || defaultAppearance))
      applyToDocument()
      if (revision !== imageRevision || appearance.background === 'uploaded' && !uploadedBackgroundUrl.value) {
        imageRevision = revision
        void loadImage()
      }
    } catch { /* Ignore malformed writes from older pages. */ }
  })
}
