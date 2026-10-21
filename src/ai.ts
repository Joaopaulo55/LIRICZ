// Cliente da função /api/gemini. Tudo opcional e desligado por defeito.
import type { Settings } from './settings'
import { speak, stopSpeaking } from './tts'

const post = async (body: object, key: string, ms: number) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try {
    const r = await fetch('/api/gemini', { method: 'POST', signal: c.signal, headers: { 'content-type': 'application/json', ...(key ? { 'x-user-key': key } : {}) }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || `erro ${r.status}`)
    return d
  } finally { clearTimeout(t) }
}

export async function aiFix(text: string, key: string): Promise<string | null> {
  const d = await post({ mode: 'fix', text }, key, 6000)
  const out: string = (d.text || '').trim()
  // Rejeita respostas muito diferentes (a IA não pode inventar nem resumir).
  return out && out.length < text.length * 1.6 + 6 && out.length > text.length * 0.5 ? out : null
}

let ctx: AudioContext | null = null
let src: AudioBufferSourceNode | null = null
export const stopAi = () => { try { src?.stop() } catch { /* ignorar */ } src = null }

export async function aiSpeak(text: string, voice: string, key: string): Promise<void> {
  const d = await post({ mode: 'tts', text, voice }, key, 20000)
  const bin = atob(d.audio), n = bin.length >> 1, f = new Float32Array(n)
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v & 0x8000) v -= 0x10000; f[i] = v / 32768 }
  ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)()
  await ctx.resume()
  const buf = ctx.createBuffer(1, n, d.rate || 24000); buf.copyToChannel(f, 0)
  stopAi(); src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start()
}

let coolUntil = 0 // depois de um 429 (limite da Google) não insiste durante 1 minuto

// Devolve uma mensagem de aviso, ou null se correu bem.
export async function sayText(text: string, s: Settings): Promise<string | null> {
  stopSpeaking(); stopAi()
  if (s.aiTts) {
    if (Date.now() < coolUntil) { speak(text, s.speakRate, s.speakPitch, s.voiceURI); return 'Voz com IA em pausa 1 minuto (limite da Google). Usei a voz do dispositivo.' }
    try { await aiSpeak(text, s.aiVoice, s.geminiKey); return null }
    catch (e) {
      const m = (e as Error).message
      if (m.includes('429')) coolUntil = Date.now() + 60000
      speak(text, s.speakRate, s.speakPitch, s.voiceURI)
      return `A voz com IA falhou (${m}). Usei a voz do dispositivo.`
    }
  }
  return speak(text, s.speakRate, s.speakPitch, s.voiceURI) ? null : 'Voz indisponível neste dispositivo.'
}
