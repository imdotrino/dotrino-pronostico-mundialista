// Analítica de tráfico COOKIELESS y autohosteada (GoatCounter en
// goat.dotrino.com): agregados, sin cookies ni datos personales, tus datos en
// tu server (coherente con la ideología Dotrino).
//
// Solo cuenta en PRODUCCIÓN (pronostico.dotrino.com): nunca en dev/local, LAN ni
// previews. Carga el script de forma diferida, sin bloquear el arranque.

const PROD_HOST = 'pronostico.dotrino.com'
const GOATCOUNTER = 'https://goat.dotrino.com'

interface GoatCounter { count: (vars: { path: string; title?: string; event?: boolean }) => void }
function gc (): GoatCounter | null {
  const g = (window as unknown as { goatcounter?: GoatCounter }).goatcounter
  return g && typeof g.count === 'function' ? g : null
}

function enabled (): boolean {
  return typeof window !== 'undefined' && location.hostname === PROD_HOST
}

// Como goat.dotrino.com es compartido por varias apps del ecosistema, los
// paths deben llevar el dominio por delante (p. ej. `pronostico.dotrino.com/tab/x`)
// para distinguir a qué app pertenece cada link en el dashboard.
function withDomain (path: string): string {
  return `${PROD_HOST}/${path.replace(/^\/+/, '')}`
}

export function initAnalytics (): void {
  if (!enabled()) return
  // Definido ANTES de cargar count.js: el callback `path` prefija el dominio en
  // los pageviews automáticos. Se conserva al inicializarse GoatCounter.
  ;(window as unknown as { goatcounter?: { path: (p: string) => string } }).goatcounter = {
    path: (p: string) => withDomain(p),
  }
  const s = document.createElement('script')
  s.async = true
  s.src = `${GOATCOUNTER}/count.js`
  s.setAttribute('data-goatcounter', `${GOATCOUNTER}/count`)
  document.head.appendChild(s)
}

/**
 * Registra un EVENTO (no pageview) en GoatCounter: navegación por sección/tab,
 * acciones, etc. No-op fuera de producción o si el script aún no cargó.
 */
export function trackEvent (path: string, title?: string): void {
  if (!enabled()) return
  const g = gc()
  if (g) g.count({ path: withDomain(path), title: title ?? path, event: true })
}
