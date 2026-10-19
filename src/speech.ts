// Camada de reconhecimento de voz isolada da interface.
// Fase 1: apenas Web Speech API (online). O áudio é processado por um serviço externo do navegador.
export type SpeechError = 'permission' | 'no-speech' | 'network' | 'unsupported' | 'other'

export interface SpeechHandlers {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (kind: SpeechError, detail: string) => void
  onStateChange: (listening: boolean) => void
}

export interface SpeechEngine {
  readonly supported: boolean
  start(lang: string): void
  stop(): void
  dispose(): void
}

const Ctor: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined

export const normalize = (s: string) => s.trim().replace(/\s+/g, ' ')

export function createWebSpeechEngine(h: SpeechHandlers): SpeechEngine {
  let rec: any = null
  let wanted = false
  let lastFinal = ''
  let restartTimer: number | undefined
  let lang = 'pt-PT'

  const build = () => {
    const r = new Ctor()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = 1
    r.onstart = () => h.onStateChange(true)
    r.onresult = (ev: any) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]
        const t = normalize(res[0].transcript)
        if (res.isFinal) {
          // Proteção contra duplicados (comum no Chrome Android).
          if (t && t !== lastFinal) { lastFinal = t; h.onFinal(t) }
          interim = ''
        } else interim += (interim ? ' ' : '') + t
      }
      h.onInterim(interim)
    }
    r.onerror = (ev: any) => {
      const e = ev.error as string
      if (e === 'not-allowed' || e === 'service-not-allowed') { wanted = false; h.onError('permission', e) }
      else if (e === 'network') { wanted = false; h.onError('network', e) }
      else if (e === 'no-speech' || e === 'aborted') { /* reinício automático em onend */ }
      else h.onError('other', e)
    }
    r.onend = () => {
      h.onInterim('')
      if (wanted) {
        // O Chrome termina sessões contínuas por conta própria; reinicia sem sessões em paralelo.
        restartTimer = window.setTimeout(() => { if (wanted) { try { rec.start() } catch { try { rec = build(); rec.start() } catch { wanted = false; h.onStateChange(false) } } } }, 60)
      } else h.onStateChange(false)
    }
    return r
  }

  return {
    supported: !!Ctor,
    start(l) {
      if (!Ctor) return h.onError('unsupported', 'Web Speech API indisponível')
      if (wanted) return
      lang = l; wanted = true; lastFinal = ''
      try { rec = build(); rec.start() } catch (e) { wanted = false; h.onError('other', String(e)) }
    },
    stop() {
      wanted = false
      window.clearTimeout(restartTimer)
      try { rec?.stop() } catch { /* ignorar */ }
      h.onStateChange(false)
    },
    dispose() { wanted = false; window.clearTimeout(restartTimer); try { rec?.abort() } catch { /* ignorar */ } rec = null },
  }
}
