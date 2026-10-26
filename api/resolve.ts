// POST /api/resolve  { glosses: string[], extra?: {...} } -> sinais SiGML prontos a tocar (sinal, soletrado, número, IA, em falta).
// Público (usado pelo avatar). A IA em tempo real só corre se o painel a ligar (ai_mode = realtime) e dentro do limite diário.
import { json, sameOrigin, getSettings, getRows, upsertSign, logEvent, bumpMissing, aiCallsToday } from './_lib/db.js'
import { resolveGlosses, type Deps } from './_lib/resolve.js'
import { aiSignSpec, aiSigml } from './_lib/aisign.js'
import { geminiConfigured } from './_lib/gemini.js'

const noAi = new Set<string>() // palavras que a IA já disse serem para soletrar (nomes próprios...): não repetir a chamada

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'origem não permitida' }, 403)
  let b: any
  try { b = await req.json() } catch { return json({ error: 'pedido inválido' }, 400) }
  const glosses = (Array.isArray(b.glosses) ? b.glosses : []).map((g: unknown) => String(g).slice(0, 60)).slice(0, 80)
  if (!glosses.length) return json({ error: 'sem glosas' }, 400)
  const extra = b.extra && typeof b.extra === 'object' ? b.extra : {}
  try {
    const st = await getSettings()
    let budget = 0
    if (st.ai_mode === 'realtime' && geminiConfigured()) budget = Math.max(0, st.ai_daily_cap - (await aiCallsToday()))
    const deps: Deps = {
      getRows,
      ai: budget > 0 ? async (g) => {
        if (noAi.has(g) || budget <= 0) return null
        budget--
        try {
          const r = await aiSignSpec(g, { language: 'LGA', model: st.ai_model })
          await logEvent('ai_sign', { gloss: g, mode: r.mode, via: 'tempo-real' })
          if (r.mode === 'spell') { noAi.add(g); return null }
          const sigml = aiSigml(g, r.spec)
          await upsertSign({ gloss: g, language: 'LGA', sigml, source: 'ai' }, true) // rascunho: nunca apaga um sinal validado
          return { sigml, language: 'LGA' }
        } catch (e) { await logEvent('ai_fail', { gloss: g, error: (e as Error).message }); return null }
      } : undefined,
    }
    const t0 = Date.now()
    const out = await resolveGlosses(glosses, extra, st, deps)
    const count = (k: string) => out.units.filter((u) => u.kind === k).length
    await Promise.all([
      bumpMissing(out.needSign, glosses.join(' ')),
      logEvent('resolve', { n: out.units.length, sign: count('sign') + count('compound'), spell: count('spell'), number: count('number'), ai: count('ai'), missing: count('missing'), ms: Date.now() - t0 }),
    ])
    return json({ units: out.units, segments: out.segments, provisional: out.units.some((u) => u.provisional) }, 200, { 'cache-control': 'no-store' })
  } catch (e) {
    await logEvent('resolve_fail', { error: (e as Error).message })
    return json({ error: 'base de dados indisponível' }, 503)
  }
}
