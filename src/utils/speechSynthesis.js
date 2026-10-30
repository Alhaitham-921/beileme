import { Capacitor, registerPlugin } from '@capacitor/core'

const plugin = registerPlugin('BeilemeSpeech')

// Keep this adapter separate so web playback does not depend on a native engine.
export const nativeSpeech = {
  isSupported: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  speak(text, rate = 1) {
    return plugin.speak({ text: String(text).slice(0, 4000), rate: Math.max(0.5, Math.min(1.5, Number(rate) || 1)) })
  },
  stop: () => plugin.stop(),
}
