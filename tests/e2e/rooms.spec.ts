import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Salas e2e contra el PROXY REAL del ecosistema:
//   A) round-trip del enlace de sala (sobre de aporte firmado + retract).
//   B) DOS navegadores: aportar → sync por gossip → BORRAR (tombstone firmado),
//      manejando la UI real y verificando lo que ve cada uno. Deja screenshots.
//
// Firmar requiere el vault de identidad (no fiable headless), así que inyectamos
// un VAULT DE PRUEBA: una clave ECDSA P-256 generada en el navegador, expuesta en
// `window.__TEST_VAULT_PROMISE__` (hook que `lib/identity.ts` usa solo en tests).

const BASE = process.env.E2E_BASE || 'https://localhost:5180'
const SHOT_DIR = path.resolve('test-results/rooms-2browser')

// Vault de prueba: replica el contrato del vault real (signData + me.publickey)
// con el MISMO formato de pubkey que reconstruye parseShareFragment/verifyBlob.
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
  // Reloj ANTES del torneo (sin partidos hoy/mañana) + tutorial ya visto: ni el
  // popup diario ni las burbujas se cruzan con los clicks de este spec.
  await context.addInitScript(`
    window.__MUNDIAL_TEST_NOW__ = ${Date.UTC(2026, 4, 1, 12)};
    try { localStorage.setItem('mundial.tutorial', '{"done":true}'); } catch (e) {}
  `)
}

// Siembra una sala compartida + un pronóstico propio en localStorage (evita el
// baile de crear/unirse por UI) y deja la sala activa.
async function seed (page: Page, roomId: string, nick: string) {
  await page.evaluate(async ({ roomId, nick }) => {
    const { defaultPrediction } = await import('/src/lib/prediction.ts')
    const { encodePrediction } = await import('/src/lib/codec.ts')
    const now = Date.now()
    const pred = { id: 'p1', name: 'Pronóstico de ' + nick, code: encodePrediction(defaultPrediction()), mine: true, official: false, updatedAt: now }
    localStorage.setItem('mundial.library.v1', JSON.stringify([pred]))
    const room = { id: roomId, name: 'Sala demo', mode: 'free', sealedUntil: 0, hostPubkey: '', hostNick: '', mine: false, createdAt: now, updatedAt: now, members: [] }
    localStorage.setItem('mundial.rooms.v1', JSON.stringify([room]))
    localStorage.setItem('mundial.activeRoomId.v1', roomId)
  }, { roomId, nick })
}

async function openRoomsSection (page: Page) {
  await page.click('[data-testid="sb-tab-rooms"]')
  await page.waitForSelector('.rtabs', { timeout: 15000 })
}
// Los miembros viven en la pestaña Posiciones (la tabla); una fila por miembro.
async function membersTab (page: Page) {
  await page.click('.rtabs button:nth-child(1)')
  await page.waitForTimeout(400)
}
async function contribute (page: Page) {
  page.on('dialog', (d) => d.accept())
  await page.click('.contribute .pick button.go')
  await page.waitForSelector('.mine-note', { timeout: 20000 })
}

test('round-trip de enlaces de sala: sobre de aporte firmado + retract', async ({ page, context }) => {
  test.setTimeout(40000)
  await installVault(context, 'Tester')
  await page.goto(BASE + '/')

  const r = await page.evaluate(async () => {
    const room = await import('/src/lib/room.ts')
    const share = await import('/src/lib/share.ts')
    const codec = await import('/src/lib/codec.ts')
    const pred = await import('/src/lib/prediction.ts')

    // Pronóstico firmado (con el vault de prueba) → frag → sobre de aporte.
    const code = codec.encodePrediction(pred.defaultPrediction())
    const { url } = await share.buildShareUrl(code, 'X')
    const frag = url.split('#')[1] as string
    const env = await room.buildMemberEnvelope('room-abc', frag, Date.now())
    const link = room.buildMemberContribUrl(env)
    const linkFrag = link.slice(link.indexOf('#') + 1)

    const parsed = room.parseMemberContrib(linkFrag)
    const m = parsed ? await room.memberFromEnvelope(parsed.env) : null

    // Retract (tombstone) firmado.
    const renv = await room.buildRetractEnvelope('room-abc', Date.now())
    const rm = await room.memberFromEnvelope(renv)

    return {
      kindMember: room.fragKind(linkFrag),
      contribRoomId: m?.roomId,
      contribVerified: m?.member.verified,
      contribDeleted: !!m?.member.deleted,
      contribHasCode: !!m?.member.code,
      retractRoomId: rm?.roomId,
      retractDeleted: !!rm?.member.deleted,
      retractVerified: rm?.member.verified,
    }
  })

  expect(r.kindMember).toBe('member')
  expect(r.contribRoomId).toBe('room-abc')
  expect(r.contribVerified).toBe(true)
  expect(r.contribDeleted).toBe(false)
  expect(r.contribHasCode).toBe(true)
  expect(r.retractRoomId).toBe('room-abc')
  expect(r.retractDeleted).toBe(true)
  expect(r.retractVerified).toBe(true)
})

test('dos navegadores: aportar → sync por gossip → borrar (tombstone firmado)', async ({ browser }, testInfo) => {
  test.setTimeout(90000)
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const roomId = 'e2e-' + Math.random().toString(36).slice(2, 8)

  const ctxA = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 820 } })
  const ctxB = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 820 } })
  await installVault(ctxA, 'Ana')
  await installVault(ctxB, 'Beto')
  const A = await ctxA.newPage()
  const B = await ctxB.newPage()

  const shot = async (page: Page, name: string) => {
    const file = path.join(SHOT_DIR, name + '.png')
    await page.screenshot({ path: file, fullPage: true })
    await testInfo.attach(name, { path: file, contentType: 'image/png' })
  }

  try {
    await A.goto(BASE + '/'); await seed(A, roomId, 'Ana'); await A.reload()
    await B.goto(BASE + '/'); await seed(B, roomId, 'Beto'); await B.reload()

    await openRoomsSection(A)
    await openRoomsSection(B)
    await A.waitForTimeout(5000) // conectar al proxy + descubrir peers

    await contribute(A)
    await contribute(B)
    await A.waitForTimeout(3500) // gossip

    await membersTab(A); await membersTab(B)
    await shot(A, '1-ana-tras-aportar')
    await shot(B, '2-beto-ve-a-ana')

    // Cada navegador debe ver a AMBOS miembros (la sala convergió por el proxy).
    await expect(B.locator('.lb .tbl tbody tr')).toHaveCount(2)
    await expect(A.locator('.lb .tbl tbody tr')).toHaveCount(2)

    // Ana borra su aporte → tombstone firmado que se propaga.
    await A.click('.mine-actions button.danger')
    await A.waitForTimeout(4000)
    await membersTab(B)
    await shot(A, '3-ana-tras-borrar')
    await shot(B, '4-beto-ya-no-ve-a-ana')

    // En Beto queda SOLO Beto (la lápida ocultó a Ana). En Ana vuelve a aparecer
    // el panel de "Contribuir".
    await expect(B.locator('.lb .tbl tbody tr')).toHaveCount(1)
    await expect(A.locator('.contribute')).toBeVisible()
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
