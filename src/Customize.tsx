import { useEffect, useMemo, useState } from 'react'
import { Words } from './Captions'
import { aiFix, sayText } from './ai'
import { ttsSupported, listVoices } from './tts'
import { translateLgp } from './lgp'
import { SignAdmin } from './SignAdmin'
import { norm, DEFAULT_EMOJI } from './emoji'
import { Settings, DEFAULTS, FONTS, PROFILES, ANIMS, loadCustomProfiles, saveCustomProfiles, clearAll } from './settings'

type Up = (p: Partial<Settings>) => void
const SECTIONS = ['Letra', 'Cores', 'Animação', 'Conversa', 'Voz', 'IA', 'LGP', 'Emojis', 'Dados'] as const

// Fora do componente principal: assim o slider não é recriado a cada movimento (arrastar fica fluido).
function Range({ s, up, label, k, min, max, step = 1 }: { s: Settings; up: Up; label: string; k: keyof Settings; min: number; max: number; step?: number }) {
  return (
    <label className="field"><span>{label}<b>{String(s[k])}</b></span>
      <input type="range" min={min} max={max} step={step} value={s[k] as number} onChange={(e) => up({ [k]: Number(e.target.value) } as Partial<Settings>)} />
    </label>
  )
}
const Check = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) => (
  <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
)

