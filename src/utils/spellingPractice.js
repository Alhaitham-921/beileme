import { matchesSpelling, normalizeSpelling } from '../../shared/spelling.js'

export function submittedSpellingLetters(input, target) {
  const typed = Array.from(input.trim())
  if (matchesSpelling(input, target)) return typed.map(text => ({ text, status: 'correct' }))

  const answer = Array.from(normalizeSpelling(target).trim())
  const normalized = typed.map(normalizeSpelling)
  const costs = Array.from({ length: typed.length + 1 }, () => new Uint32Array(answer.length + 1))

  // Align the two spellings so an extra or missing letter does not mark the whole suffix wrong.
  for (let i = typed.length; i >= 0; i--) {
    for (let j = answer.length; j >= 0; j--) {
      if (i === typed.length) costs[i][j] = answer.length - j
      else if (j === answer.length) costs[i][j] = typed.length - i
      else if (normalized[i] === answer[j]) costs[i][j] = costs[i + 1][j + 1]
      else costs[i][j] = 1 + Math.min(costs[i + 1][j + 1], costs[i + 1][j], costs[i][j + 1])
    }
  }

  const letters = []
  let i = 0, j = 0
  while (i < typed.length || j < answer.length) {
    const same = i < typed.length && normalized[i] === answer[j]
    if (i < typed.length && j < answer.length && (same || costs[i][j] === costs[i + 1][j + 1] + 1)) {
      letters.push({ text: typed[i++], status: same ? 'correct' : 'wrong' })
      j++
    } else if (i < typed.length && costs[i][j] === costs[i + 1][j] + 1) {
      letters.push({ text: typed[i++], status: 'wrong' })
    } else {
      letters.push({ text: '–', status: 'missing' })
      j++
    }
  }
  return letters
}

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
  let context, click, lastTone
  return {
    play(success = false, tone = 'mechanical') {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        if (!AudioContext) return
        context ||= new AudioContext()
        if (context.state === 'suspended') void context.resume().catch(() => {})
        if (!success) {
          // A sharp switch click followed by the lower thock of the key bottoming out.
          const rate = context.sampleRate
          if (!click || lastTone !== tone) {
            lastTone = tone
            const pitch = tone === 'deep' ? 135 : tone === 'soft' ? 340 : 235
            const volume = tone === 'soft' ? .015 : tone === 'deep' ? .05 : .14
            click = context.createBuffer(1, Math.ceil(rate * .055), rate)
            const samples = click.getChannelData(0)
            for (let i = 0; i < samples.length; i++) {
              const t = i / rate
              const noise = (Math.random() * 2 - 1) * Math.exp(-t * 750)
              const impact = t < .005 ? 0 : Math.sin(2 * Math.PI * pitch * (t - .005)) * Math.exp(-(t - .005) * 120)
              samples[i] = volume * noise + .085 * impact
            }
          }
          const source = context.createBufferSource()
          source.buffer = click
          source.playbackRate.value = .94 + Math.random() * .12
          source.connect(context.destination)
          source.onended = () => source.disconnect()
          source.start()
          return
        }
        const oscillator = context.createOscillator(), gain = context.createGain(), time = context.currentTime
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(success === 'error' ? 315 : 720, time)
        if (success) oscillator.frequency.linearRampToValueAtTime(success === 'error' ? 165 : 960, time + .08)
        gain.gain.setValueAtTime(.025, time); gain.gain.exponentialRampToValueAtTime(.001, time + (success ? .15 : .035))
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(time + (success ? .16 : .04))
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      } catch { /* Sound never blocks input. */ }
    },
    close() { void context?.close().catch(() => {}) },
  }
}
