// IA (Gemini) que PROPÕE a descrição de um sinal num vocabulário fechado. O SiGML é sempre gerado por regras (sigml.ts):
// a IA nunca escreve XML, por isso não consegue produzir SiGML inválido. O resultado é sempre provisório até alguém o validar.
import { geminiJson } from './gemini.js'
import { VOCAB, validateSpec, specToSign, wrapSigml, type SignSpec } from './sigml.js'
import { gkey } from './gloss.js'

const SYSTEM = `És um assistente de notação de língua gestual. Descreves UM sinal com parâmetros de um vocabulário FECHADO (HamNoSys simplificado).
Regras: usa apenas valores das listas; não inventes valores; se não tiveres certeza de como se faz o sinal, propõe a forma icónica mais simples e plausível.
Se a palavra for um nome próprio (pessoa, lugar, marca), sigla ou estrangeirismo sem sinal, responde {"mode":"spell"}.
Responde SÓ com JSON.`

const vocabText = () => Object.entries(VOCAB).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n')

export async function aiSignSpec(gloss: string, o: { hint?: string; language?: string; model?: string } = {}): Promise<{ mode: 'spell' } | { mode: 'sign'; spec: SignSpec }> {
  const prompt = `Língua: ${o.language === 'LGP' ? 'LGP (Portugal)' : 'LGA (Angola)'}.
Glosa (palavra em português): ${gloss}
${o.hint ? `Descrição/indicações do administrador: ${o.hint}\n` : ''}
Vocabulário permitido:
${vocabText()}

Formato da resposta (JSON):
{"mode":"sign","handshape":"...","thumb":"... ou omitir","finger":"... ou omitir","ext":"direcção dos dedos","palm":"direcção da palma","location":"...","contact":"touch ou omitir","moves":[{"type":"...","size":"...","speed":"..."}],"repeat":false,"symmetric":false}
"symmetric": true quando as duas mãos fazem o mesmo movimento em espelho. "moves" tem no máximo 3 movimentos.`
  const raw = await geminiJson(SYSTEM, prompt, o.model)
  if (raw?.mode === 'spell') return { mode: 'spell' }
  const spec = validateSpec(raw)
  if (!spec) throw new Error('a IA não devolveu uma descrição utilizável')
  return { mode: 'sign', spec }
}

// Até 10 glosas num único pedido ao Gemini (poupa quota). Devolve, por glosa (chave gkey), o modo e a especificação.
export async function aiSignSpecs(glosses: string[], o: { language?: string; model?: string } = {}): Promise<Map<string, { mode: 'spell' } | { mode: 'sign'; spec: SignSpec } | { mode: 'error'; error: string }>> {
  const list = glosses.slice(0, 10)
  const prompt = `Língua: ${o.language === 'LGP' ? 'LGP (Portugal)' : 'LGA (Angola)'}.
Descreve um sinal para CADA glosa (palavra em português; hífen/underscore ligam palavras do mesmo sinal): ${JSON.stringify(list)}

Vocabulário permitido:
${vocabText()}

Formato da resposta (JSON): {"items":[{"gloss":"<a glosa tal como foi dada>","mode":"sign","handshape":"...","thumb":"... ou omitir","finger":"... ou omitir","ext":"direcção dos dedos","palm":"direcção da palma","location":"...","contact":"touch ou omitir","moves":[{"type":"...","size":"...","speed":"..."}],"repeat":false,"symmetric":false}]}
Para nomes próprios, siglas ou estrangeirismos usa {"gloss":"...","mode":"spell"}. "moves" tem no máximo 3 movimentos. Devolve um item por glosa.`
  const raw = await geminiJson(SYSTEM, prompt, o.model)
  const out = new Map<string, { mode: 'spell' } | { mode: 'sign'; spec: SignSpec } | { mode: 'error'; error: string }>()
  for (const it of Array.isArray(raw?.items) ? raw.items : []) {
    const k = gkey(String(it?.gloss ?? '')); if (!k) continue
    if (it.mode === 'spell') { out.set(k, { mode: 'spell' }); continue }
    const spec = validateSpec(it)
    out.set(k, spec ? { mode: 'sign', spec } : { mode: 'error', error: 'descrição inutilizável' })
  }
  return out
}

export const aiSigml = (gloss: string, spec: SignSpec) => wrapSigml(specToSign(gloss, spec))

// Dicionário: palavras portuguesas -> lema + glosa (para o tradutor PE2LGP).
export async function aiDictionary(words: string[], model = ''): Promise<{ word: string; lemma: string; gloss: string }[]> {
  const raw = await geminiJson(
    `És linguista de português e de língua gestual. Para cada palavra devolve o lema (verbos no infinitivo; nomes e adjectivos no masculino singular) e a glosa (a palavra portuguesa em minúsculas que nomeia o sinal; verbos no infinitivo; sem acentos soltos nem símbolos; várias palavras ligadas por hífen). Responde SÓ com JSON.`,
    `Palavras: ${JSON.stringify(words.slice(0, 60))}\nFormato: {"entries":[{"word":"...","lemma":"...","gloss":"..."}]}`, model)
  const safe = (s: unknown) => String(s ?? '').toLowerCase().trim().replace(/[\t\r\n]+/g, ' ').replace(/[\[\]()*+?|\\^${}.]/g, '')
  return (Array.isArray(raw?.entries) ? raw.entries : [])
    .map((e: any) => ({ word: safe(e?.word), lemma: safe(e?.lemma), gloss: safe(e?.gloss).replace(/\s+/g, '-') }))
    .filter((e: any) => e.word && e.lemma && e.gloss)
}
