export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

export function listVoices(): SpeechSynthesisVoice[] {
  return ttsSupported ? speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt')) : []
}
// Prefere vozes neurais/naturais (Edge "Natural", Google) às vozes básicas do sistema.
export function bestVoice(): SpeechSynthesisVoice | undefined {
  const score = (v: SpeechSynthesisVoice) => (/natural|neural|online|google/i.test(v.name) ? 10 : 0) + (v.lang.toLowerCase() === 'pt-pt' ? 2 : 0)
  return listVoices().sort((a, b) => score(b) - score(a))[0]
}
export function speak(text: string, rate: number, pitch: number, voiceURI: string): boolean {
  if (!ttsSupported || !text.trim()) return false
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI) ?? bestVoice()
  if (v) { u.voice = v; u.lang = v.lang } else u.lang = 'pt-PT'
  u.rate = rate; u.pitch = pitch
  speechSynthesis.speak(u)
  return true
}
export const stopSpeaking = () => { if (ttsSupported) speechSynthesis.cancel() }
