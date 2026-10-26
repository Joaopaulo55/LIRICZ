import { useCallback, useEffect, useRef, useState } from 'react'
import { createWebSpeechEngine, SpeechEngine, SpeechError } from './speech'
import { stopSpeaking, ttsSupported } from './tts'
import { aiFix, sayText, stopAi } from './ai'
import { translateLgp, wakeLgp, localFallbackGlosses } from './lgp'
import { Settings, FONTS, loadSettings, saveSettings } from './settings'
import { Captions, Words } from './Captions'
import { LgpStage } from './LgpStage'
import { transcript } from './transcript'
import { Write } from './Write'
import { Customize } from './Customize'
import { Icon, P } from './icons'
import { Splash } from './Splash'

type Tab = 'conversa' | 'escrever' | 'personalizar'
const errorText: Record<SpeechError, string> = {
  permission: 'O microfone está bloqueado. Permite o acesso nas definições do navegador ou da aplicação e toca no microfone outra vez.',
  'no-speech': 'Não foi detetada voz.',
  network: 'Sem ligação ao serviço de reconhecimento. Nesta versão a transcrição precisa de Internet.',
  unsupported: 'Este navegador não tem reconhecimento de voz. No Android usa o Chrome; no Windows, o Chrome ou o Edge.',
  other: 'Ocorreu um erro no reconhecimento de voz.',
}

