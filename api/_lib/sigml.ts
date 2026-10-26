// Gerador/validador de SiGML (HamNoSys em XML) para o avatar CWASA — 100% por regras, sem IA.
// A IA (Gemini) só preenche uma SignSpec de vocabulário FECHADO; o XML é sempre produzido por aqui.
// NÃO VERIFICADO contra o CWASA neste ambiente (sem rede): testa sempre no pré-visualizador do painel.

export const HANDSHAPES: Record<string, string> = {
  fist: 'hamfist', flat: 'hamflathand', point: 'hamfinger2', middle: 'hamfinger3', ring: 'hamfinger4', pinky: 'hamfinger5',
  v: 'hamfinger23', v_spread: 'hamfinger23spread', four: 'hamfinger2345',
  pinch: 'hampinch12', pinch_open: 'hampinch12open', pinch_all: 'hampinchall',
  c: 'hamceeall', c_small: 'hamcee12', c_open: 'hamceeopen',
}
export const THUMBS: Record<string, string> = { across: 'hamthumbacrossmod', out: 'hamthumboutmod', open: 'hamthumbopenmod' }
export const FINGERS: Record<string, string> = { straight: 'hamfingerstraightmod', bent: 'hamfingerbendmod' }
export const EXT_DIRS = ['u', 'ur', 'r', 'dr', 'd', 'dl', 'l', 'ul', 'o', 'i', 'uo', 'ui', 'do', 'di']
export const PALM_DIRS = ['u', 'ur', 'r', 'dr', 'd', 'dl', 'l', 'ul']
export const LOCATIONS: Record<string, string> = {
  neutral: '', head: 'hamhead', forehead: 'hamforehead', eyes: 'hameyes', nose: 'hamnose', mouth: 'hammouth', chin: 'hamchin',
  cheek: 'hamcheek', neck: 'hamneck', shoulders: 'hamshoulders', chest: 'hamchest', stomach: 'hamstomach',
  upperarm: 'hamupperarm', lowerarm: 'hamlowerarm',
}
export const CONTACTS: Record<string, string> = { touch: 'hamtouch' }
export const MOVES: Record<string, string> = {
  up: 'hammoveu', down: 'hammoved', left: 'hammovel', right: 'hammover', away: 'hammoveo', toward: 'hammovei',
  up_right: 'hammoveur', up_left: 'hammoveul', down_right: 'hammovedr', down_left: 'hammovedl',
  arc_left: 'hamarcl', arc_right: 'hamarcr', arc_up: 'hamarcu', arc_down: 'hamarcd', circle: 'hamcircleo',
  nod: 'hamnodding', swing: 'hamswinging', twist: 'hamtwisting', fingerplay: 'hamfingerplay',
}
export const SIZES: Record<string, string> = { small: 'hamsmallmod', large: 'hamlargemod' }
export const SPEEDS: Record<string, string> = { fast: 'hamfast', slow: 'hamslow' }

export const VOCAB = {
  handshape: Object.keys(HANDSHAPES), thumb: Object.keys(THUMBS), finger: Object.keys(FINGERS),
  ext: EXT_DIRS, palm: PALM_DIRS, location: Object.keys(LOCATIONS), contact: Object.keys(CONTACTS),
  move: Object.keys(MOVES), size: Object.keys(SIZES), speed: Object.keys(SPEEDS),
}

export interface MoveSpec { type: string; size?: string; speed?: string }
export interface SignSpec {
  handshape: string; thumb?: string; finger?: string; ext: string; palm: string
  location?: string; contact?: string; moves?: MoveSpec[]; repeat?: boolean; symmetric?: boolean
}

const pick = (v: unknown, list: string[]) => (typeof v === 'string' && list.includes(v.toLowerCase()) ? v.toLowerCase() : undefined)

