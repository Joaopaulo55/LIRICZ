import { useEffect } from 'react'

// Sequência: LIRICz → ênfase no "z" → créditos → volta só LIRICz → entra na app. Toque para saltar.
export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(onDone, reduced ? 1200 : 5400)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="splash" onClick={onDone} role="img" aria-label="LIRICz, por JP, João Francisco Vica Paulo, para Zelina">
      <h1 className="wm" aria-hidden="true">
        {'LIRIC'.split('').map((c, i) => <span key={i} style={{ animationDelay: `${i * 110}ms` }}>{c}</span>)}
        <span className="z">z</span>
      </h1>
      <p className="by" aria-hidden="true">
        <span style={{ animationDelay: '2000ms' }}>BY JP</span>
        <span style={{ animationDelay: '2350ms' }}>JOAO FRANCISCO VICA PAULO</span>
        <span style={{ animationDelay: '2800ms' }}>FOR ZELINA</span>
      </p>
    </div>
  )
}
