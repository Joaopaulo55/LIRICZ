// Painel de administração do LIRICz  ->  abre em  /#painel   (token: ADMIN_TOKEN do servidor)
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { initAvatar, onAvatarIdle, playSigml, stopAvatar } from './avatar'
import './panel.css'

type Api = (action: string, body?: Record<string, unknown>) => Promise<any>
interface Ctx { api: Api; vocab: any; reload: () => Promise<void>; play: (xml: string) => void; playSeq: (segs: { sigml: string; pauseMs: number }[]) => void }
const TK = 'liricz.admin'
const TABS = ['Visão geral', 'Sinais', 'LGA (Angola)', 'Fila', 'Automático', 'Dicionário', 'Testar', 'Configuração'] as const
type Tab = typeof TABS[number]
const wrap = (x: string) => (/<sigml[\s>]/i.test(x) ? x : `<?xml version="1.0" encoding="utf-8"?><sigml>${x}</sigml>`)
const AvatarCanvas = memo(function AvatarCanvas() { return <div className="CWASAAvatar av0" /> })
const fmt = (ts: string) => { try { return new Date(ts).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'medium' }) } catch { return ts } }

function useAct() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const go = async <T,>(fn: () => Promise<T>, okMsg?: (r: T) => string): Promise<T | undefined> => {
    setBusy(true); setMsg(null)
    try { const r = await fn(); if (okMsg) setMsg({ ok: true, t: okMsg(r) }); return r }
    catch (e) { setMsg({ ok: false, t: (e as Error).message }); return undefined }
    finally { setBusy(false) }
  }
  return { busy, msg, go }
}
const Msg = ({ m }: { m: { ok: boolean; t: string } | null }) => (m ? <p className={`pmsg ${m.ok ? 'ok' : 'bad'}`} role="status">{m.t}</p> : null)
const Sel = ({ value, onChange, options, empty }: { value: string; onChange: (v: string) => void; options: string[]; empty?: string }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}>{empty !== undefined && <option value="">{empty}</option>}{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
)