export default function App() {
  const [tab, setTab] = useState<Tab>('conversa')
  const [s, setS] = useState<Settings>(loadSettings)
  const [online, setOnline] = useState(navigator.onLine)
  const [consent, setConsent] = useState(() => localStorage.getItem('liricz.consent') === '1')
  const [showConsent, setShowConsent] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const [bigMsg, setBigMsg] = useState('')
  const [note, setNote] = useState('')
  const [hidden, setHidden] = useState(false)
  const [splash, setSplash] = useState(() => !sessionStorage.getItem('liricz.splash'))
  const doneSplash = useCallback(() => { sessionStorage.setItem('liricz.splash', '1'); setSplash(false) }, [])
  const engine = useRef<SpeechEngine | null>(null)
  const wake = useRef<any>(null)
  const sRef = useRef(s); sRef.current = s

  const update = useCallback((patch: Partial<Settings>) => setS((p) => ({ ...p, ...patch })), [])
  useEffect(() => saveSettings(s), [s])
  useEffect(() => { if (s.lgpOn) wakeLgp() }, [s.lgpOn]) // acorda o servidor (Render grátis adormece)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    const eng = createWebSpeechEngine({
      onInterim: transcript.interim,
      onFinal: (t) => {
        const id = transcript.final(t)
        const st = sRef.current
        if (st.aiFix) aiFix(t, st.geminiKey).then((r) => { if (r && r !== t) transcript.replace(id, r) }).catch(() => {})
        if (st.lgpOn) translateLgp(t)
          .then((r) => { if (r.glosses?.length) transcript.attach(id, r.glosses, { ...r.extra, fallback: !!(r.fallback || r.extra?.fallback) }) })
          .catch(() => { const g = localFallbackGlosses(t); if (g.length) transcript.attach(id, g, { fallback: true }) }) // backend em baixo: palavra a palavra
      },
      onError: (k, d) => setError(k === 'other' ? d || errorText.other : errorText[k]),
      onStateChange: setListening,
    }, () => sRef.current.dedupe)
    engine.current = eng
    return () => eng.dispose()
  }, [])

  useEffect(() => {
    const nav: any = navigator
    if (listening && s.keepAwake && nav.wakeLock) nav.wakeLock.request('screen').then((w: any) => { wake.current = w }).catch(() => {})
    return () => { wake.current?.release?.().catch?.(() => {}); wake.current = null }
  }, [listening, s.keepAwake])

  const start = () => {
    setError('')
    if (!engine.current?.supported) return setError(errorText.unsupported)
    if (!online) return setError(errorText.network)
    if (s.lgpOn) wakeLgp()
    engine.current.start(s.lang)
  }
  const toggleMic = () => { if (listening) engine.current?.stop(); else if (!consent) setShowConsent(true); else start() }
  const accept = () => { localStorage.setItem('liricz.consent', '1'); setConsent(true); setShowConsent(false); start() }

  useEffect(() => { if (tab !== 'conversa') engine.current?.stop() }, [tab])
  useEffect(() => {
    const vis = () => { if (document.hidden) engine.current?.stop() }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || tab !== 'conversa') return
      if (e.code === 'Space') { e.preventDefault(); toggleMic() }
      if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); transcript.clear() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}) }
  const closeBig = () => { setBigMsg(''); setNote(''); stopSpeaking(); stopAi() }
  const toggleTab = (t: Tab) => setTab(tab === t ? 'conversa' : t)

  const style = {
    '--fs': `${s.fontSize}px`, '--ff': FONTS[s.fontFamily] ?? FONTS.Moderna, '--fw': s.fontWeight, '--tc': s.textColor, '--bg': s.bgColor,
    '--ic': s.interimColor, '--lh': s.lineHeight, '--ls': `${s.letterSpacing}px`, '--al': s.align, '--as': s.animSpeed,
  } as React.CSSProperties

  return (
    <div className={`app a-${s.anim}`} style={style}>
      {splash && <Splash onDone={doneSplash} />}
      {!hidden && (
        <header className="top">
          <span className="logo">LIRICz</span>
          <span className={`pill ${online ? 'ok' : 'warn'}`}>{online ? 'Online' : 'Sem Internet'}</span>
          {listening && <span className="pill rec"><i />A ouvir</span>}
          {s.aiFix && <span className="pill ok">IA</span>}
          {s.lgpOn && <span className="pill ok">LGP</span>}
          <span className="spacer" />
          {tab === 'conversa' && <button className="icon" onClick={() => setHidden(true)} aria-label="Ocultar controlos"><Icon d={P.hide} /></button>}
          <button className="icon" onClick={fullscreen} aria-label="Ecrã inteiro"><Icon d={P.expand} /></button>
        </header>
      )}

      <main className="main" onClick={() => hidden && setHidden(false)}>
        {/* Fica sempre montado (só escondido): o avatar não pode ser recriado ao mudar de separador. */}
        <section className="read" hidden={tab !== 'conversa'}>
          {error && <p className="err" role="alert">{error}</p>}
          <LgpStage active={s.lgpOn && tab === 'conversa'} listening={listening} withCaps={s.lgpCaptions} />
          {(!s.lgpOn || s.lgpCaptions) && <Captions s={s} listening={listening} />}
          {!hidden && <button className="clear" onClick={() => transcript.clear()} aria-label="Limpar texto"><Icon d={P.trash} size={20} /></button>}
        </section>
        {tab === 'escrever' && <Write s={s} show={setBigMsg} />}
        {tab === 'personalizar' && <Customize s={s} up={update} setS={setS} />}
      </main>

      {bigMsg && (
        <div className="big" onClick={closeBig}>
          <p><span><Words text={bigMsg} on={s.emojiOn} rules={s.emojiRules} /></span></p>
          {note && <p className="err">{note}</p>}
          <div className="bigbar">
            {(ttsSupported || s.aiTts) && <button className="btn" onClick={async (e) => { e.stopPropagation(); setNote((await sayText(bigMsg, s)) ?? '') }}><Icon d={P.speaker} /> Ler em voz alta</button>}
            <button className="btn ghost" onClick={closeBig}><Icon d={P.x} /> Fechar</button>
          </div>
        </div>
      )}

      {showConsent && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="card">
            <h2>Usar o microfone</h2>
            <p>O reconhecimento de voz é <b>online</b>: o áudio é enviado ao serviço de voz do navegador (no Chrome, normalmente Google). O LIRICz não guarda áudio nem conversas e não tem servidor próprio para voz.</p>
            <div className="row"><button className="btn ghost" onClick={() => setShowConsent(false)}>Cancelar</button><button className="btn" onClick={accept}>Aceito e continuar</button></div>
          </div>
        </div>
      )}

      {!hidden && (
        <nav className="dock">
          <button className={tab === 'escrever' ? 'on' : ''} onClick={() => toggleTab('escrever')}><Icon d={P.pen} /><span>Escrever</span></button>
          {tab === 'conversa'
            ? <button className={`mic${listening ? ' on' : ''}`} onClick={toggleMic} aria-label={listening ? 'Parar microfone' : 'Iniciar microfone'}><Icon d={listening ? P.stop : P.mic} size={34} /></button>
            : <button className="mic home" onClick={() => setTab('conversa')} aria-label="Voltar à conversa"><Icon d={P.chat} size={30} /></button>}
          <button className={tab === 'personalizar' ? 'on' : ''} onClick={() => toggleTab('personalizar')}><Icon d={P.sliders} /><span>Personalizar</span></button>
        </nav>
      )}
    </div>
  )
}
