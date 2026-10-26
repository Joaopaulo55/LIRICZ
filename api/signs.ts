// GET /api/signs?g=NOME,TEU -> só sinais VALIDADOS (validated_by preenchido). Público. LGA tem prioridade sobre LGP.
// (A gestão passou para /api/admin e o avatar usa /api/resolve; este endpoint fica por compatibilidade.)
import { json, getRows } from './_lib/db.js'
import { gkey, gfold, okGloss } from './_lib/gloss.js'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const glosses = [...new Set((q.get('g') || '').split(',').map(gkey).filter(okGloss))].slice(0, 40)
  if (!glosses.length) return json({ signs: {} })
  try {
    const rows = (await getRows(glosses, glosses.map(gfold))).filter((r) => r.validated_by)
    const signs: Record<string, { sigml: string; language: string; validatedBy: string }> = {}
    for (const g of glosses) {
      const m = rows.filter((r) => r.gloss === g || gfold(r.gloss) === gfold(g)).sort((a, b) => Number(b.language === 'LGA') - Number(a.language === 'LGA'))[0]
      if (m) signs[g] = { sigml: m.sigml, language: m.language, validatedBy: m.validated_by }
    }
    return json({ signs }, 200, { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=600' })
  } catch { return json({ signs: {}, error: 'base de dados indisponível' }, 503) }
}