export default function Panel() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TK) || '')
  const [authed, setAuthed] = useState(false)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('Visão geral')
  const [vocab, setVocab] = useState<any>(null)
  const [av, setAv] = useState<'off' | 'loading' | 'ready' | 'error'>('off')
  const [avErr, setAvErr] = useState('')
  const avRef = useRef<'off' | 'loading' | 'ready' | 'error'>('off')
  const seq = useRef<{ sigml: string; pauseMs: number }[]>([])
  const after = useRef(0)
  const tm = useRef(0)

  const api: Api = useCallback(async (action, body = {}) => {
    const r = await fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ action, ...body }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || `erro ${r.status}`)
    return d
  }, [token])

  const login = async () => {
    setErr('')
    try { const v = await api('vocab'); setVocab(v); setAuthed(true); sessionStorage.setItem(TK, token) }
    catch (e) { setErr((e as Error).message); setAuthed(false) }
  }
  useEffect(() => { if (token && !authed) login() }, []) // eslint-disable-line

  const startAvatar = async () => {
    if (avRef.current === 'ready') return true
    avRef.current = 'loading'; setAv('loading')
    try { await initAvatar(); avRef.current = 'ready'; setAv('ready'); return true }
    catch (e) { avRef.current = 'error'; setAv('error'); setAvErr((e as Error).message); return false }
  }
  const play = async (xml: string) => { seq.current = []; clearTimeout(tm.current); if (await startAvatar()) { try { stopAvatar() } catch { /* ok */ } playSigml(wrap(xml)) } }
  const next = () => { const s = seq.current.shift(); if (!s) return; after.current = s.pauseMs; playSigml(s.sigml) }
  const playSeq = async (segs: { sigml: string; pauseMs: number }[]) => { clearTimeout(tm.current); seq.current = [...segs]; if (await startAvatar()) next() }
  useEffect(() => onAvatarIdle(() => { const w = after.current; after.current = 0; if (!seq.current.length) return; if (w > 0) tm.current = window.setTimeout(next, w); else next() }), [])

  if (!authed) return (
    <div className="panel"><div className="plogin">
      <h1>Painel LIRICz</h1>
      <p>Introduz o ADMIN_TOKEN configurado na Vercel (mín. 12 caracteres).</p>
      <input type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && login()} placeholder="ADMIN_TOKEN" autoComplete="off" />
      <button className="pbtn" onClick={login} disabled={!token}>Entrar</button>
      {err && <p className="pmsg bad">{err}</p>}
      <a href="#" onClick={() => { location.hash = '' }}>← voltar à app</a>
    </div></div>
  )
  const reload = async () => { try { setVocab(await api('vocab')) } catch { /* mantém o anterior */ } }
  const ctx: Ctx = { api, vocab, reload, play, playSeq }
  return (
    <div className="panel">
      <header>
        <h1>Painel LIRICz</h1>
        <nav>{TABS.map((t) => <button key={t} className={`ptab${t === tab ? ' on' : ''}`} onClick={() => setTab(t)}>{t}</button>)}</nav>
        <span className="sp" />
        <a href="#" onClick={() => { location.hash = '' }}>App</a>
        <button className="pbtn ghost" onClick={() => { sessionStorage.removeItem(TK); setAuthed(false); setToken('') }}>Sair</button>
      </header>
      <div className="pbody">
        <main>
          {tab === 'Visão geral' && <Overview ctx={ctx} />}
          {tab === 'Sinais' && <SignsTab ctx={ctx} />}
          {tab === 'LGA (Angola)' && <LgaTab ctx={ctx} />}
          {tab === 'Fila' && <QueueTab ctx={ctx} />}
          {tab === 'Automático' && <AutoTab ctx={ctx} />}
          {tab === 'Dicionário' && <DictTab ctx={ctx} />}
          {tab === 'Testar' && <TestTab ctx={ctx} />}
          {tab === 'Configuração' && <ConfigTab ctx={ctx} />}
        </main>
        <aside>
          <h3>Avatar de pré-visualização</h3>
          <AvatarCanvas />
          {av === 'off' && <button className="pbtn" onClick={startAvatar}>Ligar avatar</button>}
          {av === 'loading' && <p className="hint">A carregar o avatar…</p>}
          {av === 'error' && <p className="pmsg bad">{avErr} <button className="pbtn ghost" onClick={() => { avRef.current = 'off'; setAv('off') }}>Tentar de novo</button></p>}
          {av === 'ready' && <button className="pbtn ghost" onClick={() => { seq.current = []; try { stopAvatar() } catch { /* ok */ } }}>Parar</button>}
          <p className="hint">Testa aqui cada SiGML antes de o validar. Se o avatar ficar parado, o SiGML tem algum símbolo que o CWASA não conhece: edita ou apaga esse sinal.</p>
        </aside>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------- Visão geral
function Overview({ ctx }: { ctx: Ctx }) {
  const [o, setO] = useState<any>(null)
  const { busy, msg, go } = useAct()
  const load = () => go(async () => setO(await ctx.api('overview')))
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])
  if (!o) return <><p>A carregar…</p><Msg m={msg} /></>
  const tot = o.signs.reduce((a: number, x: any) => a + x.n, 0)
  const val = o.signs.filter((x: any) => x.validated).reduce((a: number, x: any) => a + x.n, 0)
  const by = (k: string, v: any) => o.signs.filter((x: any) => x[k] === v).reduce((a: number, x: any) => a + x.n, 0)
  const b = o.backend ?? {}
  const warns: string[] = []
  if (!o.env.gemini) warns.push('Falta a chave do Gemini: a IA está indisponível (junta-a em Configuração).')
  if (!o.env.backend || !o.env.lgpToken) warns.push('LGP_BACKEND_URL / LGP_TOKEN em falta: sem tradução para glosas.')
  if (b.translator_ready === false) warns.push('O tradutor PE2LGP ainda não está pronto (' + (b.error || b.stage || 'a arrancar') + ').')
  if (b.dictionary && o.lexicon.enabled > 0 && b.dictionary.from_panel === 0) warns.push('O backend ainda não leu o dicionário do painel: define DICT_URL no Render e carrega em "Sincronizar" no separador Dicionário.')
  if (b.dictionary?.error) warns.push('Erro ao ler o dicionário do painel: ' + b.dictionary.error)
  const ev = (k: string) => o.events24h.find((e: any) => e.kind === k)?.n ?? 0
  return (
    <section>
      <div className="row"><h2>Estado</h2><button className="pbtn ghost" onClick={load} disabled={busy}>Atualizar</button></div>
      {warns.map((w, i) => <p key={i} className="pmsg bad">{w}</p>)}
      <div className="cards">
        <div className="card"><b>{tot}</b><span>sinais ({val} validados · {tot - val} provisórios)</span><small>LGA {by('language', 'LGA')} · LGP {by('language', 'LGP')} · IA {by('source', 'ai')} · regras {by('source', 'rule')}</small></div>
        <div className="card"><b>{o.missing.n}</b><span>glosas sem sinal na fila</span><small>{o.missing.hits} pedidos no total</small></div>
        <div className="card"><b>{o.lexicon.enabled}</b><span>entradas de dicionário do painel</span><small>{b.dictionary ? `backend: ${b.dictionary.total} linhas (${b.dictionary.from_panel} do painel)` : 'backend sem dados'}</small></div>
        <div className="card"><b>{o.aiToday}/{o.aiCap}</b><span>chamadas de IA hoje</span><small>{o.env.gemini ? 'Gemini configurado' : 'sem chave Gemini'}</small></div>
        <div className="card"><b>{ev('translate')}</b><span>traduções em 24 h</span><small>{ev('translate_fail')} falhas · média {o.translateMs} ms</small></div>
        <div className="card"><b>{ev('resolve')}</b><span>frases gestualizadas em 24 h</span><small>{ev('ai_fail') + ev('gemini_fail') + ev('resolve_fail')} erros de IA/resolução</small></div>
      </div>
      <h3>Backend LGP (Render)</h3>
      <p className="hint">{b.configured === false ? 'Não configurado.' : b.status === 'waking' ? 'A acordar (plano grátis)…' : `pronto: ${b.translator_ready ? 'sim' : 'não'} · memória ${b.memory_mb?.current ?? '?'} MB (pico ${b.memory_mb?.peak ?? '?'}) · fase: ${b.stage ?? '?'} · fallback palavra-a-palavra: ${b.fallback ? 'ligado' : 'desligado'}`}</p>
      <h3>Últimos eventos</h3>
      <div className="tbl"><table><thead><tr><th>Hora</th><th>Tipo</th><th>Detalhe</th></tr></thead><tbody>
        {o.recent.map((e: any) => <tr key={e.id} className={/fail|erro/.test(e.kind) ? 'bad' : ''}><td>{fmt(e.ts)}</td><td>{e.kind}</td><td className="mono">{JSON.stringify(e.detail).slice(0, 160)}</td></tr>)}
      </tbody></table></div>
    </section>
  )
}

