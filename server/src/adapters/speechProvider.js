import { ApiError } from '../utils/errors.js'
export async function transcribeAudio(url,settings,audio,signal,fetchImpl=fetch) {
      const form = new FormData()
      form.append('file', new Blob([audio.bytes], { type: audio.mimeType }), `practice.${audio.extension}`)
      form.append('model', settings.model)
      // Do not force English: Chinese/English mixed speech must remain visible to the tutor.
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        body: form,
        signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        if (response.status === 429) throw new ApiError(503, 'SPEECH_PROVIDER_BUSY', '语音服务额度不足或正忙，请稍后重试，或继续打字')
        if ([400, 415, 422].includes(response.status)) throw new ApiError(502, 'SPEECH_PROVIDER_FORMAT', '语音服务无法读取此录音格式，请重新录音或继续打字')
        throw new ApiError(502, 'SPEECH_PROVIDER_ERROR', '语音识别服务暂时不可用，请稍后再试')
      }
      const result = await response.json().catch(() => null)
      if (typeof result?.text !== 'string' || result.text.length > 10000) {
        throw new ApiError(502, 'SPEECH_INVALID_RESPONSE', '语音识别结果不完整，请重新录音')
      }
      const text = result.text.trim()
      if (!text) throw new ApiError(422, 'SPEECH_EMPTY_TRANSCRIPT', '语音服务未识别出文字，请回放录音检查是否有人声；若人声清晰，请重试或检查语音服务兼容性')

return text
}
