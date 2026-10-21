// Vocabulário de sinais (SiGML) guardado em Postgres (Aiven).
// GET  /api/signs?g=NOME,TEU  -> só sinais VALIDADOS (validated_by preenchido). Público.
// GET  /api/signs?all=1       -> lista de gestão (sem SiGML). Precisa de x-admin-token.
// POST /api/signs             -> guarda ou apaga um sinal. Precisa de x-admin-token.
import pg from 'pg'
import { timingSafeEqual } from 'node:crypto'
declare const process: { env: Record<string, string | undefined> }

const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } })

let pool: pg.Pool | null = null
let ready: Promise<unknown> | null = null
function db(): pg.Pool {
  if (!pool) {
    const raw = process.env.DATABASE_URL
    if (!raw) throw new Error('DATABASE_URL em falta')
    const u = new URL(raw)
    u.searchParams.delete('sslmode') // o SSL é definido abaixo (o pg trataria o sslmode=require de forma mais rígida)
    const { Pool } = pg
    pool = new Pool({
      connectionString: u.toString(), max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000,
      ssl: process.env.PG_CA ? { ca: process.env.PG_CA, rejectUnauthorized: true } : { rejectUnauthorized: false },
    })
  }
  return pool
}
const init = () => (ready ??= db().query(`CREATE TABLE IF NOT EXISTS signs (
  gloss text NOT NULL,
  language text NOT NULL DEFAULT 'LGA' CHECK (language IN ('LGA','LGP')),
  sigml text NOT NULL,
  validated_by text NOT NULL DEFAULT '',
  credit text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gloss, language))`).catch((e) => { ready = null; throw e }))

const norm = (s: string) => s.trim().toUpperCase()
const okGloss = (s: string) => /^[\p{L}\p{N}_+\-.]{1,40}$/u.test(s)

function isAdmin(req: Request): boolean {
  const want = process.env.ADMIN_TOKEN || '', got = req.headers.get('x-admin-token') || ''
  if (want.length < 12) return false // sem token forte configurado, a gestão fica desligada
  const a = Buffer.from(want), b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  try {
    if (q.get('all')) {
      if (!isAdmin(req)) return json({ error: 'não autorizado' }, 401)
      await init()
      const r = await db().query(`SELECT gloss, language, validated_by, credit, updated_at, length(sigml) AS bytes FROM signs ORDER BY gloss, language`)
      return json({ rows: r.rows })
    }
    const glosses = [...new Set((q.get('g') || '').split(',').map(norm).filter(okGloss))].slice(0, 40)
    if (!glosses.length) return json({ signs: {} })
    await init()
    // Se existir o mesmo sinal em LGA e LGP, a LGA tem prioridade.
    const r = await db().query(
      `SELECT DISTINCT ON (gloss) gloss, language, sigml, validated_by FROM signs
       WHERE gloss = ANY($1) AND validated_by <> '' ORDER BY gloss, (language = 'LGA') DESC`, [glosses])
    const signs: Record<string, { sigml: string; language: string; validatedBy: string }> = {}
    for (const x of r.rows) signs[x.gloss] = { sigml: x.sigml, language: x.language, validatedBy: x.validated_by }
    return json({ signs }, 200, { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=600' })
  } catch { return json({ signs: {}, error: 'base de dados indisponível' }, 503) }
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin'), host = req.headers.get('host')
  if (origin && host && new URL(origin).host !== host) return json({ error: 'origem não permitida' }, 403)
  if (!isAdmin(req)) return json({ error: 'não autorizado' }, 401)
  let b: any
  try { b = await req.json() } catch { return json({ error: 'pedido inválido' }, 400) }
  const gloss = norm(String(b.gloss || '')), language = b.language === 'LGP' ? 'LGP' : 'LGA'
  if (!okGloss(gloss)) return json({ error: 'glosa inválida (letras, números, _ + - .; máx. 40)' }, 400)
  try {
    await init()
    if (b.action === 'delete') {
      await db().query('DELETE FROM signs WHERE gloss = $1 AND language = $2', [gloss, language])
      return json({ ok: true })
    }
    const sigml = String(b.sigml || '').trim(), validatedBy = String(b.validatedBy || '').trim().slice(0, 120), credit = String(b.credit || '').trim().slice(0, 200)
    if (!sigml.startsWith('<') || sigml.length > 60000) return json({ error: 'SiGML inválido (tem de ser XML, máx. 60 KB)' }, 400)
    if (/<!(DOCTYPE|ENTITY)/i.test(sigml)) return json({ error: 'SiGML não pode conter DOCTYPE/ENTITY' }, 400)
    await db().query(
      `INSERT INTO signs (gloss, language, sigml, validated_by, credit, updated_at) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (gloss, language) DO UPDATE SET sigml = EXCLUDED.sigml, validated_by = EXCLUDED.validated_by, credit = EXCLUDED.credit, updated_at = now()`,
      [gloss, language, sigml, validatedBy, credit])
    return json({ ok: true, published: validatedBy !== '' })
  } catch { return json({ error: 'base de dados indisponível' }, 503) }
}
