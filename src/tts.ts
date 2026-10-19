export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

export function listVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported) return []
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt'))
}

export function speak(text: string, rate: number, pitch: number, voiceURI: string): boolean {
  if (!ttsSupported || !text.trim()) return false
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI)
  if (v) { u.voice = v; u.lang = v.lang } else u.lang = 'pt-PT'
  u.rate = rate; u.pitch = pitch
  speechSynthesis.speak(u)
  return true
}
export const stopSpeaking = () => { if (ttsSupported) speechSynthesis.cancel() }
