const KEY = 'beileme:word-auto-pronounce'
export function readAutoPronounce(storage) {
  try { return (storage || globalThis.localStorage)?.getItem(KEY) !== 'off' } catch { return true }
}
export function saveAutoPronounce(enabled) {
  try { globalThis.localStorage?.setItem(KEY, enabled ? 'on' : 'off') } catch { /* private browsing */ }
}
/** Identity includes session + index: group changes at index zero must also pronounce. */
export function wordAudioIdentity({ active, sessionId, index, wordId }) {
  return active && sessionId && wordId ? `${sessionId}:${index}:${wordId}` : ''
}
