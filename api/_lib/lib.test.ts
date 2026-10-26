import { describe, it, expect } from 'vitest'
import { parseModels, rankModels } from './gemini'
import { gkey, gfold, letterKeys, baseGloss, isNumeric } from './gloss'
import { validateSpec, specToSign, wrapSigml, checkSigml, splitSigns, injectNonmanual, DEFAULT_SPECS, defaultLetterSign } from './sigml'
import { resolveGlosses, DEFAULT_SETTINGS, type Row } from './resolve'
import { parseLexicon, toTsv } from './lexparse'

const sign = (g: string) => specToSign(g, { handshape: 'flat', ext: 'u', palm: 'l' })
const row = (gloss: string, language: 'LGA' | 'LGP', by: string): Row => ({ gloss, language, sigml: wrapSigml(sign(gloss)), validated_by: by })
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

describe('glosas', () => {
  it('normaliza mantendo acentos e hífenes', () => {
    expect(gkey(' muito rico ')).toBe('MUITO_RICO')
    expect(gkey('muito-rico')).toBe('MUITO-RICO')
    expect(gkey('Profissão')).toBe('PROFISSÃO')
    expect(gkey('a<b>"c')).toBe('ABC')
  })
  it('chave dobrada ignora acentos e hífenes', () => {
    expect(gfold('PROFISSÃO')).toBe('PROFISSAO')
    expect(gfold('muito-rico')).toBe('MUITO_RICO')
  })
  it('letras, números e NO_EXPR', () => {
    expect(letterKeys('João 7')).toEqual(['#J', '#O', '#A', '#O', '#7'])
    expect(baseGloss('MEU_NO_EXPR')).toBe('MEU')
    expect(isNumeric('2026')).toBe(true)
    expect(isNumeric('ola')).toBe(false)
  })
})

describe('SiGML', () => {
  it('valida a especificação e filtra lixo', () => {
    const sp = validateSpec({ handshape: 'FIST', thumb: 'out', ext: 'zz', palm: 'r', location: 'chest', contact: 'touch', moves: [{ type: 'up', size: 'small' }, { type: 'bogus' }], repeat: true })!
    expect(sp.ext).toBe('u')
    expect(sp.moves).toHaveLength(1)
    expect(validateSpec({ handshape: 'nada' })).toBeNull()
  })
  it('gera XML bem formado e detecta XML estragado', () => {
    const x = wrapSigml(specToSign('TESTE & "x"', validateSpec({ handshape: 'fist' })!))
    expect(checkSigml(x).ok).toBe(true)
    expect(checkSigml(x).glosses).toEqual(['TESTE & "x"'])
    expect(checkSigml('<sigml><hns_sign gloss="A"><hamfist></hns_sign></sigml>').ok).toBe(false)
    expect(checkSigml('<!DOCTYPE x><sigml/>').ok).toBe(false)
    expect(checkSigml('<sigml></sigml>').ok).toBe(false)
  })
  it('injecta marcação não manual uma só vez', () => {
    const s = sign('X'), i = injectNonmanual(s, '<hnm_eyebrows movement="RB"/>')
    expect(i).toContain('<hamnosys_nonmanual><hnm_eyebrows')
    expect(injectNonmanual(i, '<a/>')).toBe(i)
    expect(splitSigns(wrapSigml(s + s))).toHaveLength(2)
  })
  it('alfabeto e dígitos de arranque são todos válidos', () => {
    const keys = Object.keys(DEFAULT_SPECS)
    expect(keys).toHaveLength(36)
    for (const k of keys) expect(checkSigml(wrapSigml(defaultLetterSign(k)!)).ok).toBe(true)
  })
})

