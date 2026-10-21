export interface LgpResult { glosses: string[]; extra?: unknown; language: string; disclaimer: string }
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
