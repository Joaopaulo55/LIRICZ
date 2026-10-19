import { describe, it, expect } from 'vitest'
import { normalize, stripRepeat } from './speech'
import { DEFAULTS, PROFILES } from './settings'

describe('speech utils', () => {
  it('normaliza espaços', () => expect(normalize('  olá   mundo ')).toBe('olá mundo'))
})
describe('perfis', () => {
  it('perfil clássico é branco com letras verdes', () => {
    expect(DEFAULTS.bgColor).toBe('#FFFFFF')
    expect(DEFAULTS.textColor).toBe('#198754')
    expect(PROFILES['Alto contraste'].bgColor).toBe('#000000')
  })
})

describe('repetições do reconhecimento', () => {
  it('remove o texto acumulado', () => expect(stripRepeat('olá', 'olá como')).toBe('como'))
  it('ignora repetição exata', () => expect(stripRepeat('olá', 'Olá.')).toBe(''))
  it('mantém frases novas', () => expect(stripRepeat('olá', 'tudo bem')).toBe('tudo bem'))
  it('cadeia acumulada', () => expect(stripRepeat('olá como', 'olá como estás')).toBe('estás'))
})