// Aceita lixo (resposta da IA / formulário) e devolve uma SignSpec limpa, ou null se não houver mão utilizável.
export function validateSpec(raw: any): SignSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const handshape = pick(raw.handshape, VOCAB.handshape)
  if (!handshape) return null
  const moves: MoveSpec[] = []
  for (const m of Array.isArray(raw.moves) ? raw.moves.slice(0, 3) : []) {
    const type = pick(m?.type ?? m, VOCAB.move)
    if (type) moves.push({ type, size: pick(m?.size, VOCAB.size), speed: pick(m?.speed, VOCAB.speed) })
  }
  const loc = pick(raw.location, VOCAB.location)
  return {
    handshape, thumb: pick(raw.thumb, VOCAB.thumb), finger: pick(raw.finger, VOCAB.finger),
    ext: pick(raw.ext, EXT_DIRS) ?? 'u', palm: pick(raw.palm, PALM_DIRS) ?? 'l',
    location: loc && loc !== 'neutral' ? loc : undefined,
    contact: loc && loc !== 'neutral' ? pick(raw.contact, VOCAB.contact) : undefined,
    moves, repeat: raw.repeat === true && moves.length > 0, symmetric: raw.symmetric === true,
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const tag = (n: string) => (n ? `<${n}/>` : '')

export function specToSign(gloss: string, spec: SignSpec, nonmanual = ''): string {
  const m = spec.moves ?? []
  const manual =
    (spec.symmetric ? tag('hamsymmlr') : '') + tag(HANDSHAPES[spec.handshape]) +
    (spec.thumb ? tag(THUMBS[spec.thumb]) : '') + (spec.finger ? tag(FINGERS[spec.finger]) : '') +
    tag('hamextfinger' + spec.ext) + tag('hampalm' + spec.palm) +
    (spec.location ? tag(LOCATIONS[spec.location]) + (spec.contact ? tag(CONTACTS[spec.contact]) : '') : '') +
    m.map((x) => tag(MOVES[x.type]) + (x.size ? tag(SIZES[x.size]) : '') + (x.speed ? tag(SPEEDS[x.speed]) : '')).join('') +
    (spec.repeat ? tag('hamrepeatfromstart') : '')
  return `<hns_sign gloss="${esc(gloss)}">${nonmanual ? `<hamnosys_nonmanual>${nonmanual}</hamnosys_nonmanual>` : ''}<hamnosys_manual>${manual}</hamnosys_manual></hns_sign>`
}

export const wrapSigml = (fragment: string) => `<?xml version="1.0" encoding="utf-8"?><sigml>${fragment}</sigml>`
export const specToSigml = (gloss: string, spec: SignSpec) => wrapSigml(specToSign(gloss, spec))

// Todos os <hns_sign> de um texto SiGML (com ou sem <sigml>), por ordem.
export function splitSigns(xml: string): { gloss: string; xml: string }[] {
  const out: { gloss: string; xml: string }[] = []
  for (const m of String(xml ?? '').matchAll(/<hns_sign\b[^>]*>[\s\S]*?<\/hns_sign>/gi)) {
    const g = /\bgloss\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0].slice(0, m[0].indexOf('>') + 1))
    out.push({ gloss: g ? unesc(g[1] ?? g[2] ?? '') : '', xml: m[0] })
  }
  return out
}

// Verificação leve de boa formação (sem DOMParser, para correr também no servidor).
export function checkSigml(xml: string): { ok: boolean; error?: string; glosses: string[] } {
  const s = String(xml ?? '')
  if (!s.trim()) return { ok: false, error: 'vazio', glosses: [] }
  if (s.length > 400_000) return { ok: false, error: 'demasiado grande', glosses: [] }
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(s)) return { ok: false, error: 'DOCTYPE/ENTITY não permitidos', glosses: [] }
  const body = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '')
  const stack: string[] = []
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (body.slice(last, m.index).includes('<')) return { ok: false, error: 'carácter "<" solto', glosses: [] }
    last = re.lastIndex
    if (m[4]) continue
    if (m[1]) { if (stack.pop() !== m[2]) return { ok: false, error: `etiqueta </${m[2]}> sem par`, glosses: [] } }
    else stack.push(m[2])
  }
  if (body.slice(last).includes('<')) return { ok: false, error: 'etiqueta mal formada', glosses: [] }
  if (stack.length) return { ok: false, error: `etiqueta <${stack[stack.length - 1]}> por fechar`, glosses: [] }
  const signs = splitSigns(body)
  if (!signs.length) return { ok: false, error: 'não há nenhum <hns_sign>', glosses: [] }
  return { ok: true, glosses: signs.map((x) => x.gloss) }
}

