// Cliente do vocabulário de sinais (api/signs.ts -> Postgres). Só chegam sinais validados.
export interface SignData { sigml: string; language: 'LGA' | 'LGP'; validatedBy: string }
const cache = new Map<string, SignData | null>()

export async function fetchSigns(glosses: string[]): Promise<Record<string, SignData>> {
  const keys = [...new Set(glosses.map((g) => g.trim().toUpperCase()).filter(Boolean))]
  const want = keys.filter((k) => !cache.has(k)).slice(0, 40)
  if (want.length) {
    try {
      const r = await fetch('/api/signs?g=' + encodeURIComponent(want.join(',')))
      if (r.ok) { const d = await r.json(); for (const k of want) cache.set(k, d.signs?.[k] ?? null) } // falhas não ficam em cache
    } catch { /* sem rede: mostra só as glosas */ }
  }
  const out: Record<string, SignData> = {}
  for (const k of keys) { const v = cache.get(k); if (v) out[k] = v }
  return out
}

// Junta os sinais de uma frase num único documento SiGML (um <sigml> com vários sinais, pela ordem das glosas).
export function buildSigml(glosses: string[], signs: Record<string, SignData>): string {
  const parts: string[] = []
  for (const g of glosses) {
    const e = signs[g.trim().toUpperCase()]
    if (!e) continue
    const inner = /<sigml[^>]*>([\s\S]*)<\/sigml>/i.exec(e.sigml)?.[1] ?? e.sigml // aceita ficheiro completo ou só o sinal
    parts.push(inner.replace(/<\?xml[^>]*\?>/gi, '').trim())
  }
  return parts.length ? `<?xml version="1.0" encoding="utf-8"?><sigml>${parts.join('')}</sigml>` : ''
}
