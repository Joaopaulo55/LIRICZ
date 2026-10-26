// Ligação ao Postgres (Aiven), esquema, definições, eventos e utilitários partilhados pelas funções da Vercel.
import pg from 'pg'
import { timingSafeEqual } from 'node:crypto'
import { gfold } from './gloss.js'
import { DEFAULT_SETTINGS, type Settings, type Row } from './resolve.js'
declare const process: { env: Record<string, string | undefined> }

export const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } })
export const sameOrigin = (req: Request) => {
  const origin = req.headers.get('origin'), host = req.headers.get('host')
  return !(origin && host && new URL(origin).host !== host)
}
const safeEq = (want: string, got: string) => {
  const a = Buffer.from(want), b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}
export function isAdmin(req: Request): boolean {
  const want = process.env.ADMIN_TOKEN || ''
  return want.length >= 12 && safeEq(want, req.headers.get('x-admin-token') || '') // sem token forte, a gestão fica desligada
}
export const isBackend = (req: Request) => {
  const want = process.env.LGP_TOKEN || ''
  return want.length >= 8 && safeEq(want, req.headers.get('x-liricz-token') || '')
}

let pool: pg.Pool | null = null
let ready: Promise<unknown> | null = null
export function db(): pg.Pool {
  if (!pool) {
    const raw = process.env.DATABASE_URL
    if (!raw) throw new Error('DATABASE_URL em falta')
    const u = new URL(raw)
    u.searchParams.delete('sslmode')
    const { Pool } = pg
    pool = new Pool({
      connectionString: u.toString(), max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000,
      ssl: process.env.PG_CA ? { ca: process.env.PG_CA, rejectUnauthorized: true } : { rejectUnauthorized: false },
    })
  }
  return pool
}

export const init = () => (ready ??= (async () => {
  const q = (s: string, p?: unknown[]) => db().query(s, p)
  await q(`CREATE TABLE IF NOT EXISTS signs (
    gloss text NOT NULL, language text NOT NULL DEFAULT 'LGA' CHECK (language IN ('LGA','LGP')),
    sigml text NOT NULL, validated_by text NOT NULL DEFAULT '', credit text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (gloss, language))`)
  await q(`ALTER TABLE signs ADD COLUMN IF NOT EXISTS gloss_fold text`)
  await q(`ALTER TABLE signs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'`)
  await q(`CREATE INDEX IF NOT EXISTS signs_fold_idx ON signs (gloss_fold)`)
  await q(`CREATE TABLE IF NOT EXISTS lexicon (
    id serial PRIMARY KEY, phrase text NOT NULL, lemma text NOT NULL, gloss text NOT NULL,
    lang text NOT NULL DEFAULT 'LGP', enabled boolean NOT NULL DEFAULT true, source text NOT NULL DEFAULT 'upload',
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (phrase, lemma, gloss))`)
  await q(`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL)`)
  await q(`CREATE TABLE IF NOT EXISTS events (id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}')`)
  await q(`CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts DESC)`)
  await q(`CREATE TABLE IF NOT EXISTS missing (gloss text PRIMARY KEY, hits int NOT NULL DEFAULT 1, last_seen timestamptz NOT NULL DEFAULT now(), sample text NOT NULL DEFAULT '')`)
  // migração: sinais antigos ainda sem chave "dobrada"
  const old = await q(`SELECT gloss, language FROM signs WHERE gloss_fold IS NULL LIMIT 5000`)
  for (const r of old.rows) await q(`UPDATE signs SET gloss_fold = $3 WHERE gloss = $1 AND language = $2`, [r.gloss, r.language, gfold(r.gloss)])
})().catch((e) => { ready = null; throw e }))

// ---- definições (cache curto por instância) ----
let sCache: { at: number; v: Settings } | null = null
export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && sCache && Date.now() - sCache.at < 20_000) return sCache.v
  await init()
  const r = await db().query(`SELECT key, value FROM settings`)
  const v: any = { ...DEFAULT_SETTINGS, nonmanual_map: { ...DEFAULT_SETTINGS.nonmanual_map }, pause_ms: { ...DEFAULT_SETTINGS.pause_ms } }
  for (const x of r.rows) if (x.key in DEFAULT_SETTINGS) v[x.key] = x.value
  sCache = { at: Date.now(), v }
  return v
}
export async function setSettings(patch: Record<string, unknown>): Promise<Settings> {
  await init()
  for (const [k, val] of Object.entries(patch)) if (k in DEFAULT_SETTINGS)
    await db().query(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(val)])
  sCache = null
  return getSettings(true)
}

// ---- eventos (monitorização) — nunca podem partir o pedido principal ----
export async function logEvent(kind: string, detail: Record<string, unknown> = {}) {
  try {
    await init()
    await db().query(`INSERT INTO events (kind, detail) VALUES ($1, $2::jsonb)`, [kind, JSON.stringify(detail).slice(0, 4000)])
    if (Math.random() < 0.02) await db().query(`DELETE FROM events WHERE ts < now() - interval '14 days'`)
  } catch { /* monitorização é best-effort */ }
}
export async function bumpMissing(glosses: string[], sample: string) {
  if (!glosses.length) return
  try {
    await init()
    await db().query(
      `INSERT INTO missing (gloss, sample) SELECT g, $2 FROM unnest($1::text[]) AS g
       ON CONFLICT (gloss) DO UPDATE SET hits = missing.hits + 1, last_seen = now(), sample = EXCLUDED.sample`, [glosses.slice(0, 80), sample.slice(0, 200)])
  } catch { /* idem */ }
}
export async function aiCallsToday(): Promise<number> {
  await init()
  const r = await db().query(`SELECT count(*)::int AS n FROM events WHERE kind IN ('ai_sign','ai_dictionary') AND ts >= date_trunc('day', now())`)
  return r.rows[0].n
}

export async function getRows(keys: string[], folds: string[]): Promise<Row[]> {
  await init()
  const r = await db().query(
    `SELECT gloss, language, sigml, validated_by, source FROM signs WHERE gloss = ANY($1) OR gloss_fold = ANY($2)`, [keys.slice(0, 600), folds.slice(0, 600)])
  return r.rows as Row[]
}
export async function upsertSign(s: { gloss: string; language: 'LGA' | 'LGP'; sigml: string; validatedBy?: string; credit?: string; source?: string }, keepIfValidated = false) {
  await init()
  const r = await db().query(
    `INSERT INTO signs (gloss, gloss_fold, language, sigml, validated_by, credit, source, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (gloss, language) DO UPDATE SET sigml = EXCLUDED.sigml, gloss_fold = EXCLUDED.gloss_fold, validated_by = EXCLUDED.validated_by,
       credit = EXCLUDED.credit, source = EXCLUDED.source, updated_at = now()
     ${keepIfValidated ? `WHERE signs.validated_by = ''` : ''} RETURNING gloss`,
    [s.gloss, gfold(s.gloss), s.language, s.sigml, s.validatedBy ?? '', s.credit ?? '', s.source ?? 'manual'])
  return (r.rowCount ?? 0) > 0
}
