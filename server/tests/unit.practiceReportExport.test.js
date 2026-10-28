import test from 'node:test'
import assert from 'node:assert/strict'
import { reportBlocks, reportExportName, wrapReportText, reportPdfBlob, exportPracticeReport, reportPalette, currentReportTheme } from '../../src/utils/practiceReportExport.js'

const luminance = hex => hex.slice(1).match(/../g).map(channel => {
  const value = parseInt(channel, 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (text, background) => (luminance(background) + 0.05) / (luminance(text) + 0.05)

test('report decoration preserves user theme colors while text stays readable on tinted paper', () => {
  const presets = ['#9AAEFF', '#709DDB', '#B09ADA', '#79C4BE', '#91B79B', '#D99AA9', '#D7B67C', '#FFFFFF', '#000000', '#FFFF00']
  for (const accent of presets) {
    const palette = reportPalette({ accent })
    assert.equal(palette.accent, accent)
    assert.ok(contrast(palette.heading, palette.surface) >= 4.5, accent)
    assert.ok(contrast(palette.heading, palette.paper) >= 4.5, accent)
    assert.ok(contrast(palette.good, palette.paper) >= 4.5, accent)
    assert.ok(contrast(palette.warn, palette.paper) >= 4.5, accent)
    assert.ok(luminance(palette.paper) > 0.9)
  }
  assert.notEqual(reportPalette({ accent: '#9AAEFF' }).surface, reportPalette({ accent: '#D99AA9' }).surface)
})

test('report palette reads common CSS color values and safely falls back to the app default', () => {
  assert.equal(reportPalette({ accent: 'rgb(217 154 169)' }).accent, '#D99AA9')
  assert.equal(reportPalette({ accent: 'rgb(121, 196, 190)' }).accent, '#79C4BE')
  assert.equal(reportPalette({ accent: '#abc' }).accent, '#AABBCC')
  assert.equal(reportPalette({ accent: 'invalid' }).accent, '#9AAEFF')
  assert.equal(reportPalette({ accent: 'rgb(300 0 0)' }).accent, '#9AAEFF')
  assert.equal(currentReportTheme().colors.accent, '#9AAEFF')
})

const session = {
  id: 42, createdAt: '2026-10-25T17:30:00Z', turnCount: 8, difficulty: 'beginner', mode: 'free',
  scene: { title: '酒店/换房:练习?', task: '确认预订并礼貌地请求换房。' },
  targetUsage: [{ word: 'quiet', sense: '安静的', status: 'assisted', helpLevel: 3, phrase: 'a quiet room', example: 'I would like a quiet room.' }],
  report: {
    summary: '你完成了入住交流，下一步尝试独立说明房间要求。',
    corrections: [{ type: 'grammar', original: 'I has a reservation.', replacement: 'I have a reservation.', explanation: '第一人称使用 have。' }],
    reviewWords: [{ id: 10, spelling: 'quiet' }], weakWords: ['quiet'], unmatchedWords: ['reservation'],
    grammarWeaknesses: ['时态'], reinforcement: [{ word: 'quiet', prompt: '表达想换一个安静的房间。', answer: 'Could I change to a quiet room?', explanation: '用 Could I 礼貌提出请求。' }],
  },
}

test('report export includes Chinese corrections, vocabulary, and every hidden reference answer', () => {
  const content = reportBlocks(session).map(block => block.text).join('\n')
  for (const text of [session.scene.task, session.report.summary, '原句：I has a reservation.', '改后：I have a reservation.', 'a quiet room', '提示后用出', '帮助 3 级', '已加入复习：quiet', '词库暂未收录：reservation', '参考表达：Could I change to a quiet room?', '时态']) assert.ok(content.includes(text), text)
  assert.equal(content.includes('undefined'), false)
  assert.throws(() => reportBlocks({}), /小结还未生成/)
  assert.ok(reportBlocks({ report: {} }).some(block => block.text.includes('没有需要展开的纠错')))
})

test('download names are filesystem-safe and use the Shanghai practice date', () => {
  const name = reportExportName(session, 'pdf')
  assert.equal(name, '背了么-酒店_换房_练习_-练习小结-2026-10-26-42.pdf')
  assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(name))
})

test('text wrapping keeps complete content within bounds including long Latin tokens and CJK', () => {
  const ctx = { measureText: text => ({ width: Array.from(text).length * 10 }) }
  const value = '酒店确认预订 reservation quiet\n' + 'x'.repeat(120)
  const lines = wrapReportText(ctx, value, 100)
  assert.ok(lines.every(line => ctx.measureText(line).width <= 100))
  assert.equal(lines.join('').replace(/\s/g, ''), value.replace(/\s/g, ''))
  assert.ok(wrapReportText(ctx, 'hello world', 70).includes('world'))
  const chinese = wrapReportText(ctx, '请说明你想预订房间。然后询问早餐时间。', 100)
  assert.ok(chinese.every(line => !/^[，。！？；：、）】]/.test(line)))
})

test('PDF export emits complete page trees, binary image streams and correct xref offsets', async () => {
  const jpeg = new Uint8Array([255, 216, 1, 2, 128, 255, 217])
  const canvas = { width: 1240, height: 1754, toBlob: callback => callback(new Blob([jpeg], { type: 'image/jpeg' })) }
  const blob = await reportPdfBlob([canvas, canvas])
  assert.equal(blob.type, 'application/pdf')
  const bytes = new Uint8Array(await blob.arrayBuffer()), content = new TextDecoder().decode(bytes)
  assert.ok(content.startsWith('%PDF-1.4'))
  assert.match(content, /\/Count 2/)
  assert.equal((content.match(/\/Type \/Page\b/g) || []).length, 2)
  const startXref = Number(content.match(/startxref\n(\d+)/)[1])
  assert.equal(new TextDecoder().decode(bytes.slice(startXref, startXref + 4)), 'xref')
  const entries = content.match(/xref\n0 \d+\n([\s\S]*?)trailer/)[1].trim().split('\n').slice(1)
  for (const [index, row] of entries.entries()) {
    const offset = Number(row.slice(0, 10))
    assert.ok(new TextDecoder().decode(bytes.slice(offset, offset + 15)).startsWith(`${index + 1} 0 obj`))
  }
  await assert.rejects(exportPracticeReport(session, 'html'), /不支持/)
})
