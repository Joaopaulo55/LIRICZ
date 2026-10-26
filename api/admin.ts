// POST /api/admin { action, ... }  — tudo o que o painel faz. Exige x-admin-token (ADMIN_TOKEN, mín. 12 caracteres).
import { json, sameOrigin, isAdmin, db, init, getSettings, setSettings, logEvent, upsertSign, getRows, aiCallsToday, setSecret, delSecret } from './_lib/db.js'
import { gkey, gfold, okGloss, isNumeric, letterKeys, ALPHABET_KEYS } from './_lib/gloss.js'
import { SEED_GLOSSES } from './_lib/seed.js'
import { VOCAB, DEFAULT_SPECS, validateSpec, specToSign, wrapSigml, checkSigml, splitSigns, defaultLetterSign } from './_lib/sigml.js'
import { aiSignSpec, aiSignSpecs, aiSigml, aiDictionary } from './_lib/aisign.js'
import { geminiConfigured, geminiKey, geminiJson, textModels, forgetGeminiKey } from './_lib/gemini.js'
import { resolveGlosses } from './_lib/resolve.js'
import { parseLexicon, toTsv } from './_lib/lexparse.js'
declare const process: { env: Record<string, string | undefined> }

const backendUrl = () => (process.env.LGP_BACKEND_URL || '').replace(/\/$/, '')
const q = (s: string, p?: unknown[]) => db().query(s, p)
const lang = (v: unknown): 'LGA' | 'LGP' => (v === 'LGP' ? 'LGP' : 'LGA')
const need = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg) }

async function backend(path: string, init2: RequestInit = {}, ms = 55000) {
  need(backendUrl() && process.env.LGP_TOKEN, 'backend LGP não configurado (LGP_BACKEND_URL / LGP_TOKEN)')
  const r = await fetch(backendUrl() + path, { ...init2, headers: { 'content-type': 'application/json', 'x-liricz-token': process.env.LGP_TOKEN!, ...(init2.headers as object) }, signal: AbortSignal.timeout(ms) })
  const t = await r.text()
  let d: any; try { d = JSON.parse(t) } catch { throw new Error(`o backend respondeu ${r.status} (não JSON; pode estar a acordar)`) }
  return { ok: r.ok, status: r.status, data: d }
}
async function capCheck(n: number) {
  need(await geminiConfigured(), 'falta a chave do Gemini: junta-a em Configuração')
  const st = await getSettings()
  need((await aiCallsToday()) + n <= st.ai_daily_cap, `limite diário de IA atingido (${st.ai_daily_cap}); aumenta-o na Configuração`)
  return st
}
const saveSign = (gloss: string, language: 'LGA' | 'LGP', sigml: string, o: { validatedBy?: string; credit?: string; source?: string; keep?: boolean } = {}) =>
  upsertSign({ gloss, language, sigml, validatedBy: o.validatedBy, credit: o.credit, source: o.source }, o.keep ?? false)

async function bulkUpsert(items: { g: string; s: string }[], language: 'LGA' | 'LGP', validatedBy: string, credit: string, source: string, overwrite: boolean) {
  let done = 0
  for (let i = 0; i < items.length; i += 400) {
    const part = items.slice(i, i + 400)
    const r = await q(
      `INSERT INTO signs (gloss, gloss_fold, language, sigml, validated_by, credit, source, updated_at)
       SELECT t.g, t.f, $4, t.s, $5, $6, $7, now() FROM unnest($1::text[], $2::text[], $3::text[]) AS t(g, f, s)
       ON CONFLICT (gloss, language) DO UPDATE SET sigml = EXCLUDED.sigml, gloss_fold = EXCLUDED.gloss_fold, validated_by = EXCLUDED.validated_by,
         credit = EXCLUDED.credit, source = EXCLUDED.source, updated_at = now() ${overwrite ? '' : `WHERE signs.validated_by = ''`}`,
      [part.map((x) => x.g), part.map((x) => gfold(x.g)), part.map((x) => x.s), language, validatedBy, credit, source])
    done += r.rowCount ?? 0
  }
  return done
}


