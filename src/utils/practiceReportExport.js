import { practiceDay } from './practiceResume.js'

const WIDTH = 1240, HEIGHT = 1754, MARGIN = 76, CONTENT_TOP = 152, CONTENT_BOTTOM = HEIGHT - 110
const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif'
const DEFAULT_ACCENT = '#9AAEFF'

function rgb(value, fallback) {
  const hex = String(value || '').trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (hex) {
    const full = hex.length === 3 ? Array.from(hex, c => c + c).join('') : hex
    return full.match(/../g).map(channel => parseInt(channel, 16))
  }
  const channels = String(value || '').trim().match(/^rgb\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})\s*\)$/i)?.slice(1).map(Number)
  if (channels?.every(channel => channel <= 255)) return channels
  return rgb(fallback)
}
const hexColor = channels => `#${channels.map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`
const mix = (color, base, amount) => color.map((channel, i) => base[i] * (1 - amount) + channel * amount)
function luminance(channels) {
  return channels.reduce((sum, channel, i) => {
    const value = channel / 255
    return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
  }, 0)
}
function readableOnPaper(channels, paper) {
  let color = [...channels]
  while ((luminance(paper) + 0.05) / (luminance(color) + 0.05) < 4.6) color = color.map(channel => Math.floor(channel * 0.93))
  return hexColor(color)
}

export function reportPalette({ accent, good, warn } = {}) {
  const selected = rgb(accent, DEFAULT_ACCENT), white = [255, 255, 255]
  const paper = mix(selected, white, 0.025)
  return {
    accent: hexColor(selected), heading: readableOnPaper(selected, mix(selected, white, 0.12)),
    paper: hexColor(paper), surface: hexColor(mix(selected, white, 0.10)),
    line: hexColor(mix(selected, [222, 228, 236], 0.30)),
    ink: '#182735', muted: '#647482',
    good: readableOnPaper(rgb(good, '#9BD1B5'), paper),
    warn: readableOnPaper(rgb(warn, '#DFC58E'), paper),
  }
}

export function currentReportTheme() {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return { colors: reportPalette(), font: FONT }
  const root = getComputedStyle(document.documentElement)
  return {
    colors: reportPalette({ accent: root.getPropertyValue('--accent'), good: root.getPropertyValue('--ok'), warn: root.getPropertyValue('--warn-ink') }),
    font: root.getPropertyValue('--sans').trim() || FONT,
  }
}
const usageLabels = { unused: '待使用', independent: '独立用出', assisted: '提示后用出', weak: '需要巩固' }
const correctionLabels = { grammar: '语法', tense: '时态', word_usage: '用词', word_sense: '词义用错', sense: '词义用错', sense_misuse: '词义用错', spelling: '拼写', article: '冠词', chinese_help: '中文求助' }
const difficultyLabels = { beginner: '入门', intermediate: '进阶', advanced: '挑战' }

export function reportExportName(session, extension) {
  const title = String(session.scene?.title || '情境练习').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70).trim()
  const day = practiceDay(session.createdAt || session.updatedAt) || practiceDay()
  return `背了么-${title}-练习小结-${day}-${session.id || 'report'}.${extension}`
}

// Use structured data so collapsed answers and off-screen content are included.
export function reportBlocks(session) {
  const report = session.report
  if (!report) throw new Error('小结还未生成，请生成小结后再导出。')
  const blocks = []
  const text = (value, style = 'body') => { if (value != null && String(value).trim()) blocks.push({ text: String(value), style }) }
  const heading = value => text(value, 'section')
  text('对话练习小结', 'title')
  text(session.scene?.title || '情境练习', 'subtitle')
  const date = session.createdAt || session.updatedAt
  const dateLabel = date && Number.isFinite(new Date(date).getTime())
    ? new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
  text([dateLabel, `${session.turnCount || 0} 轮`, difficultyLabels[session.difficulty], session.mode === 'free' ? '自由交流' : '任务练习'].filter(Boolean).join('  ·  '), 'meta')
  if (session.scene?.task) { heading('场景任务'); text(session.scene.task) }
  heading('本轮表现'); text(report.summary || '本轮练习已完成。')
  heading('目标词使用情况')
  const targets = report.targetUsage || session.targetUsage || []
  if (!targets.length) text('本轮没有记录目标词表现。', 'muted')
  for (const target of targets) {
    text(`${target.word}  ·  ${target.sense || ''}`, 'word')
    text(`${usageLabels[target.status] || '待使用'}${target.helpLevel ? `  ·  帮助 ${target.helpLevel} 级` : ''}`, target.status === 'weak' ? 'warning' : target.status === 'independent' ? 'success' : 'muted')
    if (target.phrase) text(`常用搭配：${target.phrase}`, 'muted')
    if (target.example) text(`例句：${target.example}`, 'example')
  }
  heading('值得改进的表达')
  if (!report.corrections?.length) text('这一轮没有需要展开的纠错，继续保持。', 'muted')
  for (const [index, correction] of (report.corrections || []).entries()) {
    text(`${index + 1}. ${correctionLabels[correction.type] || '表达建议'}`, 'word')
    text(`原句：${correction.originalSentence || correction.original}`, 'muted')
    text(`改后：${correction.correctedSentence || correction.replacement}`, 'answer')
    text(`原因：${correction.explanation}`)
  }
  heading('薄弱词与复习')
  text(report.reviewWords?.length ? `已加入复习：${report.reviewWords.map(word => word.spelling).join('、')}` : '这一轮没有新增需要回流的词。')
  if (report.weakWords?.length) text(`建议巩固：${report.weakWords.join('、')}`, 'warning')
  if (report.unmatchedWords?.length) text(`词库暂未收录：${report.unmatchedWords.join('、')}。可以在场景词汇和下方短句中复习。`, 'muted')
  if (report.grammarWeaknesses?.length) {
    heading('留意这些表达习惯')
    for (const item of report.grammarWeaknesses) text(`• ${typeof item === 'string' ? item : item.description || item.label || item.type}`)
  }
  if (report.reinforcement?.length) {
    heading('再说一句，巩固薄弱点')
    text('先独立表达，再对照参考答案。表达可以有多种说法。', 'muted')
    for (const [index, item] of report.reinforcement.entries()) {
      text(`${index + 1}. ${item.word}`, 'word')
      text(item.prompt)
      text(`参考表达：${item.answer}`, 'answer')
      text(item.explanation, 'muted')
    }
  }
  return blocks
}

