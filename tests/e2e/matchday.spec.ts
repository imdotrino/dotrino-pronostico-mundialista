import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// Pronóstico de la FECHA: popup diario con los partidos de hoy, sellado por
// partido y sección "La fecha" para ver/editar lo no jugado.
//
// El reloj de matchday.ts es inyectable (__MUNDIAL_TEST_NOW__): se fija un
// "hoy" en plena fase de grupos (15-jun-2026) para que el fixture del día sea
// determinista. El vault y el sellador se mockean como en seal.spec.ts.

// 15-jun-2026 08:00 en Guayaquil (UTC-5) → 13:00Z. Ese día (local) juegan
// ESP-CPV (17:00Z), BEL-EGY y KSA-URU (22:00Z) e IRN-NZL (16-jun 04:00Z =
// 23:00 local del 15): todos en el futuro → pronosticables.
const FAKE_NOW = Date.parse('2026-06-15T13:00:00Z')
const TZ = 'America/Guayaquil'

const vaultInit = (nick: string) => `
window.__TEST_VAULT_PROMISE__ = (async () => {
  const kp = await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify']);
  const j = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const pub = JSON.stringify({ kty:'EC', crv:'P-256', x:j.x, y:j.y, ext:true });
  const canon = (v) => (v===null||typeof v!=='object') ? JSON.stringify(v)
    : Array.isArray(v) ? '['+v.map(canon).join(',')+']'
    : '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
  let nickname = ${JSON.stringify(nick)};
  return {
    me: { publickey: pub, nickname },
    async signData(data){
      const sig = new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, kp.privateKey, new TextEncoder().encode(canon(data))));
      let s=''; for(const b of sig) s+=String.fromCharCode(b);
      return { signature: btoa(s), publickey: pub };
    },
    async listContacts(){ return []; },
    async setMyNickname(a){ nickname = (a && a.nickname) || nickname; this.me.nickname = nickname; },
  };
})();`

async function setupContext (context: BrowserContext) {
  await context.addInitScript(vaultInit('Probadora'))
  await context.addInitScript(`
    window.__MUNDIAL_TEST_NOW__ = ${FAKE_NOW};
    // Tutorial ya visto: el popup diario no compite con él en la primera visita.
    try { localStorage.setItem('mundial.tutorial', '{"done":true}'); } catch (e) {}
  `)
}

// Mock del sellador (TSA): firma inventada; requestSeal no verifica al pedir.
async function mockSigner (page: Page): Promise<{ count: () => number }> {
  let n = 0
  await page.route('https://signer.dotrino.com/seal', async (route) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    n++
    const sig = btoa(String.fromCharCode(...new Uint8Array(64).fill(7)))
    await route.fulfill({
      headers: { ...cors, 'Content-Type': 'application/json' },
      json: { op: 'seal', ts: Date.now(), signature: sig },
    })
  })
  return { count: () => n }
}

// El relay de resultados no está en los tests: que falle rápido y en silencio.
async function mockResultsOffline (page: Page) {
  await page.route('https://results.dotrino.com/**', (route) => route.abort())
}

test.use({ timezoneId: TZ })

test('el popup diario ofrece los partidos de hoy y sella cada pick', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: TZ })
  await setupContext(context)
  const page = await context.newPage()
  const signer = await mockSigner(page)
  await mockResultsOffline(page)

  await page.goto('/')

  // Popup del día: aparece solo (visita limpia + partidos de hoy sin pick).
  const popup = page.getByTestId('daily-popup')
  await popup.waitFor({ timeout: 15_000 })
  const rows = page.getByTestId('daily-popup-match')
  expect(await rows.count()).toBeGreaterThanOrEqual(3)

  // Pronostica los dos primeros partidos de hoy.
  await rows.nth(0).getByTestId('daily-gh').fill('2')
  await rows.nth(0).getByTestId('daily-ga').fill('0')
  await rows.nth(1).getByTestId('daily-gh').fill('1')
  await rows.nth(1).getByTestId('daily-ga').fill('1')

  await page.getByTestId('daily-popup-save').click()
  await page.getByTestId('daily-popup-done').waitFor()
  await expect(page.getByTestId('daily-popup-done')).toContainText('✓')
  expect(signer.count()).toBe(2) // un sello POR PARTIDO guardado

  // Tras guardar sin fallas, el popup se cierra SOLO (muestra el ✓ un instante).
  await expect(popup).toBeHidden({ timeout: 5_000 })

  // Mientras queden partidos sin pick, el popup INSISTE en cada recarga.
  await page.reload()
  await page.getByTestId('daily-popup').waitFor({ timeout: 15_000 })

  await context.close()
})

test('la sección La fecha lista, edita y sella los partidos no jugados', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: TZ })
  await setupContext(context)
  const page = await context.newPage()
  const signer = await mockSigner(page)
  await mockResultsOffline(page)

  await page.goto('/')

  // Cierra el popup si salió y navega a la sección por la barra lateral.
  const later = page.getByTestId('daily-popup-later')
  try { await later.click({ timeout: 12_000 }) } catch { /* sin partidos hoy: no popup */ }
  const menu = page.getByTestId('menu-btn')
  if (await menu.isVisible()) await menu.click()
  await page.getByTestId('sb-tab-fecha').click()

  await page.getByTestId('matchday-page').waitFor()
  const rows = page.getByTestId('daily-row')
  expect(await rows.count()).toBeGreaterThan(10) // quedan fechas por jugar

  // Edita el primer partido editable: marcador 3-1 → se guarda y se sella solo.
  const first = rows.first()
  await first.getByTestId('daily-row-gh').fill('3')
  await first.getByTestId('daily-row-ga').fill('1')
  await expect(first.getByTestId('daily-row-seal')).toContainText('🕓', { timeout: 10_000 })
  expect(signer.count()).toBe(1)

  // El total de pronosticados se refleja en la cabecera.
  await expect(page.getByTestId('matchday-page')).toContainText('1', { useInnerText: true })

  await context.close()
})
