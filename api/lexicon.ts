// GET /api/lexicon?format=tsv  -> dicionário do painel no formato do PE2LGP (palavra \t lema \t glosa).
// Só o backend Python o pede (cabeçalho x-liricz-token = LGP_TOKEN). Não é público.
import { json, isBackend, db, init } from './_lib/db.js'
import { toTsv } from './_lib/lexparse.js'

export async function GET(req: Request) {
  if (!isBackend(req)) return json({ error: 'não autorizado' }, 401)
  try {
    await init()
    const r = await db().query(`SELECT phrase, lemma, gloss FROM lexicon WHERE enabled ORDER BY id`)
    return new Response(toTsv(r.rows), { headers: { 'content-type': 'text/tab-separated-values; charset=utf-8', 'cache-control': 'no-store' } })
  } catch { return json({ error: 'base de dados indisponível' }, 503) }
}
