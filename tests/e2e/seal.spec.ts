import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// Sellado PERSISTENTE del pronóstico: máquina de estados de la franja
// none → (Sellar) sealed → (editar) stale → (Cancelar edición) sealed.
//
// Firmar/sellar requiere identidad (no fiable headless): se inyecta el mismo
// vault de prueba de rooms.spec. El SELLADOR se mockea por interceptación de
// red — requestSeal no verifica la firma del TSA al pedirla, así que una firma
// inventada alcanza para probar el ciclo de vida en la UI.

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

async function installVault (context: BrowserContext, nick: string) {
  await context.addInitScript(vaultInit(nick))
}

// Mock del sellador: responde el preflight CORS y devuelve { op, ts, signature }
// con una firma inventada de 64 bytes. Cuenta los sellos pedidos.
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

// Crea un pronóstico propio (manual, grupos + llaves), como en app.spec.ts.
async function createOwnPrediction (page: Page): Promise<void> {
  await page.goto('/')
  const menu = page.getByTestId('menu-btn')
  if (await menu.isVisible()) await menu.click()
  await page.getByTestId('sb-new').click()
  await page.getByTestId('type-picker').waitFor()
  await page.getByTestId('type-manual').click()
  await page.getByTestId('scope-all').click()
}

// Sella desde la franja, pasando el aviso de pronóstico incompleto (un
// pronóstico de este test siempre está incompleto, igual que al compartir).
async function sealFromBar (page: Page): Promise<void> {
  await page.getByTestId('seal-btn').click()
  const warn = page.getByTestId('warn-incomplete')
  await warn.waitFor({ timeout: 5000 })
  await warn.locator('.warn-go').click()
}

test('ciclo de sellado: sellar → editar (obsoleto) → cancelar edición recupera el sello', async ({ page, context }) => {
  test.setTimeout(60000)
  await installVault(context, 'Selladora')
  const signer = await mockSigner(page)
  await createOwnPrediction(page)

  // Estado inicial: sin sello, la franja invita a sellar.
  const bar = page.getByTestId('seal-bar')
  await expect(bar).toBeVisible()
  await expect(page.getByTestId('seal-btn')).toBeVisible()
  await expect(bar).not.toHaveClass(/sealed|stale/)

  // Sellar (con aviso de incompleto en el medio, como compartir).
  await sealFromBar(page)
  await expect(bar).toHaveClass(/sealed/, { timeout: 10000 })
  await expect(page.getByTestId('seal-status')).toContainText(/Sellado el|Sealed on/)
  expect(signer.count()).toBe(1)

  // Editar: elegir un ganador en las llaves cambia el código → sello obsoleto.
  await page.getByTestId('tab-llaves').click()
  const side = page.locator('.match .side.clickable').first()
  await side.click()
  await expect(bar).toHaveClass(/stale/)
  await expect(page.getByTestId('seal-cancel-edit')).toBeVisible()

  // Cancelar la edición: vuelve al pronóstico sellado (el pick se revierte).
  await page.getByTestId('seal-cancel-edit').click()
  await expect(bar).toHaveClass(/sealed/)
  await expect(page.locator('.match .side.picked')).toHaveCount(0)

  // El sello persiste tras recargar (queda guardado con el pronóstico).
  await page.reload()
  await expect(page.getByTestId('seal-bar')).toHaveClass(/sealed/, { timeout: 10000 })

  // Editar de nuevo y RE-sellar: pide un sello nuevo al sellador.
  await page.getByTestId('tab-llaves').click()
  await page.locator('.match .side.clickable').first().click()
  await expect(page.getByTestId('seal-bar')).toHaveClass(/stale/)
  await sealFromBar(page)
  await expect(page.getByTestId('seal-bar')).toHaveClass(/sealed/, { timeout: 10000 })
  // La ruta mockeada sobrevive al reload: re-sellar es el SEGUNDO sello pedido
  // (cancelar edición y recargar reutilizan el guardado, no piden ninguno).
  expect(signer.count()).toBe(2)
})
