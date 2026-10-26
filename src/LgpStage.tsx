import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { transcript } from './transcript'
import { resolveGlosses, type Segment, type UnitKind } from './lgp'
import { initAvatar, onAvatarIdle, playSigml, playSigmlUrl, SAMPLE_URL } from './avatar'
import './lgp-extra.css'

interface Chip { g: string; kind: UnitKind; prov: boolean }
interface Row { id: number; chips: Chip[]; langs: string[]; fallback: boolean }
type Status = 'idle' | 'loading' | 'ready' | 'error'

const TIPS: Record<UnitKind, string> = {
  sign: 'Sinal guardado', compound: 'Gesto composto (várias partes)', number: 'Número, dígito a dígito',
  spell: 'Soletrado com o alfabeto manual (ainda sem sinal)', ai: 'Sinal gerado por IA (provisório)', missing: 'Sem sinal',
}
const CLS: Record<UnitKind, string> = { sign: '', compound: '', number: ' nu', spell: ' sp', ai: ' ai', missing: ' no' }

// O div do avatar fica fora do estado do React: o CWASA põe lá dentro o canvas e o React não lhe toca.
const AvatarCanvas = memo(function AvatarCanvas() { return <div className="CWASAAvatar av0" /> })

export function LgpStage({ active, listening, withCaps }: { active: boolean; listening: boolean; withCaps: boolean }) {
  const items = useSyncExternalStore(transcript.subscribe, transcript.get)
  const [status, setStatus] = useState<Status>('idle')
  const [err, setErr] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const seen = useRef(new Set<number>())
  const queue = useRef<Segment[]>([])
  const lastSet = useRef<Segment[]>([])
  const busy = useRef(false)
  const after = useRef(0)       // pausa (ms) a fazer depois do segmento que está a tocar
  const timer = useRef(0)
  const safety = useRef(0)
  const ready = useRef(false)

  const pump = () => {
    if (busy.current || !ready.current || timer.current) return
    const seg = queue.current.shift()
    if (!seg) return
    busy.current = true; after.current = seg.pauseMs
    clearTimeout(safety.current); safety.current = window.setTimeout(() => { busy.current = false; pump() }, 45000)
    try { playSigml(seg.sigml) } catch { busy.current = false }
  }

  // Arranca o avatar na primeira vez que o ecrã é visível (o canvas precisa de ter tamanho).
  useEffect(() => {
    if (!active || status !== 'idle') return
    setStatus('loading')
    initAvatar().then(() => { ready.current = true; setStatus('ready'); pump() }).catch((e) => { setErr((e as Error).message); setStatus('error') })
  }, [active, status])

  useEffect(() => onAvatarIdle(() => {
    busy.current = false; clearTimeout(safety.current)
    const wait = after.current; after.current = 0
    if (wait > 0) { timer.current = window.setTimeout(() => { timer.current = 0; pump() }, wait) } else pump() // pausa de oração/frase do PE2LGP
  }), [])

  // Frases novas com glosas: o servidor resolve os sinais (BD, compostos, números, soletrar, IA) e o avatar gestualiza.
  useEffect(() => {
    if (!active) return
    for (const it of items) {
      if (!it.lgp || !it.final || seen.current.has(it.id)) continue
      seen.current.add(it.id)
      const glosses = it.lgp, fallback = !!it.lgpExtra?.fallback
      resolveGlosses(glosses, it.lgpExtra).then((res) => {
        const chips = res.units.map((u) => ({ g: u.gloss || '…', kind: u.kind, prov: u.provisional }))
        const langs = [...new Set(res.units.map((u) => u.language).filter(Boolean) as string[])]
        setRows((r) => [...r, { id: it.id, chips, langs, fallback }].slice(-3))
        if (res.segments.length) { lastSet.current = res.segments; queue.current = [...queue.current, ...res.segments].slice(-8); pump() }
      }).catch(() => setRows((r) => [...r, { id: it.id, chips: glosses.map((g) => ({ g, kind: 'missing' as UnitKind, prov: false })), langs: [], fallback }].slice(-3)))
    }
  }, [items, active])

  const cur = rows[rows.length - 1]
  const signed = cur?.chips.some((c) => c.kind !== 'missing')
  const spelled = cur?.chips.filter((c) => c.kind === 'spell').map((c) => c.g) ?? []
  const msg = status === 'error' ? err : status !== 'ready' ? 'A carregar o avatar…' : ''

  return (
    <div className={`lgpstage${withCaps ? ' with-caps' : ''}`} hidden={!active}>
      <div className="avbox">
        <AvatarCanvas />
        {msg && <p className="avmsg" role={status === 'error' ? 'alert' : undefined}>{msg}</p>}
        {status === 'ready' && !cur && <p className="avmsg">{listening ? 'A ouvir… o avatar vai gestualizar o que disseres.' : 'Toca no microfone e fala. O avatar gestualiza a frase.'}</p>}
      </div>
      {rows.slice(-2).map((r, i, a) => (
        <div key={r.id} className="glr" style={{ opacity: i === a.length - 1 ? 1 : 0.5 }}>
          {r.chips.map((c, j) => <span key={j} className={`gl${CLS[c.kind]}${c.prov && c.kind !== 'missing' ? ' pv' : ''}`} title={TIPS[c.kind] + (c.prov && c.kind !== 'missing' ? ' · não validado' : '')}>{c.g}</span>)}
        </div>
      ))}
      {cur && !signed && <p className="hint-l lgpnote">Ainda não há sinais para estas palavras; mostro só as glosas.</p>}
      {spelled.length > 0 && <p className="hint-l lgpnote">Sem sinal guardado, soletrado: {spelled.slice(0, 6).join(', ')}{spelled.length > 6 ? '…' : ''}</p>}
      <div className="lgpbar">
        {cur?.langs.includes('LGP') && <span className="pill warn">Sinais de LGP (Portugal), não de LGA</span>}
        {cur?.langs.length === 1 && cur.langs[0] === 'LGA' && <span className="pill ok">LGA</span>}
        {cur?.chips.some((c) => c.prov && c.kind !== 'missing') && <span className="pill warn">Inclui sinais provisórios (ainda não validados)</span>}
        {cur?.fallback && <span className="pill warn">Tradução simplificada, palavra a palavra</span>}
        {status === 'ready' && <>
          <button className="btn ghost sm" disabled={!lastSet.current.length} onClick={() => { busy.current = false; clearTimeout(timer.current); timer.current = 0; queue.current = [...lastSet.current]; pump() }}>Repetir</button>
          <button className="btn ghost sm" onClick={() => playSigmlUrl(SAMPLE_URL)}>Testar avatar</button>
        </>}
      </div>
    </div>
  )
}
