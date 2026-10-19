import { describe, it, expect } from 'vitest'
import { normalize } from './speech'
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
