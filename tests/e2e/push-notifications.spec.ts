import { test, expect, chromium } from '@playwright/test'

// Verifica el handler de Web Push del Service Worker desplegado: el archivo
// dotrino-push-sw.js (inyectado en el SW de Workbox vía importScripts)
// debe disparar `cc-push-ring` al recibir un push.
//
// LÍMITE: Chromium automatizado NO puede crear una PushSubscription
// (pushManager.subscribe → "permission denied", falta la API key de GCM) ni
// recibir un push real de FCM. Entregamos el push directamente al SW con CDP
// `ServiceWorker.deliverPushMessage` (lo mismo que el botón "Push" de DevTools).
//
// Corre contra el sitio DESPLEGADO (cert válido): un preview local con cert
// autofirmado impide registrar el SW en headless. Default: pronostico.dotrino.com.
const SITE = process.env.SITE_URL || 'https://pronostico.dotrino.com'

test('SW: el handler de push desplegado dispara cc-push-ring', async () => {
  test.setTimeout(90_000)
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  await ctx.grantPermissions(['notifications'], { origin: SITE })
  const page = await ctx.newPage()
  await page.goto(SITE, { waitUntil: 'domcontentloaded' })

  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.evaluate(() => {
    ;(window as unknown as { __rings: unknown[] }).__rings = []
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if (e.data && e.data.type === 'cc-push-ring') {
        ;(window as unknown as { __rings: unknown[] }).__rings.push(e.data)
      }
    })
  })

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('ServiceWorker.enable')
  let registrationId: string | null = null
  cdp.on('ServiceWorker.workerRegistrationUpdated', (ev: { registrations?: { scopeURL?: string; registrationId: string }[] }) => {
    for (const r of ev.registrations || []) {
      if (r.scopeURL && r.scopeURL.includes(new URL(SITE).host)) registrationId = r.registrationId
    }
  })
  await page.waitForTimeout(1500)
  expect(registrationId, 'no se encontró el registrationId del SW').not.toBeNull()

  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: SITE,
    registrationId: registrationId as unknown as string,
    data: JSON.stringify({ type: 'ring', ts: Date.now() })
  })

  await expect.poll(
    async () => (await page.evaluate(() => (window as unknown as { __rings: unknown[] }).__rings.length)),
    { timeout: 10_000, message: 'el SW no posteó cc-push-ring' }
  ).toBeGreaterThan(0)

  await browser.close()
})
