import { useEffect, useState } from 'react'
// Glossário de sinais LOCAL: public/signs/manifest.json. Só mostra entradas com "validatedBy" preenchido.
export interface SignEntry { file: string; validatedBy: string; credit?: string }
export type Signs = Record<string, SignEntry>

let cache: Promise<Signs> | null = null
const load = (): Promise<Signs> => (cache ??= fetch('/signs/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})))

export const signUrl = (e: SignEntry) => (/^[\w.-]+$/.test(e.file) ? `/signs/${e.file}` : '')

export function useSigns(): Signs {
  const [m, setM] = useState<Signs>({})
  useEffect(() => { let ok = true; load().then((v) => ok && setM(v)); return () => { ok = false } }, [])
  return m
}
