// Practice days follow the same UTC+8 calendar used by the learning service.
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
const statuses = new Set(['active', 'analyzing', 'finished', 'report_failed'])

export function practiceDay(value = new Date()) {
  if (value == null || value === '') return null
  // Legacy MySQL timestamps without an offset are UTC, just like API dates.
  const input = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value
  const date = new Date(input)
  if (!Number.isFinite(date.getTime())) return null
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function parsePracticeMemory(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (value && typeof value === 'object' && /^\d+$/.test(String(value.id))) {
      return { id: String(value.id), day: typeof value.day === 'string' ? value.day : null }
    }
    // Older versions stored only an ID. Its date must be checked against the session.
    if (/^\d+$/.test(String(value))) return { id: String(value), day: null }
  } catch { /* Damaged storage should leave the scene picker usable. */ }
  return null
}

export function selectPracticeResume(sessions, memory, now = new Date()) {
  const today = practiceDay(now)
  if (!today) return null
  const available = sessions.filter(item => statuses.has(item.status))
  const remembered = parsePracticeMemory(memory)
  // A deliberate visit to an old conversation today may be resumed today only.
  if (remembered?.day === today) {
    const selected = available.find(item => String(item.id) === remembered.id)
    if (selected) return selected
  }
  // A background report finished after midnight must not revive yesterday's chat.
  const todaysSessions = available.filter(item => practiceDay(item.createdAt || item.updatedAt) === today)
  if (remembered && !remembered.day) {
    const selected = todaysSessions.find(item => String(item.id) === remembered.id)
    if (selected) return selected
  }
  return todaysSessions.sort((a, b) => {
    const time = item => new Date(item.updatedAt || item.createdAt).getTime() || 0
    return time(b) - time(a) || Number(b.id) - Number(a.id)
  })[0] || null
}
