// Cliente Gemini (texto -> JSON). A chave vem do painel (guardada cifrada na BD) ou, em alternativa, de GEMINI_API_KEY.
// O modelo é descoberto sozinho: pergunta à Google quais existem e usa o "flash" mais recente (cache de 6 h).
import { getSecret } from './db.js'
declare const process: { env: Record<string, string | undefined> }
const list = (v: string | undefined, d: string[] = []) => [...new Set([...(v || '').split(',').map((s) => s.trim()).filter(Boolean), ...d])]
const FALLBACK = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let kCache: { at: number; v: string; from: 'painel' | 'env' | '' } | null = null
export function forgetGeminiKey() { kCache = null; mCache = null }
export async function geminiKey(): Promise<{ key: string; from: 'painel' | 'env' | '' }> {
  if (kCache && Date.now() - kCache.at < 30_000) return { key: kCache.v, from: kCache.from }
  let key = '', from: 'painel' | 'env' | '' = ''
  try { key = (await getSecret('gemini_key')) || ''; if (key) from = 'painel' } catch { /* BD em baixo: tenta o env */ }
  if (!key && process.env.GEMINI_API_KEY) { key = process.env.GEMINI_API_KEY; from = 'env' }
  kCache = { at: Date.now(), v: key, from }
  return { key, from }
}
export const geminiConfigured = async () => !!(await geminiKey()).key

// "gemini-3.5-flash-preview-05" -> { v: 3.5, family: 'flash', stable: false }
interface M { name: string; v: number; family: 'pro' | 'flash' | 'flash-lite'; stable: boolean }
const BAD = /(tts|image|live|audio|embed|robotics|computer|vision|aqa|imagen|veo|learnlm|gemma|customtools|thinking-exp|-exp)/i
export function parseModels(names: string[]): M[] {
  const out: M[] = []
  for (const n of names) {
    const name = n.replace(/^models\//, '')
    const m = /^gemini-(\d+(?:\.\d+)?)-(pro|flash-lite|flash)(?:-(.*))?$/.exec(name)
    if (!m || BAD.test(name)) continue
    out.push({ name, v: parseFloat(m[1]), family: m[2] as M['family'], stable: !/preview|exp|beta/i.test(m[3] || '') })
  }
  return out
}
// Do mais novo para o mais antigo; a igualdade de versão desempata a favor do estável.
export const rankModels = (ms: M[], family: M['family'] = 'flash') =>
  ms.filter((x) => x.family === family).sort((a, b) => b.v - a.v || Number(b.stable) - Number(a.stable) || a.name.localeCompare(b.name)).map((x) => x.name)

let mCache: { at: number; names: string[] } | null = null
export async function latestModels(key: string): Promise<string[]> {
  if (mCache && Date.now() - mCache.at < 6 * 3600_000) return mCache.names
  try {
    const found: string[] = []
    let token = ''
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${token ? `&pageToken=${token}` : ''}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000) })
      if (!r.ok) break
      const d: any = await r.json()
      for (const m of d.models ?? []) if ((m.supportedGenerationMethods ?? []).includes('generateContent')) found.push(m.name)
      token = d.nextPageToken || ''
      if (!token) break
    }
    const ms = parseModels(found)
    const names = [...rankModels(ms, 'flash').slice(0, 3), ...rankModels(ms, 'flash-lite').slice(0, 1)]
    if (names.length) { mCache = { at: Date.now(), names }; return names }
  } catch { /* sem rede / chave inválida: usa os predefinidos */ }
  return FALLBACK
}
// override (painel) tem prioridade; vazio = automático (o mais recente)
export async function textModels(override = ''): Promise<string[]> {
  const fixed = list(override || process.env.GEMINI_TEXT_MODEL)
  if (fixed.length) return fixed
  const { key } = await geminiKey()
  return key ? latestModels(key) : FALLBACK
}

export async function geminiJson(system: string, prompt: string, modelOverride = ''): Promise<any> {
  const { key } = await geminiKey()
  if (!key) throw new Error('falta a chave do Gemini (junta-a em Configuração)')
  let last = 0
  for (const model of await textModels(modelOverride)) {
    for (let a = 0; a < 2; a++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(45000),
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
  throw new Error(last === -1 ? 'o Gemini devolveu JSON inválido' : last === 400 || last === 403 ? `Gemini ${last}: chave inválida ou sem permissão` : `Gemini ${last || 'sem resposta'}`)
}
