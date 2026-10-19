import { useState } from 'react'
import { Icon, P } from './icons'
import { sayText } from './ai'
import { ttsSupported } from './tts'
import { loadPhrases, savePhrases, Settings } from './settings'

export function Write({ s, show }: { s: Settings; show: (m: string) => void }) {
  const [text, setText] = useState('')
  const [phrases, setPhrases] = useState(loadPhrases)
  const [history, setHistory] = useState<string[]>([])
  const [np, setNp] = useState('')
  const [note, setNote] = useState('')
  const go = (m: string) => { const t = m.trim(); if (!t) return; show(t); setHistory((h) => [t, ...h.filter((x) => x !== t)].slice(0, 10)) }
  const setP = (p: string[]) => { setPhrases(p); savePhrases(p) }
  const read = async (m: string) => setNote((await sayText(m, s)) ?? '')
  return (
    <section className="write">
      <h2 className="title">Escrever</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Escreve a tua mensagem…" aria-label="A tua mensagem" />
      <div className="row">
        <button className="btn big-btn" onClick={() => go(text)} disabled={!text.trim()}>Mostrar em letras grandes</button>
        {(ttsSupported || s.aiTts) && <button className="btn ghost" disabled={!text.trim()} onClick={() => read(text)}><Icon d={P.speaker} /> Ler</button>}
        <button className="btn ghost" onClick={() => setText('')}>Limpar</button>
      </div>
      {note && <p className="err" role="alert">{note}</p>}
      <h3>Frases rápidas</h3>
      <ul className="phrases">{phrases.map((p, i) => (
        <li key={p + i}><button className="chip" onClick={() => go(p)}>{p}</button>
          <button className="icon sm" onClick={() => setP(phrases.filter((_, j) => j !== i))} aria-label={`Apagar frase: ${p}`}><Icon d={P.x} size={16} /></button></li>
      ))}</ul>
      <div className="row"><input value={np} onChange={(e) => setNp(e.target.value)} placeholder="Nova frase rápida" aria-label="Nova frase rápida" />
        <button className="btn ghost" disabled={!np.trim()} onClick={() => { setP([...phrases, np.trim()]); setNp('') }}>Adicionar</button></div>
      {history.length > 0 && (<><h3>Desta sessão</h3><ul className="phrases">{history.map((h) => <li key={h}><button className="chip" onClick={() => go(h)}>{h}</button></li>)}</ul></>)}
    </section>
  )
}
