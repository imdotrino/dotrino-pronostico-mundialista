// Demo de 2 navegadores contra el proxy real: aportar → sync (gossip) → borrar
// (tombstone firmado). Inyecta un vault de prueba (clave ECDSA en la página) y
// maneja la UI por selectores CSS. Saca screenshots en cada paso.
//
//   node tests/manual/two-browser-demo.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.E2E_BASE || 'https://localhost:5181'
const OUT = '/tmp/rooms-demo'
const roomId = 'demo-' + Math.random().toString(36).slice(2, 8)

const vaultInit = (nick) => `
window.__TEST_VAULT_PROMISE__ = (async () => {
  const kp = await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify']);
  const j = await crypto.subtle.exportKey('jwk', kp.publicKey);
  // Mismo orden de campos que reconstruye parseShareFragment/verifyBlob, para que
  // me.publickey === member.publickey (si no, myMember no matchea).
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

async function seed (page, nick) {
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

async function openRoomsSection (page) {
  await page.click('[data-testid="sb-tab-rooms"]')
  await page.waitForSelector('.rtabs', { timeout: 15000 })
}

async function contribute (page, who) {
  page.on('dialog', (d) => d.accept())
  await page.waitForSelector('.contribute .pick button.go', { timeout: 15000 })
  await page.click('.contribute .pick button.go')
  try {
    await page.waitForSelector('.mine-note', { timeout: 15000 })
  } catch (e) {
    const err = await page.locator('.contribute .err').textContent().catch(() => null)
    console.log(`[${who}] mine-note no apareció. contribError =`, JSON.stringify(err))
    await page.screenshot({ path: `${OUT}/debug-${who}.png`, fullPage: true })
    throw e
  }
}

async function showMembers (page) {
  await page.click('.rtabs button:nth-child(3)') // pestaña Miembros
  await page.waitForTimeout(500)
}

const shots = []
async function shot (page, name) {
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path, fullPage: true })
  shots.push(path)
  console.log('shot', path)
}

const browserA = await chromium.launch()
const browserB = await chromium.launch()
try {
  const ctxA = await browserA.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 820 } })
  const ctxB = await browserB.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 820 } })
  await ctxA.addInitScript(vaultInit('Ana'))
  await ctxB.addInitScript(vaultInit('Beto'))
  const A = await ctxA.newPage()
  const B = await ctxB.newPage()
  A.on('console', (m) => console.log('A>', m.type(), m.text()))
  A.on('pageerror', (e) => console.log('A pageerror:', e.message))
  B.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('B>', m.type(), m.text()) })

  await A.goto(BASE + '/'); await seed(A, 'Ana'); await A.reload()
  await B.goto(BASE + '/'); await seed(B, 'Beto'); await B.reload()

  await openRoomsSection(A)
  await openRoomsSection(B)
  console.log('ambos en la sala; esperando descubrimiento de peers…')
  await A.waitForTimeout(5000) // conectar al proxy + listarse mutuamente

  console.log('Ana aporta…')
  await contribute(A, 'ana')
  console.log('Beto aporta…')
  await contribute(B, 'beto')

  await A.waitForTimeout(3500) // gossip
  await showMembers(A); await showMembers(B)
  await shot(A, '1-ana-tras-aportar')
  await shot(B, '2-beto-ve-a-ana')

  console.log('Ana borra su aporte (tombstone firmado)…')
  await A.click('.mine-actions button.danger')
  await A.waitForTimeout(3500) // propagación del tombstone
  await showMembers(B)
  await shot(A, '3-ana-tras-borrar')
  await shot(B, '4-beto-ya-no-ve-a-ana')

  console.log('OK; screenshots en', OUT)
} catch (e) {
  console.error('FALLO:', e && e.message)
  process.exitCode = 1
} finally {
  await browserA.close()
  await browserB.close()
}