export function Customize({ s, up, setS }: { s: Settings; up: Up; setS: (s: Settings) => void }) {
  const [sec, setSec] = useState<(typeof SECTIONS)[number]>('Letra')
  const [tick, setTick] = useState(0)
  const [custom, setCustom] = useState(loadCustomProfiles)
  const [name, setName] = useState('')
  const [voices, setVoices] = useState(listVoices)
  const [nw, setNw] = useState(''), [ne, setNe] = useState('')
  const [msg, setMsg] = useState('')
  const profiles = useMemo(() => ({ ...PROFILES, ...custom }), [custom])
  const R = (label: string, k: keyof Settings, min: number, max: number, step?: number) => <Range s={s} up={up} label={label} k={k} min={min} max={max} step={step} />

  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 3500); return () => clearInterval(t) }, [])
  useEffect(() => setTick((x) => x + 1), [s.anim, s.animSpeed, s.emojiOn])
  useEffect(() => { if (!ttsSupported) return; const f = () => setVoices(listVoices()); speechSynthesis.addEventListener('voiceschanged', f); return () => speechSynthesis.removeEventListener('voiceschanged', f) }, [])

  return (
    <section className="custom">
      <div className="preview-box" aria-label="Pré-visualização">
        <p key={tick} className="pv"><Words text="Olá, como estás? Estou muito feliz com a casa nova." on={s.emojiOn} rules={s.emojiRules} /></p>
      </div>
      <div className="seg-tabs" role="tablist">{SECTIONS.map((x) => <button key={x} role="tab" aria-selected={sec === x} className={sec === x ? 'on' : ''} onClick={() => setSec(x)}>{x}</button>)}</div>

      <div className="controls" key={sec}>
        {sec === 'Letra' && <>
          {R('Tamanho', 'fontSize', 24, 160)}{R('Peso', 'fontWeight', 300, 900, 100)}{R('Altura da linha', 'lineHeight', 1, 2, 0.05)}{R('Espaço entre letras', 'letterSpacing', 0, 10, 0.5)}
          <label className="field"><span>Tipo de letra</span><select value={s.fontFamily} onChange={(e) => up({ fontFamily: e.target.value })}>{Object.keys(FONTS).map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="field"><span>Alinhamento</span><select value={s.align} onChange={(e) => up({ align: e.target.value as Settings['align'] })}><option value="left">Esquerda</option><option value="center">Centro</option></select></label>
        </>}

        {sec === 'Cores' && <>
          <div className="row wrap">{Object.keys(profiles).map((n) => <button key={n} className="chip" onClick={() => setS({ ...s, ...profiles[n] })}>{n}</button>)}</div>
          <div className="colors">
            <label>Texto <input type="color" value={s.textColor} onChange={(e) => up({ textColor: e.target.value })} /></label>
            <label>Fundo <input type="color" value={s.bgColor} onChange={(e) => up({ bgColor: e.target.value })} /></label>
            <label>Provisório <input type="color" value={s.interimColor} onChange={(e) => up({ interimColor: e.target.value })} /></label>
          </div>
          <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do perfil" aria-label="Nome do perfil" />
            <button className="btn ghost" disabled={!name.trim()} onClick={() => {
              const { fontSize, fontFamily, fontWeight, textColor, bgColor, interimColor, lineHeight, letterSpacing, align, anim, captionMode } = s
              const next = { ...custom, [name.trim()]: { fontSize, fontFamily, fontWeight, textColor, bgColor, interimColor, lineHeight, letterSpacing, align, anim, captionMode } }
              setCustom(next); saveCustomProfiles(next); setName('')
            }}>Guardar perfil</button></div>
        </>}

        {sec === 'Animação' && <>
          <p className="lbl">Como as legendas aparecem</p>
          <div className="seg-two">
            <button className={s.captionMode === 'live' ? 'on' : ''} onClick={() => up({ captionMode: 'live' })}><b>Ao vivo</b><small>Palavra a palavra, ao ritmo da fala</small></button>
            <button className={s.captionMode === 'cinema' ? 'on' : ''} onClick={() => up({ captionMode: 'cinema' })}><b>Cinema</b><small>Blocos com pausas, como nos filmes</small></button>
          </div>
          <p className="lbl">Animação das palavras</p>
          <div className="anim-grid">{ANIMS.map((a) => <button key={a.key} className={s.anim === a.key ? 'on' : ''} onClick={() => up({ anim: a.key })}>{a.name}</button>)}</div>
          {R('Velocidade da animação', 'animSpeed', 0.5, 3, 0.1)}
          {R('Desvanecer após silêncio (s, 0 = nunca)', 'fadeOutSec', 0, 30)}
        </>}

        {sec === 'Conversa' && <>
          <label className="field"><span>Idioma de reconhecimento</span><select value={s.lang} onChange={(e) => up({ lang: e.target.value })}><option value="pt-PT">Português (Portugal)</option><option value="pt-BR">Português (Brasil)</option></select>
            <small>Não existe opção para português de Angola nos motores do navegador.</small></label>
          {R('Frases guardadas no ecrã', 'historyLimit', 5, 60)}
          <Check checked={s.dedupe} onChange={(v) => up({ dedupe: v })}>Evitar palavras repetidas (recomendado no Android)</Check>
          <Check checked={s.keepAwake} onChange={(v) => up({ keepAwake: v })}>Manter o ecrã ligado ao ouvir</Check>
        </>}

        {sec === 'Voz' && <>
          <p className="lbl">Voz do dispositivo (grátis, funciona sem IA)</p>
          {ttsSupported ? <>
            <label className="field"><span>Voz</span><select value={s.voiceURI} onChange={(e) => up({ voiceURI: e.target.value })}>
              <option value="">Automática (a mais natural disponível)</option>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang}){v.localService ? '' : ' — online'}</option>)}</select></label>
            {R('Velocidade', 'speakRate', 0.5, 2, 0.1)}{R('Tom', 'speakPitch', 0.5, 2, 0.1)}
          </> : <p className="hint-l">Este dispositivo não tem síntese de voz.</p>}
          <p className="lbl">Voz com IA (Gemini, grátis com limites)</p>
          <Check checked={s.aiTts} onChange={(v) => up({ aiTts: v })}>Usar voz natural com IA ao ler mensagens</Check>
          <label className="field"><span>Voz IA</span><select value={s.aiVoice} onChange={(e) => up({ aiVoice: e.target.value })}>{['Kore', 'Puck', 'Charon', 'Aoede', 'Zephyr', 'Fenrir'].map((v) => <option key={v}>{v}</option>)}</select></label>
          <button className="btn ghost" onClick={async () => setMsg((await sayText('Olá, esta é a minha voz. Como estás?', s)) ?? 'Voz reproduzida.')}>Testar voz</button>
          {msg && <p className="hint-l">{msg}</p>}
        </>}

        {sec === 'IA' && <>
          <Check checked={s.aiFix} onChange={(v) => up({ aiFix: v })}>Melhorar legendas com Gemini (pontuação e erros)</Check>
          <p className="hint-l">Desligado por defeito. Quando ligado, cada frase já confirmada é enviada em texto (sem áudio) ao Google Gemini e corrigida em segundos. As legendas aparecem primeiro, sem esperar pela IA. Conforme o plano da chave usada, a Google pode usar o conteúdo enviado para melhorar os seus produtos.</p>
          <label className="field"><span>A tua chave Gemini (opcional)</span><input type="password" value={s.geminiKey} onChange={(e) => up({ geminiKey: e.target.value.trim() })} placeholder="Deixa vazio para usar a do servidor" autoComplete="off" />
            <small>A chave fica só neste aparelho e é enviada apenas à função do teu site.</small></label>
          <button className="btn ghost" onClick={async () => { setMsg('A testar…'); try { setMsg('Resultado: ' + (await aiFix('ola zelina como é que estas', s.geminiKey) ?? 'resposta rejeitada')) } catch (e) { setMsg('Falhou: ' + (e as Error).message) } }}>Testar IA</button>
          {msg && <p className="hint-l">{msg}</p>}
        </>}

        {sec === 'LGP' && <>
          <Check checked={s.lgpOn} onChange={(v) => {
            if (!v) return up({ lgpOn: false })
            if (confirm('Ligar a tradução para glosas de LGP?\n\n• O texto de cada frase confirmada (sem áudio) é enviado ao servidor do LIRICz para ser convertido.\n• É Língua Gestual Portuguesa (Portugal), não Língua Gestual Angolana.\n• Passa a aparecer um avatar a gestualizar e as legendas de texto ficam escondidas (podes voltar a mostrá-las nesta secção).')) up({ lgpOn: true })
          }}>Mostrar o avatar de língua gestual (LGP) em vez das legendas</Check>
          <Check checked={s.lgpCaptions} onChange={(v) => up({ lgpCaptions: v })}>Mostrar também as legendas de texto com o avatar</Check>
          <p className="hint-l">Desligado por defeito. O servidor converte a frase em glosas (a frase na ordem e nas palavras da LGP) e o avatar 3D gestualiza as glosas para as quais existe um sinal validado guardado; as outras aparecem só como texto. É uma tradução automática de português europeu para LGP de Portugal e pode não corresponder à Língua Gestual Angolana. O servidor gratuito adormece quando está parado: a primeira frase pode demorar cerca de um minuto.</p>
          <SignAdmin />
          <button className="btn ghost" onClick={async () => { setMsg('A testar… (se o servidor estiver a dormir, pode demorar até 1 minuto)'); try { const r = await translateLgp('Qual é o teu nome?', undefined, 6); setMsg('Resultado: ' + r.glosses.join(' ')) } catch (e) { setMsg('Falhou: ' + (e as Error).message) } }}>Testar LGP</button>
          {msg && <p className="hint-l">{msg}</p>}
        </>}

        {sec === 'Emojis' && <>
          <Check checked={s.emojiOn} onChange={(v) => up({ emojiOn: v })}>Mostrar emoji no lugar da palavra</Check>
          <Check checked={s.signsOn} onChange={(v) => up({ signsOn: v })}>Mostrar imagem do sinal (só os validados)</Check>
          <div className="row wrap">{Object.entries(s.emojiRules).map(([w, e]) => <button key={w} className="chip" aria-label={`Apagar regra ${w}`} onClick={() => { const r = { ...s.emojiRules }; delete r[w]; up({ emojiRules: r }) }}>{e} {w} ×</button>)}</div>
          <div className="row"><input value={nw} onChange={(e) => setNw(e.target.value)} placeholder="Palavra" aria-label="Palavra" /><input value={ne} onChange={(e) => setNe(e.target.value)} placeholder="Emoji" aria-label="Emoji" style={{ maxWidth: 100 }} />
            <button className="btn ghost" disabled={!norm(nw) || !ne.trim()} onClick={() => { up({ emojiRules: { ...s.emojiRules, [norm(nw)]: ne.trim() } }); setNw(''); setNe('') }}>Adicionar</button></div>
          <button className="btn ghost" onClick={() => up({ emojiRules: DEFAULT_EMOJI })}>Repor emojis</button>
        </>}

        {sec === 'Dados' && <div className="row">
          <button className="btn ghost" onClick={() => setS(DEFAULTS)}>Repor predefinições</button>
          <button className="btn danger" onClick={() => { if (confirm('Apagar todas as preferências, perfis e frases deste dispositivo?')) { clearAll(); localStorage.removeItem('liricz.consent'); location.reload() } }}>Apagar todos os dados locais</button>
        </div>}
      </div>
    </section>
  )
}