// ----------------------------------------------------------------------------- Sinais
function SignsTab({ ctx, lockLang }: { ctx: Ctx; lockLang?: 'LGA' | 'LGP' }) {
  const [q, setQ] = useState(''), [language, setLanguage] = useState<string>(lockLang ?? ''), [status, setStatus] = useState(''), [source, setSource] = useState('')
  const [off, setOff] = useState(0)
  const [data, setData] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 })
  const [edit, setEdit] = useState<{ key: number; init?: any } | null>(null)
  const { busy, msg, go } = useAct()
  const load = () => go(async () => setData(await ctx.api('signs_list', { q, language: lockLang ?? language, status, source, offset: off, limit: 50 })))
  useEffect(() => { load() }, [off])
  const open = (r: any) => go(async () => setEdit({ key: Date.now(), init: (await ctx.api('signs_get', { gloss: r.gloss, language: r.language })).sign }))
  return (
    <section>
      <Convert ctx={ctx} lockLang={lockLang} onDone={load} />
      <div className="row wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar glosa" onKeyDown={(e) => { if (e.key === 'Enter') { setOff(0); load() } }} />
        {!lockLang && <Sel value={language} onChange={setLanguage} options={['LGA', 'LGP']} empty="Todas as línguas" />}
        <Sel value={status} onChange={setStatus} options={['validated', 'draft']} empty="Validados e rascunhos" />
        <Sel value={source} onChange={setSource} options={['manual', 'rule', 'ai', 'spell', 'import', 'copy']} empty="Qualquer origem" />
        <button className="pbtn" onClick={() => { setOff(0); load() }} disabled={busy}>Filtrar</button>
        <button className="pbtn ghost" onClick={() => setEdit({ key: Date.now(), init: lockLang ? { language: lockLang } : undefined })}>+ Novo sinal</button>
      </div>
      <Msg m={msg} />
      <div className="tbl"><table><thead><tr><th>Glosa</th><th>Língua</th><th>Estado</th><th>Origem</th><th>Validado por</th><th /></tr></thead><tbody>
        {data.rows.map((r) => (
          <tr key={r.gloss + r.language}>
            <td><b>{r.gloss}</b></td><td>{r.language}</td><td>{r.validated_by ? <span className="tag ok">validado</span> : <span className="tag warn">rascunho</span>}</td>
            <td>{r.source}</td><td>{r.validated_by || '—'}</td>
            <td className="acts">
              <button className="pbtn sm ghost" onClick={async () => { const s = (await ctx.api('signs_get', { gloss: r.gloss, language: r.language })).sign; ctx.play(s.sigml) }}>▶</button>
              <button className="pbtn sm ghost" onClick={() => open(r)}>Editar</button>
              {!r.validated_by && <button className="pbtn sm" onClick={async () => { const by = prompt('Quem validou este sinal? (pessoa surda, intérprete, associação)'); if (by) { await go(() => ctx.api('sign_validate', { gloss: r.gloss, language: r.language, validatedBy: by }), () => 'Validado.'); load() } }}>Validar</button>}
              {r.language === 'LGP' && !lockLang && <button className="pbtn sm ghost" title="Cria um rascunho LGA a partir deste sinal" onClick={async () => { await go(() => ctx.api('sign_copy', { gloss: r.gloss, from: 'LGP', to: 'LGA' }), () => 'Rascunho LGA criado.'); load() }}>→ LGA</button>}
              <button className="pbtn sm danger" onClick={async () => { if (confirm(`Apagar ${r.gloss} (${r.language})?`)) { await go(() => ctx.api('sign_delete', { gloss: r.gloss, language: r.language })); load() } }}>×</button>
            </td>
          </tr>
        ))}
        {!data.rows.length && <tr><td colSpan={6} className="hint">Sem sinais com estes filtros.</td></tr>}
      </tbody></table></div>
      <div className="row"><span className="hint">{data.total} sinais</span><span className="sp" />
        <button className="pbtn ghost sm" disabled={off === 0} onClick={() => setOff(Math.max(0, off - 50))}>←</button>
        <button className="pbtn ghost sm" disabled={off + 50 >= data.total} onClick={() => setOff(off + 50)}>→</button></div>
      {edit && <SignEditor key={edit.key} ctx={ctx} init={edit.init} lockLang={lockLang} onSaved={() => { load() }} />}
    </section>
  )
}

// ----------------------------------------------------------------------------- Converter glosas existentes em SiGML (1 clique)
function Convert({ ctx, lockLang, onDone }: { ctx: Ctx; lockLang?: 'LGA' | 'LGP'; onDone: () => void }) {
  const [language, setLanguage] = useState<string>(lockLang ?? 'LGP')
  const [src, setSrc] = useState({ lexicon: true, seed: true, missing: true })
  const [paste, setPaste] = useState('')
  const [ai, setAi] = useState(!!ctx.vocab.gemini), [spell, setSpell] = useState(false)
  const [info, setInfo] = useState<any>(null)
  const [running, setRunning] = useState(false), [err, setErr] = useState('')
  const [log, setLog] = useState<{ gloss: string; status: string }[]>([])
  const [saved, setSaved] = useState(0), [left, setLeft] = useState<number | null>(null)
  const stop = useRef(false)
  const count = () => ctx.api('gloss_sources', { language }).then(setInfo).catch((e) => setErr((e as Error).message))
  useEffect(() => { count() }, [language])
  const start = async () => {
    stop.current = false; setRunning(true); setErr(''); setLog([]); setSaved(0); setLeft(null)
    const skip: string[] = []; let n = 0; let all: { gloss: string; status: string }[] = []
    try {
      for (;;) {
        const r = await ctx.api('gloss_convert', { language, sources: src, paste, ai, spell, skip })
        for (const x of r.results) { skip.push(x.gloss); if (/^(guardada|juntada|soletrada)/.test(x.status)) n++ }
        all = [...all, ...r.results]; setLog(all.slice(-40)); setSaved(n); setLeft(r.remaining)
        if (r.stopped) { setErr(r.stopped); break }
        if (stop.current || !r.remaining || !r.results.length) break
      }
    } catch (e) { setErr((e as Error).message) } finally { setRunning(false); onDone(); count() }
  }
  const box = (k: 'lexicon' | 'seed' | 'missing', label: string) => (
    <label className="chk"><input type="checkbox" checked={src[k]} onChange={(e) => setSrc({ ...src, [k]: e.target.checked })} /> {label}{info ? ` (${info[k].pending} por converter de ${info[k].total})` : ''}</label>
  )
  return (
    <details className="editor" open>
      <summary><b>Converter glosas existentes em SiGML (1 clique)</b></summary>
      <p className="hint">Pega nas glosas que o projeto já tem (dicionário do painel, dicionário LGP incluído e fila de palavras sem sinal) e cria o SiGML das que ainda não têm sinal. Palavras compostas juntam os sinais das partes; as restantes são descritas pela IA e montadas por regras. Tudo fica como <b>rascunho provisório</b> até alguém preencher “Validado por”. Podes parar e continuar mais tarde: só converte o que ainda falta.</p>
      <div className="row wrap">
        {!lockLang && <Sel value={language} onChange={setLanguage} options={['LGP', 'LGA']} />}
        {box('lexicon', 'dicionário do painel')}{box('seed', 'dicionário LGP incluído')}{box('missing', 'fila sem sinal')}
      </div>
      <textarea rows={2} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Opcional: cola mais glosas (uma por linha)" spellCheck={false} />
      <div className="row wrap">
        <label className="chk"><input type="checkbox" checked={ai} disabled={!ctx.vocab.gemini} onChange={(e) => setAi(e.target.checked)} /> usar IA (Gemini) quando as regras não chegam{ctx.vocab.gemini ? '' : ' — junta a chave em Configuração'}</label>
        <label className="chk"><input type="checkbox" checked={spell} onChange={(e) => setSpell(e.target.checked)} /> soletrar com o alfabeto manual o que não der (rascunho)</label>
      </div>
      <div className="row wrap">
        {!running ? <button className="pbtn" onClick={start} disabled={!src.lexicon && !src.seed && !src.missing && !paste.trim()}>Converter agora</button>
          : <button className="pbtn danger" onClick={() => { stop.current = true }}>Parar</button>}
        {(running || saved > 0 || left !== null) && <span className="hint">{running ? 'A converter… ' : ''}{saved} guardadas{left !== null ? ` · faltam ${left}` : ''}</span>}
      </div>
      {err && <p className="pmsg bad">{err}</p>}
      {log.length > 0 && <p className="hint mono">{log.map((l) => `${l.gloss}: ${l.status}`).join(' · ')}</p>}
    </details>
  )
}

