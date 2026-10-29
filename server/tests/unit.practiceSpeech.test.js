import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick } from 'vue'
import { usePracticeSpeech } from '../../src/composables/usePracticeSpeech.js'
import http from '../../src/api/client.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (predicate) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await delay(5)
  }
  assert.fail('Timed out waiting for mock microphone lifecycle')
}

function mountSpeech(t, { getUserMedia, post, audioContext } = {}) {
  const originalGlobals = new Map(['window', 'document', 'navigator', 'MediaRecorder', 'FileReader', 'SpeechSynthesisUtterance', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const originalGet = http.get, originalPost = http.post
  const tracks = [], requests = [], recorders = [], spoken = []
  const listeners = new Map()
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm') }
    constructor(stream, options) { this.stream = stream; this.options = options; this.state = 'inactive'; recorders.push(this) }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(28).fill(0)])]) })
        this.onstop?.()
      })
    }
  }
  const defaultGetUserMedia = async () => {
    const track = { stopped: 0, stop() { this.stopped += 1 } }
    tracks.push(track)
    return { getTracks: () => [track] }
  }
  const globals = {
    window: { AudioContext: audioContext, isSecureContext: true, speechSynthesis: { cancel() {}, getVoices: () => [{ lang: 'en-US' }], speak(message) { spoken.push(message); message.onstart?.() } } },
    requestAnimationFrame: (fn) => setTimeout(fn, 10),
    cancelAnimationFrame: (id) => clearTimeout(id),
    document: { hidden: false, addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) } },
    navigator: { mediaDevices: { getUserMedia: getUserMedia || defaultGetUserMedia } },
    MediaRecorder: Recorder,
    FileReader: class {
      readAsDataURL(blob) { blob.arrayBuffer().then((buffer) => { this.result = `data:audio/webm;base64,${Buffer.from(buffer).toString('base64')}`; this.onload?.() }) }
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text } },
  }
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  http.get = async (path) => {
    assert.equal(path, '/speech/status')
    return { configured: true, maxSeconds: 60, maxBytes: 2097152, remaining: 100 }
  }
  http.post = async (path, options) => {
    requests.push({ path, ...options })
    return post ? post(path, options) : { text: 'I want to 在河边走一走', remaining: 99 }
  }
  const renderer = createRenderer({
    createComment: () => ({}), insert: () => {}, remove: () => {}, parentNode: () => null, nextSibling: () => null,
  })
  let speech
  const app = renderer.createApp({ setup() { speech = usePracticeSpeech(); return () => null } })
  app.mount({})
  t.after(() => {
    app.unmount()
    http.get = originalGet
    http.post = originalPost
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { speech, app, tracks, requests, recorders, spoken, listeners, defaultGetUserMedia }
}

test('microphone stops tracks and returns an editable mixed-language transcript without posting dialogue', async (t) => {
  const { speech, tracks, requests, spoken } = mountSpeech(t)
  await nextTick()
  assert.equal(speech.available.value, true)
  await speech.start()
  assert.equal(speech.isRecording.value, true)
  await delay(220)
  speech.stop()
  assert.ok(tracks[0].stopped > 0)
  await until(() => speech.transcript.value)
  assert.equal(speech.transcript.value, 'I want to 在河边走一走')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/speech/transcribe')
  assert.equal(requests[0].body.mimeType, 'audio/webm;codecs=opus')
  assert.equal(speech.isTranscribing.value, false)
  speech.speak('Beautiful day!', { rate: 0.75 })
  assert.equal(spoken[0].rate, 0.75)
  speech.stopSpeaking()
  assert.equal(speech.isSpeaking.value, false)
})

test('cancel, background and recorder error release microphone without transcribing', async (t) => {
  const { speech, tracks, requests, recorders, listeners } = mountSpeech(t)
  await nextTick()
  await speech.start()
  speech.cancel()
  await nextTick()
  assert.ok(tracks[0].stopped > 0)
  await speech.start()
  document.hidden = true
  listeners.get('visibilitychange')()
  assert.ok(tracks[1].stopped > 0)
  document.hidden = false
  await speech.start()
  recorders[2].onerror({ error: new Error('recording failed') })
  assert.ok(tracks[2].stopped > 0)
  await nextTick()
  assert.equal(requests.length, 0)
  assert.equal(speech.isRecording.value, false)
})

test('late permission grant after unmount stops newly acquired stream', async (t) => {
  let grant
  const track = { stopped: false, stop() { this.stopped = true } }
  const { speech, app } = mountSpeech(t, { getUserMedia: () => new Promise((resolve) => { grant = resolve }) })
  await nextTick()
  const starting = speech.start()
  app.unmount()
  grant({ getTracks: () => [track] })
  await starting
  assert.equal(track.stopped, true)
  assert.equal(speech.isRecording.value, false)
})

test('cancel during transcription ignores late result and permission denial remains actionable', async (t) => {
  let finish
  const { speech, requests, tracks } = mountSpeech(t, { post: () => new Promise((resolve) => { finish = resolve }) })
  await nextTick()
  await speech.start()
  await delay(220)
  speech.stop()
  await until(() => requests.length === 1)
  speech.cancel()
  finish({ text: 'late transcript' })
  await nextTick()
  assert.equal(speech.transcript.value, '')
  assert.ok(tracks[0].stopped > 0)
  navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError') }
  await speech.start()
  assert.match(speech.error.value, /麦克风权限/)
  assert.equal(speech.isStarting.value, false)
})

test('live meter follows actual samples and empty transcript preserves playback with accurate diagnosis', async (t) => {
  let amplitude = 0, closed = 0, disconnected = 0
  class AudioContext {
    state = 'running'
    createMediaStreamSource() { return { connect() {}, disconnect() { disconnected++ } } }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(samples) { samples.fill(amplitude) } } }
    async resume() {}
    async close() { closed++ }
  }
  const { speech } = mountSpeech(t, { audioContext: AudioContext, post: async () => {
    throw Object.assign(new Error('empty'), { code: 'SPEECH_EMPTY_TRANSCRIPT' })
  } })
  await nextTick()
  await speech.start()
  assert.equal(speech.detectedSound.value, false)
  assert.ok(speech.waveform.value.every(value => value === 0))
  amplitude = 0.1
  await until(() => speech.detectedSound.value)
  assert.ok(speech.waveform.value.some(value => value > 0))
  assert.match(speech.inputStatus.value, /正在接收声音/)
  amplitude = 0
  await until(() => speech.inputLevel.value === 0)
  assert.match(speech.inputStatus.value, /已收到声音/)
  await delay(220)
  speech.stop()
  await until(() => speech.error.value)
  assert.match(speech.error.value, /麦克风已收到声音/)
  assert.ok(speech.recordingUrl.value.startsWith('blob:'))
  assert.equal(closed, 1)
  assert.equal(disconnected, 1)
  speech.cancel()
  assert.equal(speech.recordingUrl.value, '')
})

