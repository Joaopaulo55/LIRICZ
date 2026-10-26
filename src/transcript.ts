// Armazém de legendas fora do React: a voz atualiza só o componente das legendas, não a app inteira.
import type { LgpExtra } from './lgp'
export interface Item { id: number; text: string; final: boolean; lgp?: string[]; lgpExtra?: LgpExtra }
let items: Item[] = []
let live = -1
let nid = 0
let raf = 0
const subs = new Set<() => void>()
const emit = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; subs.forEach((f) => f()) }) }

export const transcript = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
  get: () => items,
  interim(text: string) {
    if (!text) { if (live >= 0) { items = items.filter((i) => i.id !== live); live = -1; emit() } return }
    if (live >= 0) items = items.map((i) => (i.id === live ? { ...i, text } : i))
    else { live = ++nid; items = [...items, { id: live, text, final: false }] }
    emit()
  },
  final(text: string): number {
    let id: number
    if (live >= 0) { id = live; items = items.map((i) => (i.id === id ? { ...i, text, final: true } : i)); live = -1 }
    else { id = ++nid; items = [...items, { id, text, final: true }] }
    items = items.slice(-60)
    emit()
    return id
  },
  replace(id: number, text: string) { if (items.some((i) => i.id === id)) { items = items.map((i) => (i.id === id ? { ...i, text } : i)); emit() } },
  attach(id: number, lgp: string[], lgpExtra?: LgpExtra) { if (items.some((i) => i.id === id)) { items = items.map((i) => (i.id === id ? { ...i, lgp, lgpExtra } : i)); emit() } },
  clear() { items = []; live = -1; emit() },
}