// ----------------------------------------------------------------------------- Editor de um sinal (colar SiGML | construtor por regras | IA)
function SignEditor({ ctx, init, lockLang, onSaved }: { ctx: Ctx; init?: any; lockLang?: 'LGA' | 'LGP'; onSaved: () => void }) {
  const v = ctx.vocab.vocab
  const [gloss, setGloss] = useState(init?.gloss ?? '')
  const [language, setLanguage] = useState<string>(lockLang ?? init?.language ?? 'LGA')
  const [sigml, setSigml] = useState(init?.sigml ?? '')
  const [by, setBy] = useState(init?.validated_by ?? '')
  const [credit, setCredit] = useState(init?.credit ?? '')
  const [source, setSource] = useState(init?.source ?? 'manual')
  const [hint, setHint] = useState('')
  const [sp, setSp] = useState<any>({ handshape: 'flat', ext: 'u', palm: 'l', location: 'neutral', moves: [] })
  const { busy, msg, go } = useAct()
  const set = (k: string, val: unknown) => setSp((s: any) => ({ ...s, [k]: val }))
  const setMove = (i: number, k: string, val: string) => setSp((s: any) => { const m = [...(s.moves ?? [])]; m[i] = { ...(m[i] ?? {}), [k]: val }; return { ...s, moves: m.filter((x: any) => x.type) } })
  const fromRules = () => go(async () => { const r = await ctx.api('build_sigml', { gloss, spec: sp }); setSigml(r.sigml); setSource('rule') }, () => 'SiGML gerado por regras. Pré-visualiza antes de guardar.')
  const fromAi = () => go(async () => {
    const r = await ctx.api('ai_sign', { gloss, hint, language })
    if (r.mode === 'spell') throw new Error(r.note)
    setSp({ ...r.spec, location: r.spec.location ?? 'neutral' }); setSigml(r.sigml); setSource('ai')
  }, () => 'A IA propôs um sinal (provisório). Pré-visualiza e corrige antes de validar.')
  return (
    <div className="editor">
      <h3>{init?.gloss ? `Editar ${init.gloss}` : 'Novo sinal'}</h3>
      <div className="row wrap">
        <label>Glosa<input value={gloss} onChange={(e) => setGloss(e.target.value)} placeholder="ex.: CASA, MUITO_RICO, KWANZA" /></label>
        <label>Língua{lockLang ? <input value={lockLang} disabled /> : <Sel value={language} onChange={setLanguage} options={['LGA', 'LGP']} />}</label>
        <label>Validado por<input value={by} onChange={(e) => setBy(e.target.value)} placeholder="vazio = rascunho (não validado)" /></label>
        <label>Crédito<input value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="associação / intérprete / fonte" /></label>
      </div>
      <details>
        <summary>Construtor por regras e IA (para não escrever SiGML à mão)</summary>
        <div className="grid">
          <label>Mão<Sel value={sp.handshape} onChange={(x) => set('handshape', x)} options={v.handshape} /></label>
          <label>Polegar<Sel value={sp.thumb ?? ''} onChange={(x) => set('thumb', x || undefined)} options={v.thumb} empty="—" /></label>
          <label>Dedos<Sel value={sp.finger ?? ''} onChange={(x) => set('finger', x || undefined)} options={v.finger} empty="—" /></label>
          <label>Dedos apontam<Sel value={sp.ext} onChange={(x) => set('ext', x)} options={v.ext} /></label>
          <label>Palma virada<Sel value={sp.palm} onChange={(x) => set('palm', x)} options={v.palm} /></label>
          <label>Local<Sel value={sp.location ?? 'neutral'} onChange={(x) => set('location', x)} options={v.location} /></label>
          <label>Contacto<Sel value={sp.contact ?? ''} onChange={(x) => set('contact', x || undefined)} options={v.contact} empty="—" /></label>
          {[0, 1].map((i) => <label key={i}>Movimento {i + 1}<Sel value={sp.moves?.[i]?.type ?? ''} onChange={(x) => setMove(i, 'type', x)} options={v.move} empty="—" /></label>)}
          <label>Tamanho<Sel value={sp.moves?.[0]?.size ?? ''} onChange={(x) => setMove(0, 'size', x)} options={v.size} empty="normal" /></label>
          <label className="chk"><input type="checkbox" checked={!!sp.repeat} onChange={(e) => set('repeat', e.target.checked)} /> repetir</label>
          <label className="chk"><input type="checkbox" checked={!!sp.symmetric} onChange={(e) => set('symmetric', e.target.checked)} /> duas mãos em espelho</label>
        </div>
        <div className="row wrap">
          <button className="pbtn" onClick={fromRules} disabled={busy || !gloss}>Gerar SiGML (regras, sem IA)</button>
          <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Descrição para a IA (opcional): ex. 'mão em concha junto à boca'" />
          <button className="pbtn" onClick={fromAi} disabled={busy || !gloss || !ctx.vocab.gemini} title={ctx.vocab.gemini ? '' : 'junta a chave do Gemini em Configuração'}>Gerar com IA (Gemini)</button>
        </div>
      </details>
      <label>SiGML<textarea rows={8} value={sigml} onChange={(e) => setSigml(e.target.value)} placeholder="Cola aqui um SiGML (<sigml><hns_sign gloss=...>) ou gera acima." spellCheck={false} /></label>
      <div className="row wrap">
        <button className="pbtn ghost" disabled={!sigml} onClick={() => ctx.play(sigml)}>▶ Pré-visualizar</button>
        <button className="pbtn ghost" disabled={!sigml || busy} onClick={() => go(() => ctx.api('sigml_check', { sigml }).then((r) => { if (!r.ok) throw new Error('SiGML inválido: ' + r.error); return r }), (r) => `SiGML bem formado (${r.glosses.length} sinal/sinais).`)}>Verificar</button>
        <button className="pbtn" disabled={!gloss || !sigml || busy} onClick={() => go(() => ctx.api('sign_save', { gloss, language, sigml, validatedBy: by, credit, source }), (r: any) => (r.published ? `Guardado e PUBLICADO (${r.gloss}).` : `Guardado como rascunho (${r.gloss}).`)).then(() => onSaved())}>{by ? 'Guardar e publicar' : 'Guardar rascunho'}</button>
      </div>
      <Msg m={msg} />
      <p className="hint">Só ficam “validados” os sinais com o campo “Validado por” preenchido. Os rascunhos (regras/IA) aparecem na app como provisórios se a opção estiver ligada na Configuração.</p>
    </div>
  )
}

