export interface LgpExtra {
  facial_expressions?: { start: number; end: number; types: string[] }[]
  pauses?: (string | null)[]
  compounds?: Record<string, string[]>
  fallback?: boolean
  [k: string]: unknown
}
export interface LgpResult { glosses: string[]; extra?: LgpExtra; fallback?: boolean; language: string; disclaimer: string }
export const wakeLgp = () => { fetch('/api/lgp').catch(() => {}) }

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) })
})

// tries > 1: se o servidor estiver a acordar (502/503/504), espera e tenta de novo.
export async function translateLgp(text: string, signal?: AbortSignal, tries = 1): Promise<LgpResult> {
  let last = ''
  for (let i = 0; i < tries; i++) {
    const r = await fetch('/api/lgp', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    const d = await r.json().catch(() => ({}))
    if (r.ok) return d as LgpResult
    last = d.detail || d.error || `erro ${r.status}`
    if (![502, 503, 504].includes(r.status) || i === tries - 1) break
    await sleep(8000, signal)
  }
  throw new Error(last)
}

// Último recurso quando o backend LGP está em baixo: palavra a palavra (o avatar soletra ou usa os sinais que existirem).
const STOP = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'à', 'às', 'pelo', 'pela', 'é', 'são', 'foi', 'era', 'ser', 'estar', 'está', 'estão'])
export function localFallbackGlosses(text: string): string[] {
  const toks = text.normalize('NFC').toLowerCase().match(/\d+(?:[.,]\d+)?|\p{L}+(?:-\p{L}+)*/gu) ?? []
  return toks.filter((w) => !STOP.has(w)).map((w) => w.toUpperCase())
}

export type UnitKind = 'sign' | 'compound' | 'number' | 'spell' | 'ai' | 'missing'
export interface ResolvedUnit { gloss: string; kind: UnitKind; language?: string; provisional: boolean }
export interface Segment { sigml: string; pauseMs: number }
export interface Resolved { units: ResolvedUnit[]; segments: Segment[]; provisional: boolean }

// O servidor devolve tudo pronto: sinais da BD (LGA > LGP, validados primeiro), gestos compostos, números, dactilologia,
// IA em tempo real (se ligada no painel), expressões faciais e pausas.
export async function resolveGlosses(glosses: string[], extra?: LgpExtra, signal?: AbortSignal): Promise<Resolved> {
  const r = await fetch('/api/resolve', {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ glosses, extra: { facial_expressions: extra?.facial_expressions, pauses: extra?.pauses, compounds: extra?.compounds, fallback: extra?.fallback } }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `erro ${r.status}`)
  return d as Resolved
}
