import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import http from '../api/client.js'

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']

function microphoneError(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error?.name)) return '麦克风权限未开启，请在浏览器网站设置中允许麦克风，然后重试。'
  if (error?.name === 'NotFoundError') return '没有找到麦克风，请连接麦克风或继续打字。'
  if (error?.name === 'NotReadableError') return '麦克风正被其他程序占用，请关闭占用程序后重试。'
  if (error?.name === 'OverconstrainedError') return '所选麦克风不可用或已断开，请刷新设备列表并重新选择。'
  return error?.message || '无法录音，请重新尝试或继续打字。'
}

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取录音，请重新录制'))
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(blob)
  })
}

/** Records only after a user action. Transcript is editable draft text; never sends a dialogue turn. */
export function usePracticeSpeech() {
  const configured = ref(false)
  const statusLoading = ref(false)
  const statusReason = ref('正在检查语音服务配置…')
  const isStarting = ref(false)
  const isRecording = ref(false)
  const isTranscribing = ref(false)
  const error = ref('')
  const transcript = ref('')
  const elapsedSeconds = ref(0)
  const maxSeconds = ref(60)
  const maxBytes = ref(2097152)
  const remaining = ref(0)
  const isSpeaking = ref(false)
  const inputLevel = ref(0)
  const waveform = ref(Array(32).fill(0))
  const meterReady = ref(false)
  const detectedSound = ref(false)
  const microphoneName = ref('麦克风')
  const recordingUrl = ref('')
  const microphones = ref([])
  const selectedMicrophone = ref('')
  const rawAudio = ref(true)
  const deviceError = ref('')

  async function refreshMicrophones() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const devices = await navigator.mediaDevices.enumerateDevices()
      if (disposed) return
      microphones.value = devices.filter(device => device.kind === 'audioinput' && device.deviceId)
        .map((device, index) => ({ id: device.deviceId, label: device.label || `麦克风 ${index + 1}` }))
      deviceError.value = ''
    } catch { deviceError.value = '无法读取麦克风列表，请检查浏览器麦克风权限。' }
  }
  const inputStatus = computed(() => !meterReady.value ? '音量检测不可用，请录音后回放检查' :
    inputLevel.value > 0.015 ? '正在接收声音' : detectedSound.value ? '已收到声音，正在等待你继续说话' : '暂未检测到声音，请说一句话试试')
  const supported = computed(() => typeof window !== 'undefined' && window.isSecureContext !== false &&
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined')
  const available = computed(() => supported.value && configured.value && remaining.value > 0)
  let stream = null
  let recorder = null
  let deadline = null
  let ticker = null
  let generation = 0
  let disposed = false
  let startedAt = 0
  let utterance = null
  let audioContext = null
  let meterFrame = null
  let meterSource = null

  function clearPreview() {
    if (recordingUrl.value) URL.revokeObjectURL(recordingUrl.value)
    recordingUrl.value = ''
  }

  function startMeter() {
    try {
      const Context = window.AudioContext || window.webkitAudioContext
      if (!Context) return
      audioContext = new Context()
      const context = audioContext
      meterSource = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      meterSource.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      void context.resume().catch(() => {})
      const sample = () => {
        if (context !== audioContext) return
        meterReady.value = context.state === 'running'
        analyser.getFloatTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
        inputLevel.value = rms
        if (meterReady.value && rms > 0.015) detectedSound.value = true
        waveform.value = [...waveform.value.slice(1), Math.min(1, rms * 8)]
        meterFrame = requestAnimationFrame(sample)
      }
      sample()
    } catch { meterReady.value = false }
  }

  function releaseMicrophone() {
    if (meterFrame !== null) cancelAnimationFrame(meterFrame)
    meterFrame = null
    meterSource?.disconnect()
    meterSource = null
    const context = audioContext
    audioContext = null
    if (context) void context.close().catch(() => {})
    clearTimeout(deadline)
    clearInterval(ticker)
    deadline = ticker = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    isRecording.value = false
  }

  function stopSpeaking() {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    utterance = null
    isSpeaking.value = false
  }

  function cancel() {
    clearPreview()
    generation += 1
    const activeRecorder = recorder
    recorder = null
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      try { activeRecorder.stop() } catch { /* Already stopped by the browser. */ }
    }
    releaseMicrophone()
    isStarting.value = false
    isTranscribing.value = false
  }

  async function refreshStatus() {
    statusLoading.value = true
    try {
      const status = await http.get('/speech/status', { timeoutMs: 8000 })
      if (disposed) return null
      configured.value = Boolean(status?.configured)
      maxSeconds.value = status.maxSeconds || 60
      maxBytes.value = status.maxBytes || 2097152
      remaining.value = status.remaining ?? 0
      statusReason.value = status.reason || (remaining.value > 0 ? '' : '今日语音识别次数已用完，可以继续打字。')
      return status
    } catch (cause) {
      if (!disposed) {
        configured.value = false
        statusReason.value = cause.message || '暂时无法连接语音服务，可以继续打字。'
      }
      return null
    } finally {
      if (!disposed) statusLoading.value = false
    }
  }

  function stop() {
    if (!recorder || recorder.state === 'inactive') return
    try {
      recorder.stop()
    } catch (cause) {
      error.value = microphoneError(cause)
      cancel()
      return
    }
    releaseMicrophone()
  }

  async function start() {
    if (isStarting.value || isRecording.value || isTranscribing.value || disposed) return
    error.value = ''
    transcript.value = ''
    elapsedSeconds.value = 0
    clearPreview()
    inputLevel.value = 0
    waveform.value = Array(32).fill(0)
    detectedSound.value = false
    meterReady.value = false
    if (!supported.value) {
      error.value = '当前环境无法录音。请使用 HTTPS 或 localhost，并在新版浏览器中打开。'
      return
    }
    if (!available.value) {
      error.value = statusReason.value || '语音服务尚未就绪，可以继续打字。'
      return
    }
    isStarting.value = true
    stopSpeaking()
    const token = ++generation
    try {
      const audio = { echoCancellation: !rawAudio.value, noiseSuppression: !rawAudio.value, autoGainControl: !rawAudio.value }
      if (selectedMicrophone.value) audio.deviceId = { exact: selectedMicrophone.value }
      const acquired = await navigator.mediaDevices.getUserMedia({ audio, video: false })
      // A permission prompt can outlive navigation or cancellation.
      if (token !== generation || disposed) {
        acquired.getTracks().forEach((track) => track.stop())
        return
      }
      stream = acquired
      void refreshMicrophones()
      microphoneName.value = stream.getAudioTracks?.()[0]?.label || '默认麦克风'
      startMeter()
      const mimeType = RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('此浏览器没有受支持的录音格式，请更换新版浏览器或继续打字。')
      const activeRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 })
      recorder = activeRecorder
      const chunks = []
      let bytes = 0
      activeRecorder.ondataavailable = (event) => {
        if (token !== generation || !event.data?.size) return
        bytes += event.data.size
        if (bytes > maxBytes.value) {
          error.value = '录音过大，请缩短后重新录制。'
          cancel()
          return
        }
        chunks.push(event.data)
      }
      activeRecorder.onerror = (event) => {
        if (token !== generation) return
        error.value = microphoneError(event.error)
        cancel()
      }
      activeRecorder.onstop = async () => {
        if (token !== generation || disposed) return
        recorder = null
        releaseMicrophone()
        const actualDuration = Date.now() - startedAt
        if (actualDuration < 200 || actualDuration > maxSeconds.value * 1000 + 1500 || !bytes) {
          error.value = `录音太短或超过 ${maxSeconds.value} 秒，请重新录制。`
          return
        }
        isTranscribing.value = true
        try {
          const blob = new Blob(chunks, { type: activeRecorder.mimeType || mimeType })
          recordingUrl.value = URL.createObjectURL(blob)
          const audioBase64 = await readBase64(blob)
          if (token !== generation || disposed) return
          const result = await http.post('/speech/transcribe', {
            body: { audioBase64, mimeType, durationMs: Math.min(actualDuration, maxSeconds.value * 1000) },
            timeoutMs: 45000,
          })
          if (token !== generation || disposed) return
          if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('语音服务未识别出文字，请回放录音检查。')
          transcript.value = result.text.trim()
          remaining.value = result.remaining ?? Math.max(0, remaining.value - 1)
        } catch (cause) {
          if (token === generation && !disposed) {
            error.value = cause.code === 'SPEECH_EMPTY_TRANSCRIPT'
              ? detectedSound.value
                ? '麦克风已收到声音，但语音服务没有识别出文字。请回放录音；如果人声清晰，可能是识别服务或录音格式兼容问题，可以重试或继续打字。'
                : meterReady.value
                  ? '本次未检测到明显声音。请回放录音，并检查浏览器选用的麦克风和系统输入音量。'
                  : '语音服务没有识别出文字。请回放录音检查是否有人声，再重试或继续打字。'
              : cause.code === 'TIMEOUT' ? '语音识别超时，请重新录音或继续打字。' : microphoneError(cause)
            void refreshStatus()
          }
        } finally {
          if (token === generation && !disposed) isTranscribing.value = false
        }
      }
      startedAt = Date.now()
      activeRecorder.start(250)
      isRecording.value = true
      ticker = setInterval(() => { elapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000) }, 250)
      deadline = setTimeout(stop, maxSeconds.value * 1000)
    } catch (cause) {
      if (token === generation && !disposed) {
        error.value = microphoneError(cause)
        cancel()
      }
    } finally {
      if (token === generation) isStarting.value = false
    }
  }

  function speak(text, { rate = 1 } = {}) {
    if (isRecording.value || isStarting.value) return
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      error.value = '当前浏览器不支持朗读，请更换新版浏览器。'
      return
    }
    stopSpeaking()
    const message = new SpeechSynthesisUtterance(String(text).slice(0, 5000))
    utterance = message
    message.lang = 'en-US'
    message.rate = Math.max(0.5, Math.min(1.5, Number(rate) || 1))
    const voices = window.speechSynthesis.getVoices()
    message.voice = voices.find((voice) => voice.lang === 'en-US') || voices.find((voice) => voice.lang.startsWith('en')) || null
    message.onstart = () => { if (utterance === message) isSpeaking.value = true }
    message.onend = message.onerror = () => { if (utterance === message) isSpeaking.value = false }
    window.speechSynthesis.speak(message)
  }

  function onVisibilityChange() {
    if (document.hidden && (isRecording.value || isStarting.value)) {
      cancel()
      error.value = '页面切到后台，录音已停止。返回后可以重新录音。'
    }
  }

  onMounted(() => {
    void refreshStatus()
    void refreshMicrophones()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicrophones)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })
  onBeforeUnmount(() => {
    disposed = true
    cancel()
    stopSpeaking()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMicrophones)
  })

  return { supported, available, configured, statusLoading, statusReason, isStarting, isRecording, isTranscribing,
    inputLevel, waveform, meterReady, detectedSound, microphoneName, recordingUrl, inputStatus,
    microphones, selectedMicrophone, rawAudio, deviceError, refreshMicrophones,
    error, transcript, elapsedSeconds, maxSeconds, remaining, refreshStatus, start, stop, cancel, speak, stopSpeaking, isSpeaking }
}
