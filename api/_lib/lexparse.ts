// Leitura de dicionários enviados pelo painel (CSV/TSV/lista de palavras) para o formato do PE2LGP: palavra \t lema \t glosa.
export interface LexRow { phrase: string; lemma: string; gloss: string }
// O PE2LGP usa o lema dentro de uma expressão regular sem a escapar: estes caracteres partem a tradução.
const REGEX_CHARS = /[\[\]()*+?|\\^${}.]/
const cell = (s: string) => s.replace(/^\uFEFF/, '').trim().replace(/^"(.*)"$/, '$1').trim().toLowerCase().replace(/\s+/g, ' ')

export function parseLexicon(text: string, max = 20000): { rows: LexRow[]; invalid: number; samples: string[] } {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '')).filter((l) => l.trim() && !l.trim().startsWith('#'))
  const first = lines[0] ?? ''
  const sep = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ','
  const rows: LexRow[] = [], seen = new Set<string>(), samples: string[] = []
  let invalid = 0
  for (const [i, line] of lines.entries()) {
    const c = line.split(sep).map(cell)
    if (i === 0 && ['palavra', 'word', 'phrase', 'palavras'].includes(c[0])) continue // cabeçalho
    const [phrase, lemma, gloss] = c.length >= 3 ? [c[0], c[1], c[2]] : c.length === 2 ? [c[0], c[0], c[1]] : [c[0], c[0], c[0]]
    const g = (gloss ?? '').replace(/\s+/g, '-')
    const bad = !phrase || !lemma || !g || [phrase, lemma].some((x) => REGEX_CHARS.test(x) || x.length > 80) || !/^[\p{L}\p{N}_+\-]{1,60}$/u.test(g)
    if (bad) { invalid++; if (samples.length < 8) samples.push(line.slice(0, 80)); continue }
    const k = `${phrase}\t${lemma}\t${g}`
    if (seen.has(k)) continue
    seen.add(k); rows.push({ phrase, lemma, gloss: g })
    if (rows.length >= max) break
  }
  return { rows, invalid, samples }
}
export const toTsv = (rows: LexRow[]) => rows.map((r) => `${r.phrase}\t${r.lemma}\t${r.gloss}`).join('\n') + (rows.length ? '\n' : '')