// ----------------------------------------------------------------------------- LGA
function LgaTab({ ctx }: { ctx: Ctx }) {
  return (
    <section>
      <h2>Língua Gestual Angolana (LGA)</h2>
      <p className="hint">Os sinais LGA têm prioridade sobre os de LGP quando ambos estão validados. Para cada palavra: (1) cria o sinal aqui com a <b>mesma glosa</b> que o tradutor produz; (2) se a palavra só existe em Angola (ex.: kwanza, funge), acrescenta-a também no <b>Dicionário</b> com língua LGA e carrega em Sincronizar; (3) pede a uma pessoa surda angolana ou a um intérprete para validar e escreve o nome no campo “Validado por”. Podes partir de um sinal LGP (botão “→ LGA” no separador Sinais) e corrigi-lo.</p>
      <BulkImport ctx={ctx} lockLang="LGA" />
      <SignsTab ctx={ctx} lockLang="LGA" />
    </section>
  )
}

function BulkImport({ ctx, lockLang }: { ctx: Ctx; lockLang?: 'LGA' | 'LGP' }) {
  const [text, setText] = useState(''), [language, setLanguage] = useState<string>(lockLang ?? 'LGA'), [by, setBy] = useState(''), [credit, setCredit] = useState(''), [over, setOver] = useState(false)
  const { busy, msg, go } = useAct()
  return (
    <details className="editor">
      <summary>Importar SiGML em lote (ficheiro com vários &lt;hns_sign gloss="..."&gt;)</summary>
      <input type="file" accept=".sigml,.xml,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} />
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ou cola aqui o conteúdo" spellCheck={false} />
      <div className="row wrap">
        {!lockLang && <Sel value={language} onChange={setLanguage} options={['LGA', 'LGP']} />}
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Validado por (vazio = rascunhos)" />
        <input value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Crédito / fonte" />
        <label className="chk"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /> substituir também os validados</label>
        <button className="pbtn" disabled={busy || !text} onClick={() => go(() => ctx.api('sigml_import', { text, language, validatedBy: by, credit, overwrite: over }), (r: any) => `${r.found} encontrados, ${r.imported} gravados, ${r.skipped} ignorados (já validados).${r.bad.length ? ' Inválidos: ' + r.bad.join(', ') : ''}`)}>Importar</button>
      </div>
      <Msg m={msg} />
    </details>
  )
}

