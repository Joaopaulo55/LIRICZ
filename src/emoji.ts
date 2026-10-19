export const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '')

// Regras iniciais (editáveis). Chaves sem acentos. Palavras ambíguas como "sim/não" ficam de fora de propósito.
export const DEFAULT_EMOJI: Record<string, string> = {
  feliz: '😊', alegre: '😄', triste: '😢', amor: '❤️', obrigado: '🙏', obrigada: '🙏', casa: '🏠',
  comida: '🍲', fome: '🍽️', agua: '💧', dinheiro: '💰', ola: '👋', tchau: '👋', ajuda: '🆘',
  hospital: '🏥', medico: '🩺', dor: '🤕', dormir: '😴', carro: '🚗', autocarro: '🚌', taxi: '🚕',
  telefone: '📱', trabalho: '💼', escola: '🏫', bebe: '👶', sol: '☀️', chuva: '🌧️', musica: '🎵',
  cafe: '☕', pao: '🍞', cerveja: '🍺', futebol: '⚽', parabens: '🎉', fogo: '🔥', policia: '👮',
}

export const lookup = (word: string, rules: Record<string, string>): string | undefined => rules[norm(word)]