// Mete marcação não manual (expressões faciais) logo à entrada de um <hns_sign>, se ele ainda não tiver.
export function injectNonmanual(signXml: string, fragment: string): string {
  if (!fragment || /<hamnosys_nonmanual\b/i.test(signXml)) return signXml
  return signXml.replace(/<hns_sign\b[^>]*>/i, (open) => `${open}<hamnosys_nonmanual>${fragment}</hamnosys_nonmanual>`)
}

// ---- Alfabeto manual e dígitos de ARRANQUE (aproximações editáveis; não são um alfabeto oficial validado) ----
const S = (handshape: string, thumb: string | undefined, ext: string, palm: string, more: Partial<SignSpec> = {}): SignSpec =>
  ({ handshape, thumb, ext, palm, ...more })
export const DEFAULT_SPECS: Record<string, SignSpec> = {
  '#A': S('fist', 'out', 'u', 'l'), '#B': S('flat', 'across', 'u', 'l'), '#C': S('c', undefined, 'u', 'l'),
  '#D': S('point', 'across', 'u', 'l'), '#E': S('fist', 'across', 'u', 'l'), '#F': S('pinch_open', undefined, 'u', 'l'),
  '#G': S('point', undefined, 'r', 'l'), '#H': S('v', undefined, 'r', 'd'), '#I': S('pinky', undefined, 'u', 'l'),
  '#J': S('pinky', undefined, 'u', 'l', { moves: [{ type: 'down' }, { type: 'arc_left' }] }),
  '#K': S('v', 'open', 'uo', 'l'), '#L': S('point', 'open', 'u', 'l'), '#M': S('fist', 'across', 'd', 'l'),
  '#N': S('fist', 'across', 'dl', 'l'), '#O': S('pinch_all', undefined, 'l', 'l'), '#P': S('v', 'open', 'd', 'l'),
  '#Q': S('point', 'open', 'd', 'l'), '#R': S('v', undefined, 'u', 'l', { finger: 'bent' }), '#S': S('fist', undefined, 'u', 'l'),
  '#T': S('fist', 'across', 'ul', 'l'), '#U': S('v', undefined, 'u', 'ul'), '#V': S('v_spread', undefined, 'u', 'l'),
  '#W': S('four', 'across', 'u', 'ur'), '#X': S('point', undefined, 'u', 'l', { finger: 'bent' }),
  '#Y': S('pinky', 'open', 'u', 'l'),
  '#Z': S('point', undefined, 'o', 'l', { moves: [{ type: 'right' }, { type: 'down_left' }, { type: 'right' }] }),
  '#0': S('c', undefined, 'l', 'd'), '#1': S('point', undefined, 'u', 'l'), '#2': S('v', undefined, 'u', 'l'),
  '#3': S('v', 'open', 'u', 'l'), '#4': S('four', 'across', 'u', 'l'), '#5': S('four', 'open', 'u', 'l'),
  '#6': S('pinch_all', undefined, 'u', 'ur'), '#7': S('pinch_open', undefined, 'u', 'ur'),
  '#8': S('c_open', undefined, 'u', 'ur'), '#9': S('c_small', undefined, 'u', 'ur'),
}
export const defaultLetterSign = (key: string): string | null => {
  const sp = DEFAULT_SPECS[key]
  return sp ? specToSign(key, sp) : null
}