// ----------------------------------------------------------------------------- Fila de glosas sem sinal
function QueueTab({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<any[]>([])
  const [edit, setEdit] = useState<string | null>(null)
  const [log, setLog] = useState<any[]>([])
  const { busy, msg, go } = useAct()
  const load = () => go(async () => setRows((await ctx.api('missing_list')).rows))
  useEffect(() => { load() }, [])
  return (
    <section>
      <div className="row wrap"><h2>Glosas pedidas sem sinal</h2><span className="sp" />
        <button className="pbtn" disabled={busy || !rows.length || !ctx.vocab.gemini} onClick={async () => {
          const r = await go(() => ctx.api('ai_batch', { glosses: rows.filter((x) => !/^\d+$/.test(x.gloss)).slice(0, 8).map((x) => x.gloss), language: 'LGA' }), (x: any) => `${x.results.length} processadas.`)
          if (r) setLog(r.results); load()
        }}>Gerar com IA as 8 mais pedidas</button>
        <button className="pbtn ghost" onClick={() => confirm('Limpar a fila?') && go(() => ctx.api('missing_clear', { all: true })).then(load)}>Limpar</button></div>
      <p className="hint">Palavras que as pessoas disseram e para as quais não há sinal: o avatar soletrou-as (ou usou IA, se ligada). Resolve as mais pedidas primeiro.</p>
      <Msg m={msg} />
      {log.length > 0 && <p className="hint">{log.map((l) => `${l.gloss}: ${l.status}${l.error ? ' (' + l.error + ')' : ''}`).join(' · ')}</p>}
      <div className="tbl"><table><thead><tr><th>Glosa</th><th>Pedidos</th><th>Última vez</th><th>Frase</th><th /></tr></thead><tbody>
        {rows.map((r) => (
          <tr key={r.gloss}><td><b>{r.gloss}</b></td><td>{r.hits}</td><td>{fmt(r.last_seen)}</td><td className="mono">{r.sample}</td>
            <td className="acts">
              <button className="pbtn sm" disabled={busy || !ctx.vocab.gemini} onClick={async () => { const x = await go(() => ctx.api('ai_sign', { gloss: r.gloss, language: 'LGA', save: true }), (z: any) => (z.mode === 'spell' ? z.note : 'Rascunho gerado pela IA e guardado.')); if (x) load() }}>IA</button>
              <button className="pbtn sm ghost" onClick={() => setEdit(r.gloss)}>Criar</button>
              <button className="pbtn sm ghost" onClick={async () => { await ctx.api('missing_clear', { gloss: r.gloss }); load() }}>Ignorar</button>
            </td></tr>
        ))}
        {!rows.length && <tr><td colSpan={5} className="hint">A fila está vazia.</td></tr>}
      </tbody></table></div>
      {edit && <SignEditor key={edit} ctx={ctx} init={{ gloss: edit, language: 'LGA' }} onSaved={() => { setEdit(null); ctx.api('missing_clear', { gloss: edit }).then(load) }} />}
    </section>
  )
}

// ----------------------------------------------------------------------------- Automático
function AutoTab({ ctx }: { ctx: Ctx }) {
  const [what, setWhat] = useState('all'), [language, setLanguage] = useState('LGA'), [over, setOver] = useState(false)
  const [list, setList] = useState(''), [hint, setHint] = useState(''), [words, setWords] = useState('')
  const [out, setOut] = useState<any[]>([]), [entries, setEntries] = useState<any[]>([])
  const a = useAct(), b = useAct(), c = useAct()
  return (
    <section>
      <h2>Enchimento automático</h2>
      <div className="editor">
        <h3>1 · Alfabeto manual e dígitos (sem IA)</h3>
        <p className="hint">Cria 36 rascunhos (A–Z, 0–9) por regras. São aproximações de partida: ajusta cada letra no separador Sinais e valida com uma pessoa surda. Servem para soletrar nomes e palavras sem sinal e para ler números dígito a dígito.</p>
        <div className="row wrap">
          <Sel value={what} onChange={setWhat} options={['all', 'letters', 'digits']} />
          <Sel value={language} onChange={setLanguage} options={['LGA', 'LGP']} />
          <label className="chk"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /> substituir os que já existem</label>
          <button className="pbtn" disabled={a.busy} onClick={() => a.go(() => ctx.api('rule_fill', { what, language, overwrite: over }), (r: any) => `${r.written} de ${r.total} gravados.`)}>Preencher</button>
        </div>
        <Msg m={a.msg} />
      </div>
      <BulkImport ctx={ctx} />
      <div className="editor">
        <h3>2 · Gerar sinais com IA (Gemini)</h3>
        <p className="hint">Uma glosa por linha (até 8 por vez). A IA só escolhe valores de um vocabulário fechado e o SiGML é montado por regras, por isso nunca sai XML inválido. O resultado é um rascunho provisório: confirma no avatar e valida.</p>
        <textarea rows={4} value={list} onChange={(e) => setList(e.target.value)} placeholder={'CASA\nESCOLA\nAGUA'} />
        <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Indicações comuns (opcional)" />
        <div className="row"><button className="pbtn" disabled={c.busy || !list.trim() || !ctx.vocab.gemini} onClick={async () => { const r = await c.go(() => ctx.api('ai_batch', { glosses: list.split('\n'), hint, language }), (x: any) => `${x.results.length} processadas.`); if (r) setOut(r.results) }}>Gerar</button></div>
        {out.length > 0 && <p className="hint">{out.map((l) => `${l.gloss}: ${l.status}${l.error ? ' (' + l.error + ')' : ''}`).join(' · ')}</p>}
        <Msg m={c.msg} />
      </div>
      <div className="editor">
        <h3>3 · Expandir o dicionário com IA</h3>
        <p className="hint">Palavras portuguesas (uma por linha, até 60): a IA propõe lema e glosa e grava no dicionário do painel. Depois carrega em Sincronizar no separador Dicionário.</p>
        <textarea rows={4} value={words} onChange={(e) => setWords(e.target.value)} placeholder={'telemóvel\nmandioca\nmotorista'} />
        <div className="row"><button className="pbtn" disabled={b.busy || !words.trim() || !ctx.vocab.gemini} onClick={async () => { const r = await b.go(() => ctx.api('ai_dictionary', { words }), (x: any) => `${x.entries.length} entradas propostas, ${x.inserted} novas gravadas.`); if (r) setEntries(r.entries) }}>Gerar entradas</button></div>
        {entries.length > 0 && <p className="hint mono">{entries.map((e) => `${e.word}→${e.gloss}`).join(' · ')}</p>}
        <Msg m={b.msg} />
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------- Dicionário
function DictTab({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState(''), [off, setOff] = useState(0)
  const [data, setData] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 })
  const [text, setText] = useState(''), [mode, setMode] = useState('merge'), [language, setLanguage] = useState('LGP')
  const [add, setAdd] = useState({ phrase: '', lemma: '', gloss: '', lang: 'LGP' })
  const { busy, msg, go } = useAct()
  const load = () => go(async () => setData(await ctx.api('lex_list', { q, offset: off, limit: 50 })))
  useEffect(() => { load() }, [off])
  return (
    <section>
      <h2>Dicionário do tradutor</h2>
      <p className="hint">Formato do PE2LGP: <b>palavra, lema, glosa</b> separados por TAB, “;” ou “,” (ou só 2 colunas palavra+glosa, ou só uma lista de palavras). Sem acentos soltos na glosa nem caracteres [ ] ( ) * + ? | \ ^ $ . no lema. O backend Python junta estas entradas ao dicionário incluído quando arranca (variável <b>DICT_URL</b> no Render) e quando carregas em “Sincronizar”.</p>
      <div className="editor">
        <h3>Carregar dicionário</h3>
        <input type="file" accept=".csv,.tsv,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} />
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'casa\tcasa\tcasa\nkwanza\tkwanza\tkwanza'} spellCheck={false} />
        <div className="row wrap">
          <Sel value={mode} onChange={setMode} options={['merge', 'replace']} />
          <Sel value={language} onChange={setLanguage} options={['LGP', 'LGA']} />
          <button className="pbtn" disabled={busy || !text} onClick={() => { if (mode === 'replace' && !confirm('Substituir TODO o dicionário do painel?')) return; go(() => ctx.api('lex_import', { text, mode, lang: language }), (r: any) => `${r.parsed} linhas lidas, ${r.inserted} novas, ${r.invalid} inválidas${r.samples.length ? ' (ex.: ' + r.samples.slice(0, 3).join(' | ') + ')' : ''}.`).then(load) }}>Importar</button>
          <button className="pbtn ghost" disabled={busy} onClick={() => go(() => ctx.api('lex_sync'), (r: any) => `Backend recarregado: ${r.backend.entries} entradas (${r.backend.from_panel} do painel).`)}>Sincronizar com o backend</button>
          <button className="pbtn ghost" disabled={busy} onClick={async () => { const { tsv } = await ctx.api('lex_export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values' })); a.download = 'dicionario-liricz.csv'; a.click() }}>Exportar</button>
        </div>
        <Msg m={msg} />
      </div>
      <div className="row wrap">
        <input value={add.phrase} onChange={(e) => setAdd({ ...add, phrase: e.target.value })} placeholder="palavra" />
        <input value={add.lemma} onChange={(e) => setAdd({ ...add, lemma: e.target.value })} placeholder="lema (vazio = palavra)" />
        <input value={add.gloss} onChange={(e) => setAdd({ ...add, gloss: e.target.value })} placeholder="glosa" />
        <Sel value={add.lang} onChange={(x) => setAdd({ ...add, lang: x })} options={['LGP', 'LGA']} />
        <button className="pbtn" disabled={busy || !add.phrase || !add.gloss} onClick={() => go(() => ctx.api('lex_add', add), () => 'Entrada adicionada.').then(() => { setAdd({ ...add, phrase: '', lemma: '', gloss: '' }); load() })}>Adicionar</button>
      </div>
      <div className="row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar" onKeyDown={(e) => { if (e.key === 'Enter') { setOff(0); load() } }} /><button className="pbtn ghost" onClick={() => { setOff(0); load() }}>Procurar</button><span className="sp" /><span className="hint">{data.total} entradas</span></div>
      <div className="tbl"><table><thead><tr><th>Palavra</th><th>Lema</th><th>Glosa</th><th>Língua</th><th>Origem</th><th /></tr></thead><tbody>
        {data.rows.map((r) => (
          <tr key={r.id} className={r.enabled ? '' : 'off'}><td>{r.phrase}</td><td>{r.lemma}</td><td><b>{r.gloss}</b></td><td>{r.lang}</td><td>{r.source}</td>
            <td className="acts"><button className="pbtn sm ghost" onClick={async () => { await ctx.api('lex_toggle', { id: r.id, enabled: !r.enabled }); load() }}>{r.enabled ? 'Desligar' : 'Ligar'}</button>
              <button className="pbtn sm danger" onClick={async () => { await ctx.api('lex_delete', { id: r.id }); load() }}>×</button></td></tr>
        ))}
      </tbody></table></div>
      <div className="row"><span className="sp" /><button className="pbtn ghost sm" disabled={off === 0} onClick={() => setOff(Math.max(0, off - 50))}>←</button><button className="pbtn ghost sm" disabled={off + 50 >= data.total} onClick={() => setOff(off + 50)}>→</button></div>
    </section>
  )
}

