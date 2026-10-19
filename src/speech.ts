// Motor de voz (Web Speech API, online) com sessão nova a cada reinício, recuo progressivo e cão-de-guarda.
export type SpeechError = 'permission' | 'no-speech' | 'network' | 'unsupported' | 'other'
export interface SpeechHandlers {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (kind: SpeechError, detail: string) => void
  onStateChange: (listening: boolean) => void
}
export interface SpeechEngine { readonly supported: boolean; start(lang: string): void; stop(): void; dispose(): void }

const Ctor: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined
export const normalize = (s: string) => s.trim().replace(/\s+/g, ' ')

export function createWebSpeechEngine(h: SpeechHandlers): SpeechEngine {
  let rec: any = null, wanted = false, active = false, lang = 'pt-PT'
  let lastFinal = '', lastFinalAt = 0, lastEvent = 0, startedAt = 0, fails = 0
  let timer: number | undefined, dog: number | undefined

  const kill = () => {
    if (rec) { rec.onstart = rec.onresult = rec.onerror = rec.onend = null; try { rec.abort() } catch { /* ignorar */ } rec = null }
    active = false
  }
  const schedule = (ms: number) => { window.clearTimeout(timer); timer = window.setTimeout(begin, ms) }
  const fatal = (kind: SpeechError, d: string) => { wanted = false; window.clearInterval(dog); kill(); h.onInterim(''); h.onStateChange(false); h.onError(kind, d) }

  function begin() {
    if (!wanted) return
    kill()
    const r = new Ctor(); rec = r
    r.lang = lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1
    r.onstart = () => { active = true; lastEvent = Date.now(); h.onStateChange(true) }
    r.onresult = (ev: any) => {
      lastEvent = Date.now(); fails = 0
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i], t = normalize(res[0].transcript)
        if (res.isFinal) {
          const now = Date.now()
          if (t && !(t === lastFinal && now - lastFinalAt < 2500)) { lastFinal = t; lastFinalAt = now; h.onFinal(t) }
        } else interim += (interim ? ' ' : '') + t
      }
      h.onInterim(interim)
    }
    r.onerror = (ev: any) => {
      const e = ev.error as string
      if (e === 'not-allowed' || e === 'service-not-allowed') fatal('permission', e)
      else if (e === 'audio-capture') fatal('other', 'Nenhum microfone disponível ou está a ser usado por outra aplicação.')
      else if (e === 'network') { fails++; if (!navigator.onLine || fails > 4) fatal('network', e) }
    }
    r.onend = () => {
      if (r !== rec) return
      active = false; h.onInterim('')
      if (!wanted) { h.onStateChange(false); return }
      fails = Date.now() - startedAt < 1000 ? fails + 1 : fails
      if (fails > 8) return fatal('other', 'A sessão de voz ficou instável. Toca no microfone para tentar de novo.')
      schedule(Math.min(2000, 40 * 2 ** fails))
    }
    startedAt = lastEvent = Date.now()
    try { r.start() } catch { schedule(300) }
  }

  return {
    supported: !!Ctor,
    start(l) {
      if (!Ctor) return h.onError('unsupported', 'Web Speech API indisponível')
      if (wanted) return
      lang = l; wanted = true; fails = 0; lastFinal = ''
      begin()
      // Cão-de-guarda: se a sessão ficou presa (sem início ou sem eventos), recria-a.
      window.clearInterval(dog)
      dog = window.setInterval(() => {
        if (!wanted) return
        const idle = Date.now() - lastEvent
        if ((!active && idle > 5000) || (active && idle > 60000)) begin()
      }, 2500)
    },
    stop() { wanted = false; window.clearTimeout(timer); window.clearInterval(dog); kill(); h.onInterim(''); h.onStateChange(false) },
    dispose() { wanted = false; window.clearTimeout(timer); window.clearInterval(dog); kill() },
  }
}