// glosas candidatas à conversão: normalizadas, válidas, únicas (por forma "dobrada")
function candidates(xs: string[]): string[] {
  const seen = new Set<string>(), out: string[] = []
  for (const x of xs) { const g = gkey(String(x)); if (okGloss(g) && !seen.has(gfold(g))) { seen.add(gfold(g)); out.push(g) } }
  return out
}
const haveSigns = async (language: 'LGA' | 'LGP') => new Set((await q(`SELECT gloss, gloss_fold FROM signs WHERE language = $1`, [language])).rows.map((r) => String(r.gloss_fold || gfold(r.gloss))))
let bgCache: { at: number; list: string[] } | null = null
// glosas que o backend (Render) conhece; nunca rebenta: devolve o estado para o painel o mostrar
async function backendGlosses(): Promise<{ list: string[]; state: string }> {
  if (!backendUrl() || !process.env.LGP_TOKEN) return { list: [], state: 'não configurado (LGP_BACKEND_URL / LGP_TOKEN)' }
  if (bgCache && Date.now() - bgCache.at < 120_000) return { list: bgCache.list, state: 'ok' }
  try {
    const r = await fetch(backendUrl() + '/glosses', { headers: { 'x-liricz-token': process.env.LGP_TOKEN! }, signal: AbortSignal.timeout(25000) })
    if (r.status === 404) return { list: [], state: 'o backend ainda não tem /glosses: publica a versão nova do backend' }
    if (r.status === 503) return { list: [], state: 'o backend está a acordar ou a carregar; tenta daqui a 1 minuto' }
    if (!r.ok) return { list: [], state: `o backend respondeu ${r.status}` }
    const d: any = await r.json()
    const list = Array.isArray(d.glosses) ? d.glosses.map(String) : []
    bgCache = { at: Date.now(), list }
    return { list, state: 'ok' }
  } catch { return { list: [], state: 'o backend não respondeu (pode estar a acordar)' } }
}
const lexGlosses = async (language: 'LGA' | 'LGP') => (await q(`SELECT DISTINCT gloss FROM lexicon WHERE enabled AND lang = $1`, [language])).rows.map((r) => r.gloss as string)