const reportStyles = colors => ({
  title: { size: 48, line: 70, before: 5, after: 12, weight: 700 },
  subtitle: { size: 32, line: 48, after: 12, weight: 600, color: colors.heading },
  meta: { size: 21, line: 34, after: 22, color: colors.muted },
  section: { size: 29, line: 46, before: 30, after: 14, weight: 700, color: colors.heading, inset: 18 },
  body: { size: 25, line: 42, after: 12 },
  word: { size: 26, line: 42, before: 14, after: 6, weight: 700 },
  muted: { size: 23, line: 38, after: 10, color: colors.muted },
  warning: { size: 23, line: 38, after: 10, color: colors.warn },
  answer: { size: 25, line: 42, after: 12, color: colors.heading, inset: 14 },
  success: { size: 23, line: 38, after: 10, color: colors.good },
  example: { size: 23, line: 38, after: 12 },
})

function makeCanvas(width = WIDTH, height = HEIGHT) {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法生成导出文件，请换用支持 Canvas 的浏览器。')
  return { canvas, ctx }
}

// Keep Latin words intact when possible; split long tokens and Chinese safely.
export function wrapReportText(ctx, value, width) {
  const result = []
  for (const paragraph of String(value).replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    const pieces = paragraph.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|\s+|[^A-Za-z0-9\s]/gu) || []
    for (const piece of pieces) {
      if (ctx.measureText(line + piece).width <= width) { line += piece; continue }
      // Keep closing punctuation with its preceding character instead of alone
      // at the left margin of a new line.
      if (/^[，。！？；：、）】》」』”’.,!?;:)]$/.test(piece) && Array.from(line).length > 1) {
        const characters = Array.from(line), last = characters.pop()
        result.push(characters.join('').trimEnd()); line = last + piece; continue
      }
      if (line.trim()) result.push(line.trimEnd())
      line = ''
      for (const character of Array.from(piece.trimStart())) {
        if (line && ctx.measureText(line + character).width > width) { result.push(line); line = '' }
        line += character
      }
    }
    result.push(line.trimEnd())
  }
  return result
}

