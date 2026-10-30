/** Horizontal intent only: leave vertical reading, long presses and pinch zoom alone. */
export function studySwipeDirection({ startX, startY, endX, endY, elapsedMs, vertical = false }) {
  const values = [startX, startY, endX, endY, elapsedMs]
  if (!values.every(Number.isFinite) || vertical || elapsedMs < 0 || elapsedMs > 900) return null
  const dx = endX - startX, dy = endY - startY
  if (Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy) * 1.5) return null
  return dx < 0 ? 'next' : 'previous'
}