const H: Record<string, (b: any) => Promise<unknown>> = {
  async vocab() {
    return { vocab: VOCAB, defaults: Object.keys(DEFAULT_SPECS), alphabet: ALPHABET_KEYS, gemini: await geminiConfigured() }
  },

  // ---------- monitorização ----------
  async overview() {
    const [signs, lex, miss, ev, recent, lat, ai] = await Promise.all([
      q(`SELECT language, (validated_by <> '') AS validated, source, count(*)::int AS n FROM signs GROUP BY 1,2,3`),
      q(`SELECT count(*)::int AS total, (count(*) FILTER (WHERE enabled))::int AS enabled FROM lexicon`),
      q(`SELECT count(*)::int AS n, coalesce(sum(hits),0)::int AS hits FROM missing`),
      q(`SELECT kind, count(*)::int AS n FROM events WHERE ts > now() - interval '24 hours' GROUP BY kind ORDER BY n DESC`),
      q(`SELECT id, ts, kind, detail FROM events ORDER BY id DESC LIMIT 40`),
      q(`SELECT coalesce(avg((detail->>'ms')::int),0)::int AS ms FROM events WHERE kind = 'translate' AND ts > now() - interval '24 hours'`),
      aiCallsToday(),
    ])
    let health: unknown = { configured: false }
    if (backendUrl()) { try { health = await (await fetch(backendUrl() + '/health', { signal: AbortSignal.timeout(8000) })).json() } catch { health = { status: 'waking' } } }
    const st = await getSettings(true)
    return {
      signs: signs.rows, lexicon: lex.rows[0], missing: miss.rows[0], events24h: ev.rows, recent: recent.rows, translateMs: lat.rows[0].ms,
      aiToday: ai, aiCap: st.ai_daily_cap, backend: health,
      env: { database: true, gemini: await geminiConfigured(), backend: !!backendUrl(), lgpToken: !!process.env.LGP_TOKEN },
    }
  },
  async events(b) {
    const kind = String(b.kind || '')
    const r = kind ? await q(`SELECT id, ts, kind, detail FROM events WHERE kind = $1 ORDER BY id DESC LIMIT 100`, [kind]) : await q(`SELECT id, ts, kind, detail FROM events ORDER BY id DESC LIMIT 100`)
    return { rows: r.rows }
  },

  // ---------- definições ----------
  async settings_get() { return { settings: await getSettings(true) } },
  async settings_set(b) {
    const p = b.patch ?? {}, out: Record<string, unknown> = {}
    const num = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)))
    if ('ai_mode' in p) { need(['off', 'assist', 'realtime'].includes(p.ai_mode), 'ai_mode inválido'); out.ai_mode = p.ai_mode }
    if ('unknown_policy' in p) { need(['spell', 'skip'].includes(p.unknown_policy), 'unknown_policy inválido'); out.unknown_policy = p.unknown_policy }
    for (const k of ['show_provisional', 'nonmanual_on']) if (k in p) out[k] = !!p[k]
    if ('ai_daily_cap' in p) out.ai_daily_cap = num(p.ai_daily_cap, 0, 5000)
    if ('ai_per_request' in p) out.ai_per_request = num(p.ai_per_request, 0, 10)
    if ('ai_model' in p) { need(/^[\w.,\- ]{0,120}$/.test(String(p.ai_model)), 'modelo inválido'); out.ai_model = String(p.ai_model).trim() }
    if ('pause_ms' in p) out.pause_ms = { oracao: num(p.pause_ms?.oracao, 0, 5000), frase: num(p.pause_ms?.frase, 0, 5000) }
    if ('nonmanual_map' in p) {
      const m: Record<string, string> = {}
      for (const [k, v] of Object.entries(p.nonmanual_map ?? {})) {
        need(/^[\w-]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 400, `expressão inválida: ${k}`)
        need(!v || checkSigml(`<hns_sign gloss="x">${v}</hns_sign>`).ok, `fragmento mal formado em "${k}"`)
        m[k] = v as string
      }
      out.nonmanual_map = m
    }
    return { settings: await setSettings(out) }
  },

  // ---------- fila de glosas sem sinal ----------
  async missing_list() { return { rows: (await q(`SELECT gloss, hits, last_seen, sample FROM missing ORDER BY hits DESC, last_seen DESC LIMIT 300`)).rows } },
  async missing_clear(b) {
    if (b.all) await q(`DELETE FROM missing`); else await q(`DELETE FROM missing WHERE gloss = $1`, [gkey(String(b.gloss || ''))])
    return { ok: true }
  },

  // ---------- sinais ----------
  async signs_list(b) {
    const w: string[] = [], p: unknown[] = []
    // TODOS os "?" têm de ser trocados (antes só o 1.º: dava "syntax error at or near )" ao procurar)
    const add = (cond: string, v: unknown) => { p.push(v); w.push(cond.split('?').join('$' + p.length)) }
    if (b.q) add(`(gloss ILIKE ? OR gloss_fold ILIKE ?)`, '%' + String(b.q).replace(/[%_]/g, '') + '%')
    if (b.language === 'LGA' || b.language === 'LGP') add(`language = ?`, b.language)
    if (b.status === 'validated') w.push(`validated_by <> ''`); else if (b.status === 'draft') w.push(`validated_by = ''`)
    if (b.source) add(`source = ?`, String(b.source))
    const where = w.length ? 'WHERE ' + w.join(' AND ') : ''
    const limit = Math.min(300, Math.max(1, Number(b.limit) || 100)), offset = Math.max(0, Number(b.offset) || 0)
    const rows = await q(`SELECT gloss, language, validated_by, credit, source, updated_at, length(sigml) AS bytes FROM signs ${where} ORDER BY gloss, language LIMIT ${limit} OFFSET ${offset}`, p)
    const total = await q(`SELECT count(*)::int AS n FROM signs ${where}`, p)
    return { rows: rows.rows, total: total.rows[0].n }
  },
  async signs_get(b) {
    const r = await q(`SELECT gloss, language, sigml, validated_by, credit, source FROM signs WHERE gloss = $1 AND language = $2`, [gkey(String(b.gloss || '')), lang(b.language)])
    need(r.rows[0], 'sinal não encontrado')
    return { sign: r.rows[0] }
  },
  async sign_save(b) {
    const gloss = gkey(String(b.gloss || '')), language = lang(b.language), sigml = String(b.sigml || '').trim()
    need(okGloss(gloss), 'glosa inválida (letras, números, _ + - . #; máx. 60)')
    need(sigml.length <= 60000, 'SiGML demasiado grande (máx. 60 KB)')
    const c = checkSigml(sigml); need(c.ok, 'SiGML inválido: ' + c.error)
    const validatedBy = String(b.validatedBy || '').trim().slice(0, 120)
    await saveSign(gloss, language, sigml, { validatedBy, credit: String(b.credit || '').slice(0, 200), source: String(b.source || 'manual').slice(0, 20) })
    await logEvent('admin', { act: 'sign_save', gloss, language, published: !!validatedBy })
    return { ok: true, gloss, published: !!validatedBy }
  },
  async sign_delete(b) { await q(`DELETE FROM signs WHERE gloss = $1 AND language = $2`, [gkey(String(b.gloss || '')), lang(b.language)]); return { ok: true } },
  async sign_validate(b) {
    const by = String(b.validatedBy || '').trim().slice(0, 120)
    need(by.length >= 2, 'indica quem validou o sinal (pessoa surda, intérprete ou associação)')
    const r = await q(`UPDATE signs SET validated_by = $3, credit = CASE WHEN $4 <> '' THEN $4 ELSE credit END, updated_at = now() WHERE gloss = $1 AND language = $2`,
      [gkey(String(b.gloss || '')), lang(b.language), by, String(b.credit || '').slice(0, 200)])
    need(r.rowCount, 'sinal não encontrado')
    await logEvent('admin', { act: 'sign_validate', gloss: b.gloss, by })
    return { ok: true }
  },
  async sign_copy(b) { // ex.: partir de um sinal LGP para criar a variante LGA como rascunho
    const from = lang(b.from), to = lang(b.to), gloss = gkey(String(b.gloss || ''))
    need(from !== to, 'origem e destino iguais')
    const r = await q(`SELECT sigml FROM signs WHERE gloss = $1 AND language = $2`, [gloss, from]); need(r.rows[0], 'sinal de origem não existe')
    await saveSign(gloss, to, r.rows[0].sigml, { source: 'copy', keep: true })
    return { ok: true }
  },
  async sigml_check(b) { return checkSigml(String(b.sigml || '')) },
  async build_sigml(b) {
    const spec = validateSpec(b.spec); need(spec, 'escolhe pelo menos a configuração da mão')
    return { spec, sigml: wrapSigml(specToSign(gkey(String(b.gloss || 'SINAL')) || 'SINAL', spec!)) }
  },
  async sigml_import(b) {
    const language = lang(b.language), validatedBy = String(b.validatedBy || '').trim().slice(0, 120)
    const items: { g: string; s: string }[] = [], bad: string[] = []
    for (const s of splitSigns(String(b.text || ''))) {
      const g = gkey(s.gloss)
      if (!okGloss(g) || !checkSigml(wrapSigml(s.xml)).ok || s.xml.length > 60000) { if (bad.length < 20) bad.push(s.gloss || '(sem gloss)'); continue }
      items.push({ g, s: wrapSigml(s.xml) })
    }
    const imported = items.length ? await bulkUpsert(items, language, validatedBy, String(b.credit || '').slice(0, 200), 'import', !!b.overwrite) : 0
    await logEvent('admin', { act: 'sigml_import', language, found: items.length, imported })
    return { found: items.length, imported, skipped: items.length - imported, bad }
  },
  async rule_fill(b) { // alfabeto/dígitos por regras (sem IA)
    const keys = b.what === 'digits' ? ALPHABET_KEYS.filter((k) => /\d/.test(k)) : b.what === 'letters' ? ALPHABET_KEYS.filter((k) => /[A-Z]/.test(k)) : ALPHABET_KEYS
    const items = keys.map((k) => ({ g: k, s: wrapSigml(specToSign(k, DEFAULT_SPECS[k])) }))
    const n = await bulkUpsert(items, lang(b.language), '', '', 'rule', !!b.overwrite)
    await logEvent('admin', { act: 'rule_fill', what: b.what || 'all', written: n })
    return { written: n, total: items.length }
  },

  // ---------- IA ----------
  async ai_test() {
    need(await geminiConfigured(), 'falta a chave do Gemini: junta-a em Configuração')
    const st = await getSettings(), t0 = Date.now()
    const r = await geminiJson('Responde só com JSON.', 'Devolve {"ok":true}', st.ai_model)
    return { ok: r?.ok === true, ms: Date.now() - t0, models: await textModels(st.ai_model) }
  },
  async ai_sign(b) {
    const gloss = gkey(String(b.gloss || '')); need(okGloss(gloss), 'glosa inválida')
    const st = await capCheck(1)
    const r = await aiSignSpec(gloss, { hint: String(b.hint || '').slice(0, 400), language: lang(b.language), model: st.ai_model })
    await logEvent('ai_sign', { gloss, mode: r.mode, via: 'painel' })
    if (r.mode === 'spell') return { mode: 'spell', note: 'A IA indica que isto se soletra (nome próprio/sigla). Já é tratado por dactilologia.' }
    const sigml = aiSigml(gloss, r.spec)
    let saved = false
    if (b.save) saved = await saveSign(gloss, lang(b.language), sigml, { source: 'ai', keep: true })
    return { mode: 'sign', spec: r.spec, sigml, saved }
  },
  async ai_batch(b) {
    const list = [...new Set((Array.isArray(b.glosses) ? b.glosses : []).map((g: unknown) => gkey(String(g))).filter(okGloss))].slice(0, 8) as string[]
    need(list.length, 'sem glosas válidas')
    const st = await capCheck(list.length), language = lang(b.language), out: { gloss: string; status: string; error?: string }[] = []
    let i = 0
    await Promise.all([0, 1, 2].map(async () => {
      while (i < list.length) {
        const gloss = list[i++]
        try {
          const r = await aiSignSpec(gloss, { hint: String(b.hint || '').slice(0, 400), language, model: st.ai_model })
          await logEvent('ai_sign', { gloss, mode: r.mode, via: 'lote' })
          if (r.mode === 'spell') { out.push({ gloss, status: 'soletrar' }); continue }
          const ok = await saveSign(gloss, language, aiSigml(gloss, r.spec), { source: 'ai', keep: true })
          if (ok) await q(`DELETE FROM missing WHERE gloss = $1`, [gloss])
          out.push({ gloss, status: ok ? 'guardado' : 'já validado' })
        } catch (e) { await logEvent('ai_fail', { gloss, error: (e as Error).message }); out.push({ gloss, status: 'erro', error: (e as Error).message }) }
      }
    }))
    return { results: out }
  },
  async ai_dictionary(b) {
    const words = [...new Set(String(b.words || '').split(/[\n,;]+/).map((w) => w.trim().toLowerCase()).filter((w) => w && w.length <= 40))].slice(0, 60)
    need(words.length, 'sem palavras')
    const st = await capCheck(1)
    const entries = await aiDictionary(words, st.ai_model)
    await logEvent('ai_dictionary', { words: words.length, entries: entries.length })
    let inserted = 0
    if (b.save !== false && entries.length) {
      const r = await q(`INSERT INTO lexicon (phrase, lemma, gloss, lang, source) SELECT t.a, t.b, t.c, 'LGP', 'ai' FROM unnest($1::text[], $2::text[], $3::text[]) AS t(a,b,c)
        ON CONFLICT DO NOTHING`, [entries.map((e) => e.word), entries.map((e) => e.lemma), entries.map((e) => e.gloss)])
      inserted = r.rowCount ?? 0
    }
    return { entries, inserted }
  },

  // ---------- chave e modelo do Gemini (guardados no painel) ----------
  async gemini_status(b) {
    if (b.refresh) forgetGeminiKey()
    const { key, from } = await geminiKey(), st = await getSettings()
    return { configured: !!key, from, hint: key ? '••••' + key.slice(-4) : '', models: key ? await textModels(st.ai_model) : [], auto: !st.ai_model && !process.env.GEMINI_TEXT_MODEL }
  },
  async gemini_key_set(b) {
    const key = String(b.key || '').trim()
    need(/^[\w-]{20,200}$/.test(key), 'chave com formato estranho (começa normalmente por AIza e não tem espaços)')
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000) }).catch(() => null)
    need(r, 'não consegui falar com a Google para validar a chave')
    need(r!.ok, `a Google recusou esta chave (${r!.status}). Cria outra em aistudio.google.com/apikey`)
    need((process.env.ADMIN_TOKEN || '').length >= 12, 'ADMIN_TOKEN em falta no servidor')
    await setSecret('gemini_key', key); forgetGeminiKey()
    await logEvent('admin', { act: 'gemini_key_set' })
    return H.gemini_status({})
  },
  async gemini_key_clear() { await delSecret('gemini_key'); forgetGeminiKey(); await logEvent('admin', { act: 'gemini_key_clear' }); return H.gemini_status({}) },

  // ---------- glosas conhecidas (dicionário + incluído + fila + backend + sinais) ----------
  async gloss_list(b) {
    const language = lang(b.language ?? 'LGP')
    const map = new Map<string, { gloss: string; sources: Set<string>; signs: Record<string, { state: string; gloss: string }> }>()
    const add = (g: unknown, src: string) => {
      const k = gkey(String(g ?? '')); if (!okGloss(k)) return
      const f = gfold(k); let e = map.get(f); if (!e) { e = { gloss: k, sources: new Set(), signs: {} }; map.set(f, e) }
      e.sources.add(src); return e
    }
    for (const x of await lexGlosses('LGP')) add(x, 'dicionário')
    for (const x of await lexGlosses('LGA')) add(x, 'dicionário')
    for (const x of SEED_GLOSSES) add(x, 'incluído')
    for (const r of (await q(`SELECT gloss FROM missing`)).rows) add(r.gloss, 'fila')
    let backend = 'não pedido'
    if (b.backend !== false) { const bg = await backendGlosses(); backend = bg.state; for (const x of bg.list) add(x, 'backend') }
    for (const r of (await q(`SELECT gloss, gloss_fold, language, validated_by FROM signs`)).rows) {
      const e = add(r.gloss, 'sinal'); if (e) e.signs[r.language] = { state: r.validated_by ? 'validado' : 'rascunho', gloss: r.gloss }
    }
    const needle = gfold(String(b.q || '')).replace(/_/g, '')
    let rows = [...map.entries()].filter(([f]) => !needle || f.replace(/_/g, '').includes(needle)).map(([, e]) => ({ gloss: e.gloss, sources: [...e.sources].filter((x) => x !== 'sinal'), signs: e.signs }))
    if (b.status === 'sem') rows = rows.filter((r) => !r.signs[language])
    else if (b.status === 'com') rows = rows.filter((r) => r.signs[language])
    rows.sort((a, z) => a.gloss.localeCompare(z.gloss))
    const limit = Math.min(200, Math.max(1, Number(b.limit) || 100)), offset = Math.max(0, Number(b.offset) || 0)
    return { rows: rows.slice(offset, offset + limit), total: rows.length, backend }
  },

  // ---------- converter glosas já existentes em SiGML (1 clique) ----------
  async gloss_sources(b) {
    const language = lang(b.language ?? 'LGP')
    const have = await haveSigns(language)
    const [lex, miss] = await Promise.all([lexGlosses(language), q(`SELECT gloss FROM missing`)])
    const pend = (xs: string[]) => new Set(candidates(xs).filter((g) => !have.has(gfold(g)))).size
    return {
      lexicon: { total: candidates(lex).length, pending: pend(lex) },
      seed: { total: candidates(SEED_GLOSSES).length, pending: pend(SEED_GLOSSES) },
      missing: { total: candidates(miss.rows.map((r) => r.gloss)).length, pending: pend(miss.rows.map((r) => r.gloss)) },
      signs: have.size,
    }
  },
  async gloss_convert(b) {
    const language = lang(b.language ?? 'LGP'), src = b.sources ?? {}
    let pool: string[] = String(b.paste || '').split(/[\n,;]+/)
    if (src.lexicon) pool = pool.concat(await lexGlosses(language))
    if (src.seed) pool = pool.concat(SEED_GLOSSES)
    if (src.backend) pool = pool.concat((await backendGlosses()).list)
    if (src.missing) pool = pool.concat((await q(`SELECT gloss FROM missing`)).rows.map((r) => r.gloss))
    const have = await haveSigns(language), skip = new Set((Array.isArray(b.skip) ? b.skip : []).map((g: unknown) => gkey(String(g))))
    // palavras simples primeiro: assim as compostas já encontram as partes feitas
    const pending = candidates(pool).filter((g) => !have.has(gfold(g)) && !skip.has(g)).sort((a, z) => Number(/[_-]/.test(a)) - Number(/[_-]/.test(z)) || a.localeCompare(z))
    const results: { gloss: string; status: string }[] = []
    const done = (gloss: string, status: string) => results.push({ gloss, status })
    const save = async (gloss: string, sigml: string, source: string) => (await saveSign(gloss, language, sigml, { source, keep: true })) ? true : false
    const lookup = async (keys: string[]) => new Map((await getRows(keys, keys.map(gfold))).filter((r) => splitSigns(r.sigml).length).sort((a, z) => Number(!!z.validated_by) - Number(!!a.validated_by)).map((r) => [gfold(r.gloss), r] as const).reverse())
    const batch = pending.slice(0, 40), needAi: string[] = []
    const letters = await lookup([...new Set(batch.flatMap(letterKeys))])
    const spellXml = (g: string) => letterKeys(g).map((k) => { const r = letters.get(gfold(k)); return r ? splitSigns(r.sigml)[0]?.xml : defaultLetterSign(k) }).filter(Boolean) as string[]
    const spelled = async (g: string) => { const x = spellXml(g); if (!x.length) { done(g, 'sem letras para soletrar'); return }; done(g, (await save(g, wrapSigml(x.join('')), 'spell')) ? 'soletrada (rascunho)' : 'ignorada'); }
    for (const g of batch) {
      if (isNumeric(g) || /^#/.test(g)) { done(g, 'já tratado por regra (números/letras)'); continue }
      const parts = g.split(/[_-]/).filter(Boolean)
      if (parts.length > 1) {   // composta: junta os sinais das partes se todas existirem
        const rows = await lookup(parts), xs = parts.map((p) => rows.get(gfold(p))).map((r) => (r ? splitSigns(r.sigml).map((x) => x.xml) : []))
        if (xs.every((x) => x.length)) { done(g, (await save(g, wrapSigml(xs.flat().join('')), 'rule')) ? 'juntada das partes (regras)' : 'ignorada'); continue }
      }
      if (b.ai) { if (needAi.length < 10) needAi.push(g); continue }
      if (b.spell) { await spelled(g); continue }
      done(g, 'sem regra (liga a IA ou a soletração)')
    }
    let stopped = ''
    if (needAi.length) {
      try {
        const st = await capCheck(1)
        const specs = await aiSignSpecs(needAi.map((g) => g.replace(/[_-]/g, ' ')), { language, model: st.ai_model })
        await logEvent('ai_sign', { via: 'conversao', glosses: needAi.length })
        for (const g of needAi) {
          const r = specs.get(gkey(g.replace(/[_-]/g, ' '))) ?? specs.get(g)
          if (r?.mode === 'sign') { const ok = await save(g, aiSigml(g, r.spec), 'ai'); if (ok) await q(`DELETE FROM missing WHERE gloss = $1`, [g]); done(g, ok ? 'guardada (IA, rascunho)' : 'ignorada') }
          else if (r?.mode === 'spell' && b.spell) await spelled(g)
          else done(g, r?.mode === 'spell' ? 'a IA diz que se soletra' : 'a IA não respondeu a esta glosa')
        }
      } catch (e) { stopped = (e as Error).message }
    }
    const handled = new Set(results.map((r) => r.gloss))
    return { results, remaining: pending.length - handled.size, stopped }
  },

  // ---------- dicionário ----------
  async lex_list(b) {
    const p: unknown[] = [], w: string[] = []
    if (b.q) { p.push('%' + String(b.q).replace(/[%_]/g, '').toLowerCase() + '%'); w.push(`(phrase LIKE $1 OR lemma LIKE $1 OR gloss LIKE $1)`) }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : ''
    const limit = Math.min(300, Math.max(1, Number(b.limit) || 100)), offset = Math.max(0, Number(b.offset) || 0)
    const rows = await q(`SELECT id, phrase, lemma, gloss, lang, enabled, source FROM lexicon ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, p)
    const tot = await q(`SELECT count(*)::int AS n FROM lexicon ${where}`, p)
    return { rows: rows.rows, total: tot.rows[0].n }
  },
  async lex_import(b) {
    const { rows, invalid, samples } = parseLexicon(String(b.text || ''))
    need(rows.length, 'não encontrei nenhuma linha válida (formato: palavra, lema, glosa separados por TAB, ; ou ,)')
    if (b.mode === 'replace') await q(`DELETE FROM lexicon`)
    let inserted = 0
    for (let i = 0; i < rows.length; i += 1000) {
      const part = rows.slice(i, i + 1000)
      const r = await q(`INSERT INTO lexicon (phrase, lemma, gloss, lang, source) SELECT t.a, t.b, t.c, $4, $5 FROM unnest($1::text[], $2::text[], $3::text[]) AS t(a,b,c) ON CONFLICT DO NOTHING`,
        [part.map((x) => x.phrase), part.map((x) => x.lemma), part.map((x) => x.gloss), lang(b.lang) === 'LGA' ? 'LGA' : 'LGP', String(b.source || 'upload').slice(0, 20)])
      inserted += r.rowCount ?? 0
    }
    await logEvent('admin', { act: 'lex_import', mode: b.mode || 'merge', parsed: rows.length, inserted, invalid })
    return { parsed: rows.length, inserted, invalid, samples }
  },
  async lex_add(b) {
    const { rows } = parseLexicon([b.phrase, b.lemma || b.phrase, b.gloss].join('\t'))
    need(rows[0], 'entrada inválida (sem caracteres especiais no lema)')
    await q(`INSERT INTO lexicon (phrase, lemma, gloss, lang, source) VALUES ($1,$2,$3,$4,'manual') ON CONFLICT DO NOTHING`, [rows[0].phrase, rows[0].lemma, rows[0].gloss, lang(b.lang)])
    return { ok: true }
  },
  async lex_delete(b) { await q(`DELETE FROM lexicon WHERE id = $1`, [Number(b.id) | 0]); return { ok: true } },
  async lex_toggle(b) { await q(`UPDATE lexicon SET enabled = $2 WHERE id = $1`, [Number(b.id) | 0, !!b.enabled]); return { ok: true } },
  async lex_export() { return { tsv: toTsv((await q(`SELECT phrase, lemma, gloss FROM lexicon WHERE enabled ORDER BY id`)).rows) } },
  async lex_sync() { // pede ao backend Python para voltar a ler o dicionário daqui
    const r = await backend('/reload-dictionary', { method: 'POST', body: '{}' }, 55000)
    need(r.ok, r.data?.error || `o backend respondeu ${r.status}`)
    return { backend: r.data }
  },

  // ---------- teste de ponta a ponta ----------
  async pipeline_test(b) {
    const text = String(b.text || '').trim().slice(0, 300); need(text, 'escreve uma frase')
    const t0 = Date.now()
    const r = await backend('/translate', { method: 'POST', body: JSON.stringify({ text }) })
    need(r.ok, r.data?.error || `o backend respondeu ${r.status}`)
    const st = await getSettings(true)
    const res = await resolveGlosses(r.data.glosses ?? [], r.data.extra ?? {}, st, { getRows })
    return { translate: { glosses: r.data.glosses, fallback: !!r.data.fallback, extra: r.data.extra, ms: Date.now() - t0 }, units: res.units, segments: res.segments, needSign: res.needSign }
  },
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'origem não permitida' }, 403)
  if (!isAdmin(req)) return json({ error: 'não autorizado' }, 401)
  let b: any
  try { b = await req.json() } catch { return json({ error: 'pedido inválido' }, 400) }
  const h = H[String(b.action || '')]
  if (!h) return json({ error: 'acção desconhecida' }, 400)
  try { await init(); return json(await h(b)) }
  catch (e) { return json({ error: (e as Error).message || 'erro' }, 400) }
}
