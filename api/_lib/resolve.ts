// Resolução glosas -> SiGML. Pura (sem BD): a BD e a IA entram por "deps", por isso é testável.
// Ordem por glosa: sinal na BD -> gesto composto/partes -> número -> IA em tempo real (opcional) -> dactilologia -> em falta.
import { gkey, gfold, baseGloss, isNumeric, letterKeys } from './gloss.js'
import { splitSigns, wrapSigml, injectNonmanual, defaultLetterSign, checkSigml } from './sigml.js'

export interface Settings {
  ai_mode: 'off' | 'assist' | 'realtime'      // off: sem IA | assist: IA só no painel | realtime: também quando falta um sinal
  show_provisional: boolean                    // mostrar sinais ainda não validados (rascunhos / regras / IA)
  unknown_policy: 'spell' | 'skip'             // sem sinal: soletrar ou saltar
  nonmanual_on: boolean                        // enviar expressões faciais do PE2LGP ao avatar
  nonmanual_map: Record<string, string>        // tipo de expressão -> fragmento SiGML não manual
  pause_ms: { oracao: number; frase: number }
  ai_daily_cap: number
  ai_per_request: number
  ai_model: string
}
export const DEFAULT_SETTINGS: Settings = {
  ai_mode: 'off', show_provisional: true, unknown_policy: 'spell', nonmanual_on: false,
  nonmanual_map: {
    interrogativa_total: '<hnm_eyebrows movement="RB"/>',
    interrogativa_parcial: '<hnm_eyebrows movement="FU"/>',
    negativa_headshake: '<hnm_head movement="SH"/>',
    olhos_franzidos: '',
  },
  pause_ms: { oracao: 350, frase: 800 }, ai_daily_cap: 300, ai_per_request: 3, ai_model: '',
}

export interface Row { gloss: string; language: 'LGA' | 'LGP'; sigml: string; validated_by: string; source?: string }
export interface Extra {
  facial_expressions?: { start: number; end: number; types: string[] }[]
  pauses?: (string | null)[]
  compounds?: Record<string, string[]>
  fallback?: boolean
}
export type Kind = 'sign' | 'compound' | 'number' | 'spell' | 'ai' | 'missing'
export interface Unit { gloss: string; kind: Kind; language?: string; provisional: boolean; signs: string[] }
export interface Deps {
  getRows(keys: string[], folds: string[]): Promise<Row[]>
  ai?(gloss: string): Promise<{ sigml: string; language: 'LGA' | 'LGP' } | null>
}
export interface Segment { sigml: string; pauseMs: number }
export interface Resolved { units: Omit<Unit, 'signs'>[]; segments: Segment[]; needSign: string[] }

const rank = (r: Row) => (r.validated_by ? 2 : 0) + (r.language === 'LGA' ? 1 : 0)
const signsOf = (r?: Row) => (r ? splitSigns(r.sigml).map((s) => s.xml) : [])

export async function resolveGlosses(input: string[], extra: Extra, st: Settings, deps: Deps): Promise<Resolved> {
  const bases = input.slice(0, 80).map((g) => baseGloss(gkey(g)))
  const compounds = new Map<string, string[]>()
  for (const [k, v] of Object.entries(extra.compounds ?? {})) if (Array.isArray(v)) compounds.set(gkey(k), v.map((x) => gkey(String(x))).filter(Boolean))
  const partsOf = (g: string) => compounds.get(g) ?? (g.includes('_') ? g.split('_').filter(Boolean) : null)

  const want = new Set<string>()
  for (const g of bases) {
    if (!g) continue
    want.add(g); partsOf(g)?.forEach((p) => want.add(p)); letterKeys(g).forEach((k) => want.add(k))
  }
  const byKey = new Map<string, Row>(), byFold = new Map<string, Row>()
  for (const r of await deps.getRows([...want], [...want].map(gfold))) {
    if (!st.show_provisional && !r.validated_by) continue
    if (!splitSigns(r.sigml).length) continue
    for (const [m, k] of [[byKey, r.gloss], [byFold, gfold(r.gloss)]] as const) {
      const cur = m.get(k); if (!cur || rank(r) > rank(cur)) m.set(k, r)
    }
  }
  const pick = (k: string) => byKey.get(k) ?? byFold.get(gfold(k))

  const spell = (g: string, kind: 'spell' | 'number'): Unit | null => {
    const keys = letterKeys(g); if (!keys.length) return null
    let provisional = false; const signs: string[] = []
    for (const k of keys) {
      const row = pick(k); const own = signsOf(row)
      if (own.length) { signs.push(own[0]); if (!row!.validated_by) provisional = true }
      else { const d = defaultLetterSign(k); if (d) { signs.push(d); provisional = true } }
    }
    return signs.length ? { gloss: g, kind, provisional, signs } : null
  }

  let aiLeft = Math.max(0, st.ai_per_request)
  const units: Unit[] = []
  for (const g of bases) {
    let u: Unit | null = null
    if (g) {
      const row = pick(g)
      if (signsOf(row).length) u = { gloss: g, kind: 'sign', language: row!.language, provisional: !row!.validated_by, signs: signsOf(row) }
      if (!u) {
        const parts = partsOf(g)
        if (parts && parts.length > 1) {
          const rs = parts.map(pick)
          if (rs.every((r) => signsOf(r).length)) u = { gloss: g, kind: 'compound', language: rs[0]!.language, provisional: rs.some((r) => !r!.validated_by), signs: rs.flatMap(signsOf) }
        }
      }
      if (!u && isNumeric(g)) u = spell(g, 'number')
      if (!u && st.ai_mode === 'realtime' && deps.ai && aiLeft > 0) {
        aiLeft--
        try {
          const r = await deps.ai(g)
          if (r && checkSigml(r.sigml).ok) u = { gloss: g, kind: 'ai', language: r.language, provisional: true, signs: splitSigns(r.sigml).map((s) => s.xml) }
        } catch { /* sem IA: cai na dactilologia */ }
      }
      if (!u && st.unknown_policy === 'spell') u = spell(g, 'spell')
    }
    units.push(u ?? { gloss: g, kind: 'missing', provisional: false, signs: [] })
  }

  if (st.nonmanual_on) {
    units.forEach((u, i) => {
      const frag = [...new Set((extra.facial_expressions ?? []).filter((f) => i >= f.start && i < f.end).flatMap((f) => f.types))]
        .map((t) => st.nonmanual_map[t] ?? '').join('')
      if (frag) u.signs = u.signs.map((s) => injectNonmanual(s, frag))
    })
  }

  const segments: Segment[] = []
  let cur: string[] = []
  const close = (pauseMs: number) => { if (cur.length) segments.push({ sigml: wrapSigml(cur.join('')), pauseMs }); cur = [] }
  units.forEach((u, i) => {
    cur.push(...u.signs)
    const p = extra.pauses?.[i]
    if (p === 'oracao' || p === 'frase') close(st.pause_ms[p] ?? 0)
  })
  close(0)

  const needSign = [...new Set(units.filter((u) => u.gloss && u.kind !== 'sign' && u.kind !== 'compound' && !(u.kind === 'number')).map((u) => u.gloss))]
  return { units: units.map(({ signs: _s, ...u }) => u), segments, needSign }
}