// ----------------------------------------------------------------------------- Testar de ponta a ponta
function TestTab({ ctx }: { ctx: Ctx }) {
  const [text, setText] = useState('Qual é o teu nome?')
  const [r, setR] = useState<any>(null)
  const { busy, msg, go } = useAct()
  return (
    <section>
      <h2>Testar uma frase (texto → glosas → sinais → avatar)</h2>
      <div className="row"><input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go(async () => setR(await ctx.api('pipeline_test', { text })))} />
        <button className="pbtn" disabled={busy || !text.trim()} onClick={() => go(async () => setR(await ctx.api('pipeline_test', { text })))}>{busy ? 'A traduzir…' : 'Traduzir e resolver'}</button></div>
      <p className="hint">Se o servidor do Render estiver a dormir, a primeira tentativa pode demorar até 1 minuto.</p>
      <Msg m={msg} />
      {r && <>
        <p>{r.translate.fallback ? <span className="tag warn">tradução simplificada (palavra a palavra)</span> : <span className="tag ok">PE2LGP</span>} · {r.translate.ms} ms · expressões faciais: {r.translate.extra?.facial_expressions?.length ?? 0} · pausas: {(r.translate.extra?.pauses ?? []).filter(Boolean).length}</p>
        <div className="chips">{r.units.map((u: any, i: number) => <span key={i} className={`chip ${u.kind}${u.provisional ? ' prov' : ''}`} title={u.kind + (u.provisional ? ' · provisório' : '')}>{u.gloss || '…'}<small>{u.kind}</small></span>)}</div>
        {r.needSign.length > 0 && <p className="hint">Sem sinal próprio: {r.needSign.join(', ')}</p>}
        <button className="pbtn" disabled={!r.segments.length} onClick={() => ctx.playSeq(r.segments)}>▶ Gestualizar no avatar</button>
      </>}
    </section>
  )
}

