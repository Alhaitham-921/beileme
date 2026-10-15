export function studyKey(event) {
  if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return null
  if (/^[1-4]$/.test(event.key)) return Number(event.key) - 1
  if (event.code === 'Space' || event.key === ' ') return 'next'
  return null
}
