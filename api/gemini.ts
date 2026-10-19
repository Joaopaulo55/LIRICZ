// Função serverless do Vercel. A chave GEMINI_API_KEY fica só no servidor (secret).
const TEXT = process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-flash-lite'
const TTS = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview'
const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Zephyr', 'Fenrir']
const SYS = 'És um corretor de legendas em português. Recebes uma frase transcrita por voz. Corrige pontuação, maiúsculas e erros evidentes de reconhecimento. Não acrescentes, não resumas, não traduzas e não respondas à frase. Devolve apenas a frase corrigida.'
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

export async function POST(req: Request) {
  const origin = req.headers.get('origin'), host = req.headers.get('host')
  if (origin && host && new URL(origin).host !== host) return json({ error: 'origem não permitida' }, 403)
  const key = req.headers.get('x-user-key') || process.env.GEMINI_API_KEY
  if (!key) return json({ error: 'sem chave Gemini configurada' }, 503)
  let b: any
  try { b = await req.json() } catch { return json({ error: 'pedido inválido' }, 400) }
  const mode = b.mode === 'tts' ? 'tts' : 'fix'
  const text = String(b.text || '').trim().slice(0, mode === 'tts' ? 600 : 400)
  if (!text) return json({ error: 'texto vazio' }, 400)
  const call = (model: string, body: unknown) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) })
  try {
    if (mode === 'fix') {
      const r = await call(TEXT, { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0, maxOutputTokens: 300 } })
      if (!r.ok) return json({ error: `Gemini ${r.status}` }, 502)
      const d: any = await r.json()
      return json({ text: d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '' })
    }
    const voice = VOICES.includes(b.voice) ? b.voice : 'Kore'
    const r = await call(TTS, { contents: [{ parts: [{ text: `Diz de forma natural e calorosa, em português: ${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } })
    if (!r.ok) return json({ error: `Gemini ${r.status}` }, 502)
    const d: any = await r.json()
    const audio = d.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data
    return audio ? json({ audio, rate: 24000 }) : json({ error: 'sem áudio' }, 502)
  } catch { return json({ error: 'falha de rede' }, 502) }
}
