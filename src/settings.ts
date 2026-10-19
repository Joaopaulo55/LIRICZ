import { DEFAULT_EMOJI } from './emoji'
export interface Settings {
  fontSize: number; fontFamily: string; fontWeight: number
  textColor: string; bgColor: string; interimColor: string
  lineHeight: number; letterSpacing: number; align: 'left' | 'center'
  historyLimit: number; lang: string; speakRate: number; speakPitch: number; voiceURI: string
  uiHidden: boolean; keepAwake: boolean
  emojiOn: boolean; signsOn: boolean; emojiRules: Record<string, string>
  captionMode: 'live' | 'cinema'; anim: string; animSpeed: number; fadeOutSec: number
  aiFix: boolean; aiTts: boolean; aiVoice: string; geminiKey: string
}

export const ANIMS = [
  { key: 'suave', name: 'Suave' }, { key: 'fade', name: 'Fade' }, { key: 'deslizar', name: 'Deslizar' },
  { key: 'zoom', name: 'Zoom' }, { key: 'desfocar', name: 'Desfocar' }, { key: 'salto', name: 'Salto' },
  { key: 'revelar', name: 'Revelar' }, { key: 'girar', name: 'Girar' }, { key: 'brilho', name: 'Brilho' }, { key: 'nenhuma', name: 'Sem animação' },
]

export const FONTS: Record<string, string> = {
  'Moderna': 'system-ui, "Segoe UI", Roboto, sans-serif',
  'Alta legibilidade': 'Verdana, Tahoma, "DejaVu Sans", sans-serif',
  'Negrito': '"Arial Black", Impact, "Helvetica Neue", sans-serif',
  'Legendas': '"Trebuchet MS", "Segoe UI", sans-serif',
  'Serifada': 'Georgia, "Times New Roman", serif',
  'Monoespaçada': 'ui-monospace, Consolas, "Courier New", monospace',
}

export const DEFAULTS: Settings = {
  fontSize: 56, fontFamily: 'Moderna', fontWeight: 600,
  textColor: '#198754', bgColor: '#FFFFFF', interimColor: '#7FB89A',
  lineHeight: 1.25, letterSpacing: 0, align: 'left',
  historyLimit: 30, lang: 'pt-PT', speakRate: 1, speakPitch: 1, voiceURI: '',
  uiHidden: false, keepAwake: true,
  emojiOn: false, signsOn: true, emojiRules: DEFAULT_EMOJI,
  captionMode: 'live', anim: 'suave', animSpeed: 1.3, fadeOutSec: 0,
  aiFix: false, aiTts: false, aiVoice: 'Kore', geminiKey: '',
}

export const PROFILES: Record<string, Partial<Settings>> = {
  'Verde clássico': { textColor: '#198754', bgColor: '#FFFFFF', interimColor: '#7FB89A', fontSize: 56 },
  'Alto contraste': { textColor: '#FFFFFF', bgColor: '#000000', interimColor: '#B0B0B0', fontSize: 64, fontWeight: 700 },
  'Escuro': { textColor: '#E8EDE9', bgColor: '#15191A', interimColor: '#8A9A92', fontSize: 56 },
  'Amarelo': { textColor: '#FFE600', bgColor: '#101010', interimColor: '#A89B00', fontSize: 64, fontWeight: 700 },
  'Leitura gigante': { fontSize: 110, lineHeight: 1.1, fontWeight: 700 },
}

const KEY = 'liricz.settings.v2'
const PKEY = 'liricz.profiles.v1'
const QKEY = 'liricz.phrases.v1'

export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return DEFAULTS }
}
export const saveSettings = (s: Settings) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* sem espaço */ } }

export function loadCustomProfiles(): Record<string, Partial<Settings>> {
  try { return JSON.parse(localStorage.getItem(PKEY) || '{}') } catch { return {} }
}
export const saveCustomProfiles = (p: Record<string, Partial<Settings>>) => { try { localStorage.setItem(PKEY, JSON.stringify(p)) } catch { /* */ } }

export const DEFAULT_PHRASES = [
  'Olá, como estás?', 'Podes repetir, por favor?', 'Não compreendi. Podes escrever?',
  'Fala um pouco mais devagar, por favor.', 'Espera um momento.', 'Obrigado.', 'Preciso de ajuda.',
]
export function loadPhrases(): string[] {
  try { const v = JSON.parse(localStorage.getItem(QKEY) || 'null'); return Array.isArray(v) ? v : DEFAULT_PHRASES } catch { return DEFAULT_PHRASES }
}
export const savePhrases = (p: string[]) => { try { localStorage.setItem(QKEY, JSON.stringify(p)) } catch { /* */ } }

export const clearAll = () => { [KEY, PKEY, QKEY].forEach((k) => localStorage.removeItem(k)) }
