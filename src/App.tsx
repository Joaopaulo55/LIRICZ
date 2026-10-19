import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createWebSpeechEngine, SpeechEngine, SpeechError } from './speech'
import { speak, stopSpeaking, listVoices, ttsSupported } from './tts'
import {
  Settings, DEFAULTS, FONTS, PROFILES, loadSettings, saveSettings, loadCustomProfiles, saveCustomProfiles,
  loadPhrases, savePhrases, clearAll,
} from './settings'

type Tab = 'conversa' | 'escrever' | 'personalizar'

const Icon = ({ d, size = 24 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)
const P = {
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  stop: 'M6 6h12v12H6z',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  expand: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  hide: 'M17.9 17.9A10 10 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22',
  speaker: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  x: 'M18 6 6 18M6 6l12 12',
}

const errorText: Record<SpeechError, string> = {
  permission: 'O microfone está bloqueado. Permite o acesso ao microfone nas definições do navegador ou da aplicação e toca no botão outra vez.',
  'no-speech': 'Não foi detetada voz.',
  network: 'Sem ligação ao serviço de reconhecimento. O reconhecimento de voz precisa de Internet nesta versão.',
  unsupported: 'Este navegador não tem reconhecimento de voz. No Android, usa o Chrome. No Windows, usa o Chrome ou o Edge.',
  other: 'Ocorreu um erro no reconhecimento de voz.',
}

export default function App() {
  const [tab, setTab] = useState<Tab>('conversa')
  const [s, setS] = useState<Settings>(loadSettings)
  const [online, setOnline] = useState(navigator.onLine)
  const [consent, setConsent] = useState(() => localStorage.getItem('liricz.consent') === '1')
  const [showConsent, setShowConsent] = useState(false)

  const [finals, setFinals] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const [bigMsg, setBigMsg] = useState('')
  const [chromeHidden, setChromeHidden] = useState(false)

  const engineRef = useRef<SpeechEngine | null>(null)
  const wakeRef = useRef<any>(null)

  const update = useCallback((patch: Partial<Settings>) => setS((p) => ({ ...p, ...patch })), [])
  useEffect(() => saveSettings(s), [s])

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Um único motor para toda a sessão da aplicação.
  useEffect(() => {
    const eng = createWebSpeechEngine({
      onInterim: setInterim,
      onFinal: (t) => setFinals((f) => [...f, t].slice(-200)),
      onError: (k, d) => setError(`${errorText[k]}${k === 'other' ? ` (${d})` : ''}`),
      onStateChange: setListening,
    })
    engineRef.current = eng
    return () => eng.dispose()
  }, [])

  // Manter o ecrã ligado enquanto escuta.
  useEffect(() => {
    const nav: any = navigator
    if (listening && s.keepAwake && nav.wakeLock) nav.wakeLock.request('screen').then((w: any) => { wakeRef.current = w }).catch(() => {})
    return () => { wakeRef.current?.release?.().catch?.(() => {}); wakeRef.current = null }
  }, [listening, s.keepAwake])

  const startListening = () => {
    setError('')
    if (!engineRef.current?.supported) return setError(errorText.unsupported)
    if (!online) return setError(errorText.network)
    engineRef.current.start(s.lang)
  }
  const toggleMic = () => {
    if (listening) { engineRef.current?.stop(); return }
    if (!consent) return setShowConsent(true)
    startListening()
  }
  const acceptConsent = () => { localStorage.setItem('liricz.consent', '1'); setConsent(true); setShowConsent(false); startListening() }

  // Parar o microfone ao sair do separador de conversa ou quando a app vai para segundo plano.
  useEffect(() => { if (tab !== 'conversa') engineRef.current?.stop() }, [tab])
  useEffect(() => {
    const vis = () => { if (document.hidden) engineRef.current?.stop() }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [])

  // Atalhos de teclado (Windows): Espaço = iniciar/parar, Ctrl+L = limpar.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || tab !== 'conversa') return
      if (e.code === 'Space') { e.preventDefault(); toggleMic() }
      if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setFinals([]); setInterim('') }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const style = {
    '--fs': `${s.fontSize}px`, '--ff': FONTS[s.fontFamily] ?? FONTS.Moderna, '--fw': s.fontWeight,
    '--tc': s.textColor, '--bg': s.bgColor, '--ic': s.interimColor, '--lh': s.lineHeight,
    '--ls': `${s.letterSpacing}px`, '--al': s.align,
  } as React.CSSProperties

  const shown = finals.slice(-s.historyLimit)

  return (
    <div className="app" style={style}>
      {!chromeHidden && (
        <header className="top">
          <span className="logo">LIRICz</span>
          <span className={`pill ${online ? 'ok' : 'warn'}`}>{online ? 'Online' : 'Sem Internet'}</span>
          {listening && <span className="pill rec"><i />Microfone ativo</span>}
          <span className="spacer" />
          {tab === 'conversa' && <button className="icon" onClick={() => setChromeHidden(true)} aria-label="Ocultar controlos"><Icon d={P.hide} /></button>}
          <button className="icon" onClick={fullscreen} aria-label="Ecrã inteiro"><Icon d={P.expand} /></button>
        </header>
      )}

      <main className="main" onClick={() => chromeHidden && setChromeHidden(false)}>
        {tab === 'conversa' && (
          <section className="read">
            {error && <p className="err" role="alert">{error}</p>}
            <div className="captions" aria-live="polite">
              {shown.length === 0 && !interim && <p className="hint">{listening ? 'A ouvir… fala normalmente.' : 'Toca no microfone e fala. As palavras aparecem aqui.'}</p>}
              {shown.map((t, i) => (
                <p key={finals.length - shown.length + i} className="seg">{t}</p>
              ))}
              {interim && <p className="seg interim">{interim}</p>}
            </div>
            {!chromeHidden && (
              <div className="actions">
                <button className="icon" onClick={() => { setFinals([]); setInterim('') }} aria-label="Limpar texto"><Icon d={P.trash} /></button>
                <button className={`mic ${listening ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleMic() }} aria-label={listening ? 'Parar microfone' : 'Iniciar microfone'}>
                  <Icon d={listening ? P.stop : P.mic} size={36} />
                </button>
                <button className="icon" onClick={() => setTab('escrever')} aria-label="Escrever resposta"><Icon d={P.pen} /></button>
              </div>
            )}
            {!chromeHidden && <p className="notice">Reconhecimento online: o áudio é processado pelo serviço de voz do navegador (por exemplo, Google no Chrome). Pode haver erros — confirma o que é importante.</p>}
          </section>
        )}

        {tab === 'escrever' && <Write s={s} setBigMsg={setBigMsg} />}
        {tab === 'personalizar' && <Customize s={s} update={update} setS={setS} />}
      </main>

      {bigMsg && (
        <div className="big" style={style} onClick={() => { setBigMsg(''); stopSpeaking() }}>
          <p>{bigMsg}</p>
          <div className="bigbar">
            {ttsSupported && <button className="btn" onClick={(e) => { e.stopPropagation(); speak(bigMsg, s.speakRate, s.speakPitch, s.voiceURI) }}><Icon d={P.speaker} /> Ler em voz alta</button>}
            <button className="btn ghost" onClick={() => { setBigMsg(''); stopSpeaking() }}><Icon d={P.x} /> Fechar</button>
          </div>
        </div>
      )}

      {showConsent && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="card">
            <h2>Usar o microfone</h2>
            <p>Nesta versão o reconhecimento de voz é <b>online</b>. O teu áudio é enviado ao serviço de voz do navegador (no Chrome, normalmente Google) para ser transcrito. O LIRICz não guarda áudio nem conversas e não tem servidor próprio.</p>
            <p>Sem Internet, a transcrição não funciona.</p>
            <div className="row">
              <button className="btn ghost" onClick={() => setShowConsent(false)}>Cancelar</button>
              <button className="btn" onClick={acceptConsent}>Aceito e quero continuar</button>
            </div>
          </div>
        </div>
      )}

      {!chromeHidden && (
        <nav className="nav">
          {([['conversa', 'Conversa', P.chat], ['escrever', 'Escrever', P.pen], ['personalizar', 'Personalizar', P.sliders]] as const).map(([k, label, d]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} aria-current={tab === k}><Icon d={d} /><span>{label}</span></button>
          ))}
        </nav>
      )}
    </div>
  )
}

function Write({ s, setBigMsg }: { s: Settings; setBigMsg: (m: string) => void }) {
  const [text, setText] = useState('')
  const [phrases, setPhrases] = useState(loadPhrases)
  const [history, setHistory] = useState<string[]>([])
  const [newPhrase, setNewPhrase] = useState('')
  const show = (m: string) => { if (!m.trim()) return; setBigMsg(m.trim()); setHistory((h) => [m.trim(), ...h.filter((x) => x !== m.trim())].slice(0, 10)) }
  const changePhrases = (p: string[]) => { setPhrases(p); savePhrases(p) }
  return (
    <section className="write">
      <label htmlFor="msg">A tua mensagem</label>
      <textarea id="msg" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Escreve aqui…" />
      <div className="row">
        <button className="btn" onClick={() => show(text)} disabled={!text.trim()}>Mostrar em letras grandes</button>
        {ttsSupported && <button className="btn ghost" disabled={!text.trim()} onClick={() => { if (!speak(text, s.speakRate, s.speakPitch, s.voiceURI)) alert('Voz indisponível neste dispositivo.') }}><Icon d={P.speaker} /> Ler</button>}
        <button className="btn ghost" onClick={() => setText('')}>Limpar</button>
      </div>

      <h3>Frases rápidas</h3>
      <ul className="phrases">
        {phrases.map((p, i) => (
          <li key={p + i}>
            <button className="chip" onClick={() => show(p)}>{p}</button>
            <button className="icon sm" onClick={() => changePhrases(phrases.filter((_, j) => j !== i))} aria-label={`Apagar frase: ${p}`}><Icon d={P.x} size={18} /></button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input value={newPhrase} onChange={(e) => setNewPhrase(e.target.value)} placeholder="Nova frase rápida" />
        <button className="btn ghost" disabled={!newPhrase.trim()} onClick={() => { changePhrases([...phrases, newPhrase.trim()]); setNewPhrase('') }}>Adicionar</button>
      </div>

      {history.length > 0 && (<><h3>Desta sessão</h3><ul className="phrases">{history.map((h) => <li key={h}><button className="chip" onClick={() => show(h)}>{h}</button></li>)}</ul></>)}
    </section>
  )
}

function Customize({ s, update, setS }: { s: Settings; update: (p: Partial<Settings>) => void; setS: (s: Settings) => void }) {
  const [custom, setCustom] = useState(loadCustomProfiles)
  const [name, setName] = useState('')
  const [voices, setVoices] = useState(listVoices)
  useEffect(() => {
    if (!ttsSupported) return
    const f = () => setVoices(listVoices())
    speechSynthesis.addEventListener('voiceschanged', f)
    return () => speechSynthesis.removeEventListener('voiceschanged', f)
  }, [])
  const allProfiles = useMemo(() => ({ ...PROFILES, ...custom }), [custom])
  const apply = (p: Partial<Settings>) => setS({ ...s, ...p })
  const saveProfile = () => {
    if (!name.trim()) return
    const { fontSize, fontFamily, fontWeight, textColor, bgColor, interimColor, lineHeight, letterSpacing, align, historyLimit } = s
    const next = { ...custom, [name.trim()]: { fontSize, fontFamily, fontWeight, textColor, bgColor, interimColor, lineHeight, letterSpacing, align, historyLimit } }
    setCustom(next); saveCustomProfiles(next); setName('')
  }
  const Range = ({ label, k, min, max, step = 1 }: { label: string; k: keyof Settings; min: number; max: number; step?: number }) => (
    <label className="field">{label}: <b>{String(s[k])}</b>
      <input type="range" min={min} max={max} step={step} value={s[k] as number} onChange={(e) => update({ [k]: Number(e.target.value) } as Partial<Settings>)} />
    </label>
  )
  return (
    <section className="custom">
      <div className="preview"><p>Assim vais ler o texto. <span className="interim">Texto provisório.</span></p></div>

      <h3>Perfis</h3>
      <div className="row wrap">
        {Object.keys(allProfiles).map((n) => <button key={n} className="chip" onClick={() => apply(allProfiles[n])}>{n}</button>)}
      </div>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do perfil personalizado" />
        <button className="btn ghost" disabled={!name.trim()} onClick={saveProfile}>Guardar perfil</button>
      </div>

      <h3>Letras</h3>
      <Range label="Tamanho" k="fontSize" min={24} max={160} />
      <Range label="Peso" k="fontWeight" min={300} max={900} step={100} />
      <Range label="Altura da linha" k="lineHeight" min={1} max={2} step={0.05} />
      <Range label="Espaço entre letras" k="letterSpacing" min={0} max={10} step={0.5} />
      <label className="field">Tipo de letra
        <select value={s.fontFamily} onChange={(e) => update({ fontFamily: e.target.value })}>{Object.keys(FONTS).map((f) => <option key={f}>{f}</option>)}</select>
      </label>
      <label className="field">Alinhamento
        <select value={s.align} onChange={(e) => update({ align: e.target.value as Settings['align'] })}><option value="left">Esquerda</option><option value="center">Centro</option></select>
      </label>

      <h3>Cores</h3>
      <div className="colors">
        <label>Texto <input type="color" value={s.textColor} onChange={(e) => update({ textColor: e.target.value })} /></label>
        <label>Fundo <input type="color" value={s.bgColor} onChange={(e) => update({ bgColor: e.target.value })} /></label>
        <label>Provisório <input type="color" value={s.interimColor} onChange={(e) => update({ interimColor: e.target.value })} /></label>
      </div>

      <h3>Conversa</h3>
      <Range label="Frases visíveis" k="historyLimit" min={1} max={20} />
      <label className="field">Idioma de reconhecimento
        <select value={s.lang} onChange={(e) => update({ lang: e.target.value })}>
          <option value="pt-PT">Português (Portugal)</option>
          <option value="pt-BR">Português (Brasil)</option>
        </select>
        <small>O português de Angola não tem opção própria nos motores do navegador; usa o que soa mais próximo e corrige à mão se preciso.</small>
      </label>
      <label className="check"><input type="checkbox" checked={s.keepAwake} onChange={(e) => update({ keepAwake: e.target.checked })} /> Manter o ecrã ligado ao ouvir</label>

      <h3>Voz</h3>
      {ttsSupported ? (<>
        <label className="field">Voz
          <select value={s.voiceURI} onChange={(e) => update({ voiceURI: e.target.value })}>
            <option value="">Predefinida do dispositivo</option>
            {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang}){v.localService ? '' : ' — online'}</option>)}
          </select>
        </label>
        <Range label="Velocidade" k="speakRate" min={0.5} max={2} step={0.1} />
        <Range label="Tom" k="speakPitch" min={0.5} max={2} step={0.1} />
        <button className="btn ghost" onClick={() => speak('Olá, esta é a minha voz.', s.speakRate, s.speakPitch, s.voiceURI)}>Testar voz</button>
      </>) : <p className="hint">Este dispositivo não tem síntese de voz.</p>}

      <h3>Dados</h3>
      <div className="row">
        <button className="btn ghost" onClick={() => setS(DEFAULTS)}>Repor predefinições</button>
        <button className="btn danger" onClick={() => { if (confirm('Apagar todas as preferências, perfis e frases guardadas neste dispositivo?')) { clearAll(); localStorage.removeItem('liricz.consent'); location.reload() } }}>Apagar todos os dados locais</button>
      </div>
    </section>
  )
}
