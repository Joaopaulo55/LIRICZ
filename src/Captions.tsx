import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { transcript } from './transcript'
import { lookup, norm } from './emoji'
import { signUrl, useSigns } from './signs'
import { Icon, P } from './icons'
import type { Settings } from './settings'

export const Words = memo(function Words({ text, on, rules }: { text: string; on: boolean; rules: Record<string, string> }) {
  return (
    <>
      {text.split(' ').map((w, i) => {
        const e = on ? lookup(w, rules) : undefined
        return (
          <Fragment key={i}>
            <span className={e ? 'w emo' : 'w'}>{e ? <><span aria-hidden="true">{e}</span><span className="sr">{w}</span></> : w}</span>{' '}
          </Fragment>
        )
      })}
    </>
  )
})

// Divide em "legendas de cinema": blocos curtos que respeitam a pontuação.
function chunk(text: string): string[] {
  const out: string[] = []; let cur: string[] = []
  for (const w of text.split(' ')) {
    cur.push(w)
    if (cur.length >= 8 || (cur.length >= 3 && /[.?!,;:]$/.test(w))) { out.push(cur.join(' ')); cur = [] }
  }
  if (cur.length) { if (out.length && cur.length < 2) out[out.length - 1] += ' ' + cur.join(' '); else out.push(cur.join(' ')) }
  return out
}

function Live({ s, listening }: { s: Settings; listening: boolean }) {
  const items = useSyncExternalStore(transcript.subscribe, transcript.get)
  const ref = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [faded, setFaded] = useState(false)
  const shown = items.slice(-s.historyLimit), n = shown.length

  useLayoutEffect(() => { const el = ref.current; if (el && pinned) el.scrollTop = el.scrollHeight }, [items, pinned])
  useEffect(() => {
    setFaded(false)
    if (!s.fadeOutSec || !items.length) return
    const t = setTimeout(() => setFaded(true), s.fadeOutSec * 1000)
    return () => clearTimeout(t)
  }, [items, s.fadeOutSec])

  const onScroll = () => { const el = ref.current!; const at = el.scrollHeight - el.scrollTop - el.clientHeight < 48; if (at !== pinned) setPinned(at) }
  return (
    <div className="capwrap">
      <div ref={ref} className={`captions${faded ? ' faded' : ''}`} onScroll={onScroll} aria-live="polite">
        <div className="cap-inner">
          {n === 0 && <p className="hint">{listening ? 'A ouvir… fala normalmente.' : 'Toca no microfone e fala. As palavras aparecem aqui.'}</p>}
          {shown.map((it, idx) => (
            <p key={it.id} className={`seg${it.final ? '' : ' interim'}`} style={{ opacity: pinned ? Math.max(0.35, 1 - (n - 1 - idx) * 0.16) : 1 }}>
              <Words text={it.text} on={s.emojiOn} rules={s.emojiRules} />
            </p>
          ))}
        </div>
      </div>
      {!pinned && <button className="jump" onClick={() => setPinned(true)} aria-label="Ir para o fim"><Icon d={P.down} /></button>}
    </div>
  )
}

function Cinema({ s, listening }: { s: Settings; listening: boolean }) {
  const items = useSyncExternalStore(transcript.subscribe, transcript.get)
  const seen = useRef(new Set<number>(items.map((i) => i.id)))
  const queue = useRef<string[]>([])
  const busy = useRef(false)
  const timers = useRef<number[]>([])
  const idc = useRef(0)
  const [cur, setCur] = useState<{ id: number; text: string } | null>(null)
  const [out, setOut] = useState(false)

  const pump = () => {
    if (busy.current) return
    const next = queue.current.shift()
    if (!next) return
    busy.current = true; setOut(false); setCur({ id: ++idc.current, text: next })
    const hold = Math.min(5200, Math.max(1500, next.length * 65)) / (queue.current.length > 2 ? 1.8 : 1)
    timers.current.push(window.setTimeout(() => {
      setOut(true)
      timers.current.push(window.setTimeout(() => { busy.current = false; if (queue.current.length) pump(); else setCur(null) }, 380))
    }, hold))
  }
  useEffect(() => {
    for (const it of items) if (it.final && !seen.current.has(it.id)) { seen.current.add(it.id); queue.current.push(...chunk(it.text)) }
    pump()
  }, [items])
  useEffect(() => () => { timers.current.forEach(clearTimeout); busy.current = false }, [])

  return (
    <div className="cinema" aria-live="polite">
      {cur ? <p key={cur.id} className={`cue${out ? ' out' : ''}`}><Words text={cur.text} on={s.emojiOn} rules={s.emojiRules} /></p>
           : <p className="hint">{listening ? 'A ouvir… as frases aparecem em blocos.' : 'Toca no microfone e fala.'}</p>}
    </div>
  )
}

export const Captions = memo(function Captions({ s, listening }: { s: Settings; listening: boolean }) {
  const items = useSyncExternalStore(transcript.subscribe, transcript.get)
  const signs = useSigns()
  const hits = useMemo(() => {
    if (!s.signsOn) return []
    const out: { k: string; url: string }[] = []
    for (const it of items.slice(-2)) for (const w of it.text.split(' ')) {
      const k = norm(w), e = signs[k]
      if (e && e.validatedBy && signUrl(e) && !out.some((o) => o.k === k)) out.push({ k, url: signUrl(e) })
    }
    return out.slice(-4)
  }, [items, signs, s.signsOn])

  return (
    <>
      {s.captionMode === 'cinema' ? <Cinema s={s} listening={listening} /> : <Live s={s} listening={listening} />}
      {hits.length > 0 && (
        <div className="signs">{hits.map((h) => <figure key={h.k}><img src={h.url} alt={`Sinal de ${h.k}`} decoding="async" /><figcaption>{h.k}</figcaption></figure>)}</div>
      )}
    </>
  )
})