export async function renderReportPages(session, theme = currentReportTheme()) {
  // Snapshot the live appearance so every page shares the colors at export time.
  const { colors, font } = theme, styles = reportStyles(colors)
  if (document.fonts?.ready) await document.fonts.ready
  const blocks = reportBlocks(session), pages = []
  let page, y
  const nextPage = () => {
    page = makeCanvas(); pages.push(page.canvas); y = CONTENT_TOP
    const ctx = page.ctx
    ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = colors.accent; ctx.fillRect(0, 0, WIDTH, 16)
    ctx.fillStyle = colors.surface; ctx.fillRect(0, 16, WIDTH, 96)
    ctx.fillStyle = colors.heading
    ctx.font = `600 25px ${font}`; ctx.fillText('背了么 · 情境练习', MARGIN, 83)
    ctx.font = `18px ${font}`; ctx.fillStyle = colors.muted; ctx.textAlign = 'right'
    ctx.fillText('让每一次表达，都有回响', WIDTH - MARGIN, 83); ctx.textAlign = 'left'
    ctx.strokeStyle = colors.line; ctx.beginPath(); ctx.moveTo(MARGIN, 112); ctx.lineTo(WIDTH - MARGIN, 112); ctx.stroke()
  }
  nextPage()
  for (const [index, block] of blocks.entries()) {
    const style = styles[block.style] || styles.body
    const setFont = () => { page.ctx.font = `${style.weight || 400} ${style.size}px ${font}`; page.ctx.textBaseline = 'top' }
    setFont()
    const lines = wrapReportText(page.ctx, block.text, WIDTH - MARGIN * 2 - (style.inset || 0))
    let keepWithNext = 0
    if (['section', 'word'].includes(block.style)) {
      let count = 2
      if (block.style === 'section' && blocks[index + 2]?.style === 'word') count = 4
      else if (block.style === 'section' && blocks[index + 1]?.style === 'word') count = 3
      for (const following of blocks.slice(index + 1, index + 1 + count)) {
        if (following.style === 'section') break
        const nextStyle = styles[following.style] || styles.body
        page.ctx.font = `${nextStyle.weight || 400} ${nextStyle.size}px ${font}`
        const nextLines = wrapReportText(page.ctx, following.text, WIDTH - MARGIN * 2 - (nextStyle.inset || 0))
        keepWithNext += (nextStyle.before || 0) + Math.min(nextLines.length, 2) * nextStyle.line + (nextStyle.after || 0)
      }
    }
    const keepWhole = ['section', 'word', 'title', 'subtitle'].includes(block.style)
    if (keepWhole && y + (style.before || 0) + lines.length * style.line + keepWithNext > CONTENT_BOTTOM &&
      y > CONTENT_TOP && lines.length * style.line + keepWithNext < CONTENT_BOTTOM - CONTENT_TOP) nextPage()
    y += style.before || 0
    for (const line of lines) {
      if (y + style.line > CONTENT_BOTTOM) nextPage()
      if (block.style === 'section' || block.style === 'answer') {
        page.ctx.fillStyle = colors.surface
        page.ctx.fillRect(MARGIN - 10, y - 2, WIDTH - MARGIN * 2 + 20, style.line)
        page.ctx.fillStyle = colors.accent
        page.ctx.fillRect(MARGIN - 10, y - 2, block.style === 'section' ? 6 : 4, style.line)
      }
      setFont(); page.ctx.fillStyle = style.color || colors.ink
      page.ctx.fillText(line, MARGIN + (style.inset || 0), y); y += style.line
    }
    y += style.after || 0
  }
  for (const [index, canvas] of pages.entries()) {
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = colors.line; ctx.beginPath(); ctx.moveTo(MARGIN, HEIGHT - 82); ctx.lineTo(WIDTH - MARGIN, HEIGHT - 82); ctx.stroke()
    ctx.font = `19px ${font}`; ctx.textBaseline = 'top'; ctx.fillStyle = colors.muted
    ctx.fillText('英语情境练习 · 个人学习小结', MARGIN, HEIGHT - 59)
    ctx.textAlign = 'right'; ctx.fillText(`${index + 1} / ${pages.length}`, WIDTH - MARGIN, HEIGHT - 59); ctx.textAlign = 'left'
  }
  return pages
}

const encode = text => new TextEncoder().encode(text)

// Canvas contains the Chinese glyphs. Embed one JPEG per A4 page, so exporting
// needs no external font download, server, or capture of the dark app interface.
export async function reportPdfBlob(pages) {
  const objects = [null, encode('<< /Type /Catalog /Pages 2 0 R >>')]
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')
  objects.push(encode(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`))
  for (const [index, canvas] of pages.entries()) {
    const pageId = 3 + index * 3, imageId = pageId + 1, contentId = pageId + 2
    const data = await canvasBlob(canvas, 'image/jpeg', 0.94)
    const image = new Uint8Array(await data.arrayBuffer())
    objects.push(encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Image ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`))
    objects.push([encode(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, encode('\nendstream')])
    const commands = 'q\n595.28 0 0 841.89 0 0 cm\n/Image Do\nQ\n'
    objects.push(encode(`<< /Length ${encode(commands).length} >>\nstream\n${commands}endstream`))
  }
  const chunks = [encode('%PDF-1.4\n% Generated locally by Beileme\n')], offsets = [0]
  let length = chunks[0].length
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length
    const parts = [encode(`${id} 0 obj\n`), ...([].concat(objects[id])), encode('\nendobj\n')]
    for (const part of parts) { chunks.push(part); length += part.length }
  }
  const xref = length
  chunks.push(encode(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  return new Blob(chunks, { type: 'application/pdf' })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('导出文件生成失败，请重试或选择 PDF 格式。')), type, quality))
}

export async function exportPracticeReport(session, format) {
  if (!['pdf', 'png'].includes(format)) throw new Error('不支持的导出格式。')
  const pages = await renderReportPages(session)
  let blob
  try {
    if (format === 'pdf') blob = await reportPdfBlob(pages)
    else {
      // Preserve a readable resolution within common mobile canvas limits.
      if (HEIGHT * pages.length > 16000) throw new Error('这份小结内容较长，请导出 PDF，以保留清晰度和完整内容。')
      const { canvas, ctx } = makeCanvas(WIDTH, HEIGHT * pages.length)
      for (const [index, page] of pages.entries()) ctx.drawImage(page, 0, index * HEIGHT)
      try { blob = await canvasBlob(canvas, 'image/png') }
      finally { canvas.width = 0; canvas.height = 0 }
    }
  } finally {
    // Release large bitmap buffers after encoding, especially on phones.
    for (const page of pages) { page.width = 0; page.height = 0 }
  }
  const name = reportExportName(session, format), url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name; document.body.appendChild(link)
  try { link.click() }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
  return name
}
