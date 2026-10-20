export interface LgpResult { glosses: string[]; extra?: unknown; language: string; disclaimer: string }
export const wakeLgp = () => { fetch('/api/lgp').catch(() => {}) }
export async function translateLgp(text: string, signal?: AbortSignal): Promise<LgpResult> {
  const r = await fetch('/api/lgp', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || d.error || `erro ${r.status}`)
  return d as LgpResult
}
