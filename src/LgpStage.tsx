import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { transcript } from './transcript'
import { fetchSigns, buildSigml } from './signsDb'
import { initAvatar, onAvatarIdle, playSigml, playSigmlUrl, SAMPLE_URL } from './avatar'

interface Row { id: number; chips: { g: string; ok: boolean }[]; langs: string[] }
type Status = 'idle' | 'loading' | 'ready' | 'error'

// O div do avatar fica fora do estado do React: o CWASA põe lá dentro o canvas e o React não lhe toca.
const AvatarCanvas = memo(function AvatarCanvas() { return <div className="CWASAAvatar av0" /> })

export function LgpStage({ active, listening, withCaps }: { active: boolean; listening: boolean; withCaps: boolean }) {
  const items = useSyncExternalStore(transcript.subscribe, transcript.get)
  const [status, setStatus] = useState<Status>('idle')
  const [err, setErr] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const seen = useRef(new Set<number>())
  const queue = useRef<string[]>([])
  const busy = useRef(false)
  const safety = useRef(0)
  const last = useRef('')
  const ready = useRef(false)

  const pump = () => {
    if (busy.current || !ready.current) return
    const xml = queue.current.shift()
    if (!xml) return
    busy.current = true; last.current = xml
    clearTimeout(safety.current); safety.current = window.setTimeout(() => { busy.current = false; pump() }, 45000)
    try { playSigml(xml) } catch { busy.current = false }
  }

  // Arranca o avatar na primeira vez que o ecrã é visível (o canvas precisa de ter tamanho).
  useEffect(() => {
    if (!active || status !== 'idle') return
    setStatus('loading')
    initAvatar().then(() => { ready.current = true; setStatus('ready'); pump() }).catch((e) => { setErr((e as Error).message); setStatus('error') })
  }, [active, status])

  useEffect(() => onAvatarIdle(() => { busy.current = false; clearTimeout(safety.current); pump() }), [])

  // Frases novas com glosas: procura os sinais na base de dados, mostra as glosas e põe o avatar a gestualizar.
  useEffect(() => {
    if (!active) return
    for (const it of items) {
      if (!it.lgp || !it.final || seen.current.has(it.id)) continue
      seen.current.add(it.id)
      const glosses = it.lgp
      fetchSigns(glosses).then((signs) => {
        const chips = glosses.map((g) => ({ g, ok: !!signs[g.trim().toUpperCase()] }))
        const langs = [...new Set(Object.values(signs).map((x) => x.language))]
        setRows((r) => [...r, { id: it.id, chips, langs }].slice(-3))
        const xml = buildSigml(glosses, signs)
        if (xml) { queue.current = [...queue.current, xml].slice(-3); pump() }
      })
    }
  }, [items, active])

  const cur = rows[rows.length - 1]
  const signed = cur?.chips.some((c) => c.ok)
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
          {r.chips.map((c, j) => <span key={j} className={`gl${c.ok ? '' : ' no'}`} title={c.ok ? 'Sinal disponível' : 'Ainda sem sinal guardado'}>{c.g}</span>)}
        </div>
      ))}
      {cur && !signed && <p className="hint-l lgpnote">Ainda não há sinais guardados para estas palavras; mostro só as glosas.</p>}
      <div className="lgpbar">
        {cur?.langs.includes('LGP') && <span className="pill warn">Sinais de LGP (Portugal), não de LGA</span>}
        {cur?.langs.length === 1 && cur.langs[0] === 'LGA' && <span className="pill ok">LGA</span>}
        {status === 'ready' && <>
          <button className="btn ghost sm" disabled={!last.current} onClick={() => { busy.current = false; queue.current = [last.current]; pump() }}>Repetir</button>
          <button className="btn ghost sm" onClick={() => playSigmlUrl(SAMPLE_URL)}>Testar avatar</button>
        </>}
      </div>
    </div>
  )
}
