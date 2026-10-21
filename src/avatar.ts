// Avatar 3D de língua gestual: CWASA (Universidade de East Anglia). Carregado só quando o LGP é usado.
// BASE: por defeito a instalação pública da UEA. Para alojar localmente, copia a instalação para public/cwasa/ e define VITE_CWASA_BASE=/cwasa/
// Ver as condições de uso: http://vh.cmp.uea.ac.uk/index.php/CWASA_Conditions_of_Use
const env = (import.meta as any).env as Record<string, string | undefined>
const RAW = env.VITE_CWASA_BASE || 'https://vhg.cmp.uea.ac.uk/tech/jas/vhg2025a/'
export const AV_BASE = RAW.endsWith('/') ? RAW : RAW + '/'
export const SAMPLE_URL = AV_BASE + 'sigml/iTakeMug.sigml' // sinal de exemplo que vem com o CWASA (só para testar o avatar)

const C = () => (window as any).CWASA
const idle = new Set<() => void>()
let boot: Promise<void> | null = null

// O <div class="CWASAAvatar av0"> já tem de existir na página antes de chamar isto.
export function initAvatar(): Promise<void> {
  return (boot ??= new Promise<void>((resolve, reject) => {
    const fail = (m: string) => { boot = null; reject(new Error(m)) }
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = AV_BASE + 'cwa/cwasa.css'; document.head.appendChild(css)
    const sc = document.createElement('script'); sc.src = AV_BASE + 'cwa/allcsa.js'; sc.async = true
    sc.onerror = () => fail('Não foi possível carregar o avatar (CWASA). Verifica a Internet.')
    sc.onload = () => {
      const cw = C()
      if (!cw) return fail('O avatar (CWASA) não arrancou.')
      const timer = window.setTimeout(() => fail('O avatar demorou demasiado a carregar.'), 40000)
      try {
        cw.addHook?.('avatarready', () => { clearTimeout(timer); resolve() }, 0)
        cw.addHook?.('animidle', () => idle.forEach((f) => f()), 0)
        cw.init({
          jasBase: AV_BASE, sigmlBase: 'sigml', avJARBase: 'avatars', avJSONBase: 'avjson', useAvatarJARs: true,
          useClientConfig: false, animgenServer: null, ambIdle: false,
          avs: ['anna', 'marc', 'francoise'],
          avSettings: [{ width: 320, height: 400, avList: 'avs', initAv: 'anna', ambIdle: false }],
        })
      } catch (e) { clearTimeout(timer); fail('Erro ao iniciar o avatar: ' + (e as Error).message) }
    }
    document.head.appendChild(sc)
  }))
}

export const onAvatarIdle = (f: () => void) => { idle.add(f); return () => { idle.delete(f) } }
export const playSigml = (xml: string) => C()?.playSiGMLText(xml, 0)
export const playSigmlUrl = (url: string) => C()?.playSiGMLURL(url, 0)
export const stopAvatar = () => C()?.stopSiGML?.(0)
