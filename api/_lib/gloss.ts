// Normalização de glosas — UMA só regra para frontend, API, painel e tradutor.
// gkey : chave canónica (maiúsculas, acentos e hífenes preservados, espaços -> "_").
// gfold: chave "dobrada" (sem acentos, "-" -> "_") usada como 2.ª tentativa de correspondência.
export const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export function gkey(s: string): string {
  return String(s ?? '')
    .normalize('NFC').trim().toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_+\-.#]/gu, '')
    .replace(/_+/g, '_').replace(/^_+|_+$/g, '')
}
export const gfold = (s: string): string => strip(gkey(s)).toUpperCase().replace(/-/g, '_')
export const okGloss = (s: string) => /^[\p{L}\p{N}_+\-.#]{1,60}$/u.test(s)

// "MEU_NO_EXPR" -> "MEU" (marcador do PE2LGP: sem expressão facial própria)
export const baseGloss = (g: string) => g.replace(/_NO_EXPR$/, '')
export const isNumeric = (g: string) => /^\d[\d.,]*$/.test(g)

// Chaves de alfabeto manual: "João" -> ["#J","#O","#A","#O"]; "2026" -> ["#2","#0","#2","#6"]
export function letterKeys(word: string): string[] {
  const out: string[] = []
  for (const ch of strip(String(word ?? '')).toUpperCase()) if (/[A-Z0-9]/.test(ch)) out.push('#' + ch)
  return out
}
export const ALPHABET_KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map((c) => '#' + c)