describe('resolução', () => {
  const rows = [row('CASA', 'LGP', 'Maria'), row('CASA', 'LGA', ''), row('PROFISSÃO', 'LGA', 'João'), row('MUITO_RICO', 'LGP', 'x'), row('AJUDAR', 'LGP', 'x'), row('EU', 'LGP', 'x')]
  const deps = { getRows: async (k: string[], f: string[]) => rows.filter((r) => k.includes(r.gloss) || f.includes(fold(r.gloss))) }
  it('ordem: sinal > composto > soletrar > número > em falta; validado LGP ganha a LGA provisório', async () => {
    const r = await resolveGlosses(['CASA', 'profissao', 'muito-rico', 'AJUDAR_EU', 'MEU_NO_EXPR', 'João', '2026', '???'],
      { pauses: [null, null, null, null, 'oracao', null, null, 'frase'] }, DEFAULT_SETTINGS, deps)
    expect(r.units.map((u) => u.kind)).toEqual(['sign', 'sign', 'sign', 'compound', 'spell', 'spell', 'number', 'missing'])
    expect(r.units[0].language).toBe('LGP')
    expect(r.units[0].provisional).toBe(false)
    expect(r.segments).toHaveLength(2)
    expect(r.segments[0].pauseMs).toBe(DEFAULT_SETTINGS.pause_ms.oracao)
    expect(r.needSign).toContain('MEU')
    expect(r.needSign).not.toContain('2026')
  })
  it('esconde provisórios quando desligado e salta se a política é skip', async () => {
    const r = await resolveGlosses(['CASA'], {}, { ...DEFAULT_SETTINGS, show_provisional: false, unknown_policy: 'skip' }, { getRows: async () => [row('CASA', 'LGA', '')] })
    expect(r.units[0].kind).toBe('missing')
  })
  it('IA em tempo real só entra com ai_mode=realtime', async () => {
    let calls = 0
    const ai = async (g: string) => { calls++; return { sigml: wrapSigml(sign(g)), language: 'LGA' as const } }
    const d = { getRows: async () => [] as Row[], ai }
    await resolveGlosses(['AGUA'], {}, DEFAULT_SETTINGS, d)
    expect(calls).toBe(0)
    const r = await resolveGlosses(['AGUA'], {}, { ...DEFAULT_SETTINGS, ai_mode: 'realtime' }, d)
    expect(calls).toBe(1)
    expect(r.units[0].kind).toBe('ai')
    expect(r.units[0].provisional).toBe(true)
  })
  it('expressões faciais só são enviadas se ligadas', async () => {
    const extra = { facial_expressions: [{ start: 0, end: 1, types: ['interrogativa_total'] }] }
    const off = await resolveGlosses(['CASA'], extra, DEFAULT_SETTINGS, deps)
    expect(off.segments[0].sigml).not.toContain('hnm_eyebrows')
    const on = await resolveGlosses(['CASA'], extra, { ...DEFAULT_SETTINGS, nonmanual_on: true }, deps)
    expect(on.segments[0].sigml).toContain('hnm_eyebrows')
  })
})

describe('dicionário', () => {
  it('lê 3 colunas, 2 colunas e listas; rejeita lemas que partem a regex do PE2LGP', () => {
    const a = parseLexicon('palavra\tlema\tgesto\nCasas\tcasa\tCASA\nmuito rico\tmuito rico\tmuito rico\nruim(\truim\tRUIM\n')
    expect(a.rows).toEqual([{ phrase: 'casas', lemma: 'casa', gloss: 'casa' }, { phrase: 'muito rico', lemma: 'muito rico', gloss: 'muito-rico' }])
    expect(a.invalid).toBe(1)
    expect(parseLexicon('olá;OLA\nbom dia;bom-dia\n').rows).toHaveLength(2)
    const c = parseLexicon('casa\nescola\ncasa\n')
    expect(c.rows.map((r) => r.gloss)).toEqual(['casa', 'escola'])
    expect(toTsv(c.rows)).toBe('casa\tcasa\tcasa\nescola\tescola\tescola\n')
  })
})

describe('modelo Gemini mais recente', () => {
  const names = ['models/gemini-2.5-flash', 'models/gemini-3.5-flash-preview-09', 'models/gemini-3.5-flash', 'models/gemini-3.1-flash-lite', 'models/gemini-3.5-flash-image',
    'models/gemini-3.5-flash-live', 'models/gemini-3.8-pro', 'models/gemini-3.5-flash-tts', 'models/text-embedding-004', 'models/gemma-3-27b']
  it('ignora imagem/voz/embeddings e ordena pela versão mais alta, estável primeiro', () => {
    expect(rankModels(parseModels(names), 'flash')).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-preview-09', 'gemini-2.5-flash'])
    expect(rankModels(parseModels(names), 'flash-lite')).toEqual(['gemini-3.1-flash-lite'])
    expect(rankModels(parseModels(names), 'pro')).toEqual(['gemini-3.8-pro'])
  })
})
