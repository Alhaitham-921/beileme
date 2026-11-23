export function spellingDraftKey(userId, sessionId, questionId, phase) { return `blm:spelling:${userId}:${sessionId}:${phase}:${questionId}` }
export function readSpellingDraft(key, storage = globalThis.localStorage) {
  try {
    const draft = JSON.parse(storage.getItem(key) || 'null')
    return draft && typeof draft.input === 'string' ? { input: draft.input.slice(0, 512), errors: Math.max(0, Math.min(100000, Number(draft.errors) || 0)), durationMs: Math.max(0, Math.min(86400000, Number(draft.durationMs) || 0)) } : null
  } catch { return null }
}
export function saveSpellingDraft(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Practice works without storage. */ } }
export function createPracticeClock(now = () => performance.now()) {
  let total = 0, started = null
  return {
    reset(value = 0) { total = value; started = null },
    resume() { if (started === null) started = now() },
    pause() { if (started !== null) { total += Math.max(0, now() - started); started = null } },
    elapsed() { return Math.min(86400000, Math.round(total + (started === null ? 0 : Math.max(0, now() - started)))) },
  }
}
export function createTypingSound() {
  let context
  return {
    play(success = false) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        if (!AudioContext) return
        context ||= new AudioContext(); void context.resume()
        const oscillator = context.createOscillator(), gain = context.createGain(), time = context.currentTime
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(success ? 720 : 220, time)
        if (success) oscillator.frequency.linearRampToValueAtTime(960, time + .08)
        gain.gain.setValueAtTime(.025, time); gain.gain.exponentialRampToValueAtTime(.001, time + (success ? .15 : .035))
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(time + (success ? .16 : .04))
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      } catch { /* Sound never blocks input. */ }
    },
    close() { void context?.close().catch(() => {}) },
  }
}
