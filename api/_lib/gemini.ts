// Cliente Gemini (texto -> JSON) com a mesma lógica de modelos/tentativas do api/gemini.ts.
declare const process: { env: Record<string, string | undefined> }
const list = (v: string | undefined, d: string[]) => [...new Set([...(v || '').split(',').map((s) => s.trim()).filter(Boolean), ...d])]
export const geminiConfigured = () => !!process.env.GEMINI_API_KEY
export const textModels = (override = '') =>
  list(override || process.env.GEMINI_TEXT_MODEL, ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function geminiJson(system: string, prompt: string, modelOverride = ''): Promise<any> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('sem GEMINI_API_KEY no servidor')
  let last = 0
  for (const model of textModels(modelOverride)) {
    for (let a = 0; a < 2; a++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(40000),
      }).catch(() => null)
      if (!r) { last = 0; break }
      if (r.ok) {
        const d: any = await r.json()
        const txt = String(d.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
        try { return JSON.parse(txt) } catch { last = -1; break }
      }
      last = r.status
      if (r.status === 503 && a === 0) { await sleep(700); continue }
      break
    }
  }
  throw new Error(last === -1 ? 'o Gemini devolveu JSON inválido' : `Gemini ${last || 'sem resposta'}`)
}