// ----------------------------------------------------------------------------- Configuração
function ConfigTab({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<any>(null)
  const { busy, msg, go } = useAct()
  const t = useAct(), k = useAct()
  const [g, setG] = useState<any>(null), [key, setKey] = useState('')
  useEffect(() => { go(async () => setS((await ctx.api('settings_get')).settings)); k.go(async () => setG(await ctx.api('gemini_status'))) }, [])
  if (!s) return <><p>A carregar…</p><Msg m={msg} /></>
  const up = (k: string, val: unknown) => setS({ ...s, [k]: val })
  const save = () => go(async () => setS((await ctx.api('settings_set', { patch: s })).settings), () => 'Definições guardadas (podem demorar até 20 s a chegar a todas as instâncias).')
  return (
    <section>
      <h2>Configuração</h2>
      <div className="editor">
        <h3>Chave do Gemini</h3>
        <p className="hint">{g?.configured
          ? `Chave ativa (${g.hint}), ${g.from === 'painel' ? 'guardada no painel' : 'vinda da variável GEMINI_API_KEY da Vercel'}. Modelo em uso: ${g.models?.[0] ?? '—'}${g.auto ? ' (automático: o Gemini flash mais recente que a Google oferece)' : ''}.`
          : 'Ainda não há chave. Cria uma grátis em aistudio.google.com/apikey e cola-a aqui.'}</p>
        <div className="row wrap">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="Cola a chave (AIza…)" autoComplete="off" />
          <button className="pbtn" disabled={k.busy || !key} onClick={async () => { const r = await k.go(() => ctx.api('gemini_key_set', { key }), () => 'Chave validada pela Google e guardada.'); if (r) { setG(r); setKey(''); ctx.reload() } }}>Guardar chave</button>
          <button className="pbtn ghost" disabled={k.busy || !g?.configured} onClick={async () => { const r = await k.go(() => ctx.api('gemini_status', { refresh: true }), (x: any) => `Modelo mais recente: ${x.models?.[0] ?? '—'}.`); if (r) setG(r) }}>Procurar modelo mais recente</button>
          {g?.from === 'painel' && <button className="pbtn ghost danger" disabled={k.busy} onClick={async () => { if (!confirm('Remover a chave guardada no painel?')) return; const r = await k.go(() => ctx.api('gemini_key_clear'), () => 'Chave removida.'); if (r) { setG(r); ctx.reload() } }}>Remover chave</button>}
        </div>
        <Msg m={k.msg} />
        <p className="hint">A chave guardada aqui fica cifrada na base de dados e nunca volta ao navegador. Se mudares o ADMIN_TOKEN, cola-a de novo. Com modelo vazio (abaixo) o painel pergunta à Google quais existem e usa sempre o mais recente.</p>
      </div>
      <div className="editor">
        <h3>IA (Gemini)</h3>
        <label>Modo<select value={s.ai_mode} onChange={(e) => up('ai_mode', e.target.value)}>
          <option value="off">Desligada: só regras (alfabeto, números, dicionário, importação)</option>
          <option value="assist">Assistente: a IA só trabalha quando a chamo no painel</option>
          <option value="realtime">Tempo real: gera um sinal provisório quando falta, durante a conversa</option>
        </select></label>
        <div className="row wrap">
          <label>Limite diário de chamadas<input type="number" min={0} max={5000} value={s.ai_daily_cap} onChange={(e) => up('ai_daily_cap', Number(e.target.value))} /></label>
          <label>Máx. por frase (tempo real)<input type="number" min={0} max={10} value={s.ai_per_request} onChange={(e) => up('ai_per_request', Number(e.target.value))} /></label>
          <label>Modelo(s), separados por vírgula<input value={s.ai_model} onChange={(e) => up('ai_model', e.target.value)} placeholder="vazio = automático (o mais recente)" /></label>
        </div>
        <div className="row"><button className="pbtn ghost" disabled={t.busy} onClick={() => t.go(() => ctx.api('ai_test'), (r: any) => `Gemini respondeu em ${r.ms} ms (${r.models.join(', ')}).`)}>Testar Gemini</button></div>
        <Msg m={t.msg} />
        <p className="hint">No modo “tempo real” a IA inventa uma forma plausível: nunca é um sinal validado, aparece sempre como provisório e fica guardada como rascunho para a rever.</p>
      </div>
      <div className="editor">
        <h3>Sinais e palavras sem sinal</h3>
        <label className="chk"><input type="checkbox" checked={s.show_provisional} onChange={(e) => up('show_provisional', e.target.checked)} /> mostrar sinais provisórios (rascunhos, regras, IA) na app, marcados como não validados</label>
        <label>Palavra sem sinal<select value={s.unknown_policy} onChange={(e) => up('unknown_policy', e.target.value)}><option value="spell">Soletrar com o alfabeto manual</option><option value="skip">Saltar</option></select></label>
      </div>
      <div className="editor">
        <h3>Expressões faciais e pausas do PE2LGP</h3>
        <label className="chk"><input type="checkbox" checked={s.nonmanual_on} onChange={(e) => up('nonmanual_on', e.target.checked)} /> enviar expressões faciais ao avatar (perguntas, negação)</label>
        <p className="hint">Deixa DESLIGADO até testares: os códigos abaixo seguem a notação HamNoSys não manual do SiGML mas não foram verificados contra o CWASA. Testa no separador Testar com uma pergunta; se o avatar parar, desliga ou corrige o código.</p>
        {Object.entries(s.nonmanual_map).map(([k, val]) => <label key={k}>{k}<input className="mono" value={val as string} onChange={(e) => up('nonmanual_map', { ...s.nonmanual_map, [k]: e.target.value })} /></label>)}
        <div className="row wrap">
          <label>Pausa entre orações (ms)<input type="number" min={0} max={5000} value={s.pause_ms.oracao} onChange={(e) => up('pause_ms', { ...s.pause_ms, oracao: Number(e.target.value) })} /></label>
          <label>Pausa entre frases (ms)<input type="number" min={0} max={5000} value={s.pause_ms.frase} onChange={(e) => up('pause_ms', { ...s.pause_ms, frase: Number(e.target.value) })} /></label>
        </div>
      </div>
      <button className="pbtn" onClick={save} disabled={busy}>Guardar definições</button>
      <Msg m={msg} />
    </section>
  )
}
