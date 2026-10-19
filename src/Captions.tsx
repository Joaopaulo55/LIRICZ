import { Fragment, memo, useMemo, useSyncExternalStore } from 'react'
import { transcript } from './transcript'
import { lookup, norm } from './emoji'
import { signUrl, useSigns } from './signs'
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

export const Captions = memo(function Captions({ s, listening }: { s: Settings; listening: boolean }) {
  const items = useSyncExternalStore(transcript.subscribe, transcript.get)
  const signs = useSigns()
  const shown = items.slice(-s.historyLimit)
  const n = shown.length

  const hits = useMemo(() => {
    if (!s.signsOn) return []
    const out: { k: string; url: string; credit?: string }[] = []
    for (const it of items.slice(-2)) for (const w of it.text.split(' ')) {
      const k = norm(w), e = signs[k]
      if (e && e.validatedBy && signUrl(e) && !out.some((o) => o.k === k)) out.push({ k, url: signUrl(e), credit: e.credit })
    }
    return out.slice(-4)
  }, [items, signs, s.signsOn])

  return (
    <>
      <div className="captions" aria-live="polite">
        {n === 0 && <p className="hint">{listening ? 'A ouvir… fala normalmente.' : 'Toca no microfone e fala. As palavras aparecem aqui.'}</p>}
        {shown.map((it, idx) => (
          <p key={it.id} className={`seg${it.final ? '' : ' interim'}`} style={{ opacity: Math.max(0.3, 1 - (n - 1 - idx) * 0.2) }}>
            <Words text={it.text} on={s.emojiOn} rules={s.emojiRules} />
          </p>
        ))}
      </div>
      {hits.length > 0 && (
        <div className="signs" aria-label="Sinais">
          {hits.map((h) => (
            <figure key={h.k}><img src={h.url} alt={`Sinal de ${h.k}`} decoding="async" /><figcaption>{h.k}</figcaption></figure>
          ))}
        </div>
      )}
    </>
  )
})
