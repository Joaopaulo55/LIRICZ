import { logEvent } from './_lib/db.js'
import { geminiKey, textModels } from './_lib/gemini.js'
// Função serverless do Vercel. A chave GEMINI_API_KEY fica só no servidor (secret).
declare const process: { env: Record<string, string | undefined> } // evita o erro TS2591 sem precisar de @types/node
// Os modelos podem ser uma lista separada por vírgulas (o 1.º é o preferido; os outros entram se o 1.º falhar com 429/503/404...).
const list = (v: string | undefined, d: string[]) => [...new Set([...(v || '').split(',').map((s) => s.trim()).filter(Boolean), ...d])]
const TTS_MODELS = list(process.env.GEMINI_TTS_MODEL, ['gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview'])
const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Zephyr', 'Fenrir']
const SYS = 'És um corretor de legendas em português. Recebes uma frase transcrita por voz. Corrige pontuação, maiúsculas e erros evidentes de reconhecimento. Não acrescentes, não resumas, não traduzas e não respondas à frase. Devolve apenas a frase corrigida.'
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: Request) {
  const origin = req.headers.get('origin'), host = req.headers.get('host')
  if (origin && host && new URL(origin).host !== host) return json({ error: 'origem não permitida' }, 403)
  const key = req.headers.get('x-user-key') || (await geminiKey()).key // chave do painel, ou GEMINI_API_KEY
  if (!key) return json({ error: 'sem chave Gemini configurada' }, 503)
  let b: any
  try { b = await req.json() } catch { return json({ error: 'pedido inválido' }, 400) }
  const mode = b.mode === 'tts' ? 'tts' : 'fix'
  const text = String(b.text || '').trim().slice(0, mode === 'tts' ? 600 : 400)
  if (!text) return json({ error: 'texto vazio' }, 400)
  const call = (model: string, body: unknown) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) })

  // 503 (modelo sobrecarregado): 1 nova tentativa no mesmo modelo. 429/404/500/...: passa logo ao modelo seguinte (cada modelo tem a sua quota).
  const run = async (models: string[], attempt: (m: string) => Promise<Response>) => {
    let last = 0
    for (const m of models) {
      for (let a = 0; a < 2; a++) {
        const r = await attempt(m)
        if (r.ok) return { r }
        last = r.status
        if (r.status === 503 && a === 0) { await sleep(700); continue }
        break
      }
    }
    return { status: last }
  }

  try {
    if (mode === 'fix') {
      const body = (think: boolean) => ({ systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0, maxOutputTokens: 1024, ...(think ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) } })
      const res = await run(await textModels(), async (m) => { // modelo mais recente, descoberto sozinho
        const r = await call(m, body(true))
        return r.status === 400 ? call(m, body(false)) : r // se o parâmetro de raciocínio não for aceite
      })
      if (!res.r) { await logEvent('gemini_fail', { mode, status: res.status }); return json({ error: `Gemini ${res.status}` }, 502) }
      await logEvent('gemini_fix', {})
      const d: any = await res.r.json()
      return json({ text: d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '' })
    }
    const voice = VOICES.includes(b.voice) ? b.voice : 'Kore'
    const body = { contents: [{ parts: [{ text: `Diz de forma natural e calorosa, em português: ${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }
    const res = await run(TTS_MODELS, (m) => call(m, body))
    if (!res.r) { await logEvent('gemini_fail', { mode, status: res.status }); return json({ error: `Gemini ${res.status}` }, 502) }
    await logEvent('gemini_tts', {})
    const d: any = await res.r.json()
    const audio = d.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data
    return audio ? json({ audio, rate: 24000 }) : json({ error: 'sem áudio' }, 502)
  } catch { return json({ error: 'falha de rede' }, 502) }
}
