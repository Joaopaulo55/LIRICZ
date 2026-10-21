import { useState } from 'react'

// Gestão do vocabulário de sinais (só para o administrador). O token fica apenas nesta sessão do navegador.
export function SignAdmin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('liricz.admin') || '')
  const [gloss, setGloss] = useState(''), [lang, setLang] = useState<'LGA' | 'LGP'>('LGA')
  const [by, setBy] = useState(''), [credit, setCredit] = useState(''), [sigml, setSigml] = useState('')
  const [msg, setMsg] = useState(''), [rows, setRows] = useState<any[]>([])
  const H = { 'content-type': 'application/json', 'x-admin-token': token }
  const keep = (v: string) => { setToken(v); sessionStorage.setItem('liricz.admin', v) }

  const call = async (body: object) => {
    const r = await fetch('/api/signs', { method: 'POST', headers: H, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || `erro ${r.status}`)
    return d
  }
  const run = async (f: () => Promise<void>) => { setMsg('A enviar…'); try { await f() } catch (e) { setMsg('Falhou: ' + (e as Error).message) } }
  const list = () => run(async () => {
    const r = await fetch('/api/signs?all=1', { headers: H }); const d = await r.json()
    if (!r.ok) throw new Error(d.error || `erro ${r.status}`)
    setRows(d.rows); setMsg(`${d.rows.length} sinais guardados.`)
  })
  const save = () => run(async () => {
    const d = await call({ gloss, language: lang, sigml, validatedBy: by, credit })
    setMsg(d.published ? 'Guardado e PUBLICADO (validado).' : 'Guardado como rascunho (sem "validado por", não aparece na app).')
  })
  const del = () => run(async () => { await call({ action: 'delete', gloss, language: lang }); setMsg('Apagado.') })

  return (
    <details className="admin">
      <summary>Sinais para o avatar (administrador)</summary>
      <p className="hint-l">Cada sinal é um excerto SiGML (HamNoSys) para a glosa. Só entra na app se "validado por" estiver preenchido, com o nome de uma pessoa surda ou de um intérprete que confirmou o sinal.</p>
      <input type="password" placeholder="Token de administrador" value={token} onChange={(e) => keep(e.target.value)} autoComplete="off" />
      <div className="row"><input placeholder="GLOSA (ex.: NOME)" value={gloss} onChange={(e) => setGloss(e.target.value)} />
        <select value={lang} onChange={(e) => setLang(e.target.value as 'LGA' | 'LGP')}><option value="LGA">LGA (Angola)</option><option value="LGP">LGP (Portugal)</option></select></div>
      <input placeholder="Validado por (nome)" value={by} onChange={(e) => setBy(e.target.value)} />
      <input placeholder="Crédito / origem (opcional)" value={credit} onChange={(e) => setCredit(e.target.value)} />
      <textarea rows={6} placeholder={'<hns_sign gloss="NOME"> ... </hns_sign>'} value={sigml} onChange={(e) => setSigml(e.target.value)} />
      <div className="row wrap">
        <button className="btn" onClick={save} disabled={!token || !gloss || !sigml}>Guardar</button>
        <button className="btn ghost" onClick={list} disabled={!token}>Listar</button>
        <button className="btn danger" onClick={() => confirm(`Apagar ${gloss} (${lang})?`) && del()} disabled={!token || !gloss}>Apagar</button>
      </div>
      {msg && <p className="hint-l">{msg}</p>}
      {rows.length > 0 && <ul className="adminlist">{rows.map((r, i) => <li key={i}>{r.gloss} · {r.language} · {r.validated_by ? 'validado' : 'rascunho'}</li>)}</ul>}
    </details>
  )
}
