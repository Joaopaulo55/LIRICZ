import { logEvent } from './_lib/db.js'
// Proxy Vercel -> backend PE2LGP. O token fica no servidor; o navegador nunca o vê.
declare const process: { env: Record<string, string | undefined> } // evita o erro TS2591 sem precisar de @types/node
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const base = () => (process.env.LGP_BACKEND_URL || '').replace(/\/$/, '')

// GET: acorda o backend do Render (arranque frio) sem esperar pelo carregamento completo.
export async function GET() {
  if (!base()) return json({ configured: false })
  try {
    const r = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return json({ status: 'waking', upstream: r.status })
    return json(await r.json())
  } catch { return json({ status: 'waking' }) }
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin'), host = req.headers.get('host')
  if (origin && host && new URL(origin).host !== host) return json({ error: 'origem não permitida' }, 403)
  if (!base() || !process.env.LGP_TOKEN) return json({ error: 'backend LGP não configurado' }, 503)
  let b: any
  try { b = await req.json() } catch { return json({ error: 'pedido inválido' }, 400) }
  const text = String(b.text || '').trim().slice(0, 300)
  if (!text) return json({ error: 'texto vazio' }, 400)
  const t0 = Date.now()
  try {
    const r = await fetch(`${base()}/translate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-liricz-token': process.env.LGP_TOKEN }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(55000) })
    const raw = await r.text()
    let parsed: any = null
    try { parsed = JSON.parse(raw) } catch {
      // Resposta que não é JSON = página de erro do Render (502/503/504): o servidor está a acordar, a reiniciar ou ficou sem memória.
      await logEvent('translate_fail', { status: r.status, ms: Date.now() - t0, reason: 'resposta não JSON' })
      return json({ error: `O servidor LGP não está pronto (${r.status}). Está a acordar ou a reiniciar; tenta de novo daqui a pouco.`, upstream: r.status }, 503)
    }
    await logEvent(r.ok ? 'translate' : 'translate_fail', { status: r.status, ms: Date.now() - t0, n: parsed?.glosses?.length ?? 0, fallback: !!parsed?.fallback, error: parsed?.error })
    return new Response(raw, { status: r.status, headers: { 'content-type': 'application/json' } })
  } catch {
    await logEvent('translate_fail', { status: 0, ms: Date.now() - t0, reason: 'sem resposta' })
    return json({ error: 'O backend LGP não respondeu (pode estar a acordar). Tenta de novo.' }, 504)
  }
}