test('explicit microphone selection uses exact device and raw input constraints', async (t) => {
  let constraints
  const { speech, defaultGetUserMedia } = mountSpeech(t, { getUserMedia: async (options) => {
    constraints = options
    return defaultGetUserMedia()
  } })
  navigator.mediaDevices.enumerateDevices = async () => [
    { kind: 'audioinput', deviceId: 'usb-mic', label: 'USB microphone' },
    { kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' },
  ]
  await nextTick()
  await speech.refreshMicrophones()
  assert.deepEqual(speech.microphones.value, [{ id: 'usb-mic', label: 'USB microphone' }])
  speech.selectedMicrophone.value = 'usb-mic'
  await speech.start()
  assert.deepEqual(constraints.audio, { deviceId: { exact: 'usb-mic' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false })
  speech.cancel()
  speech.rawAudio.value = false
  await speech.start()
  assert.equal(constraints.audio.noiseSuppression, true)
  speech.cancel()
})

test('disconnected selected microphone reports device recovery without fallback', async (t) => {
  const { speech } = mountSpeech(t, { getUserMedia: async () => { throw new DOMException('gone', 'OverconstrainedError') } })
  await nextTick()
  speech.selectedMicrophone.value = 'gone'
  await speech.start()
  assert.match(speech.error.value, /重新选择/)
  assert.equal(speech.isRecording.value, false)
  assert.equal(speech.isStarting.value, false)
})
