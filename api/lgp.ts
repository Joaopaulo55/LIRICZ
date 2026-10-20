// Proxy Vercel -> backend PE2LGP. O token fica no servidor; o navegador nunca o vê.
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const base = () => (process.env.LGP_BACKEND_URL || '').replace(/\/$/, '')

// GET: acorda o backend do Render (arranque frio) sem esperar pelo carregamento completo.
export async function GET() {
  if (!base()) return json({ configured: false })
  try { return json(await (await fetch(`${base()}/health`, { signal: AbortSignal.timeout(8000) })).json()) }
  catch { return json({ status: 'waking' }) }
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin'), host = req.headers.get('host')
  if (origin && host && new URL(origin).host !== host) return json({ error: 'origem não permitida' }, 403)
  if (!base() || !process.env.LGP_TOKEN) return json({ error: 'backend LGP não configurado' }, 503)
  let b: any
  try { b = await req.json() } catch { return json({ error: 'pedido inválido' }, 400) }
  const text = String(b.text || '').trim().slice(0, 300)
  if (!text) return json({ error: 'texto vazio' }, 400)
  try {
    const r = await fetch(`${base()}/translate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-liricz-token': process.env.LGP_TOKEN }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(55000) })
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } })
  } catch { return json({ error: 'O backend LGP não respondeu (pode estar a acordar). Tenta de novo.' }, 504) }
}
