import { test, expect, type BrowserContext, type Page, type Browser } from '@playwright/test'
import { llaves, vaultInit, wireInit, type VaultKeys } from './_vault'

// NADA DEL USUARIO CRUZA EL PROXIO EN CLARO (CONVENCIONES §4.1).
//
// Por aquí salían el PRONÓSTICO de cada miembro de cada sala y las INVITACIONES con su
// URL y el apodo de quien invita. Iban firmados —lo que prueba quién los escribió—, pero
// firmar no es cifrar: el proxio enruta por pubkey y manda el payload tal cual, así que
// todo eso lo leía quien opera el proxio, que corre en un VPS alquilado.
//
// Esta suite no se fía de lo que la app le pasa al cliente: ESPÍA EL SOCKET en los dos
// navegadores —cada frame que sube y cada frame que baja— y busca ahí dentro el
// pronóstico, la invitación y los apodos. Si aparecen, falla.
//
// Y prueba el caso que de verdad cuesta: **el destinatario APAGADO**. Una invitación y un
// aporte se le escriben justo a quien no está mirando —para eso existe la cola de 24 h—,
// así que la llave de cifrado del otro no puede depender de tenerlo conectado: se anuncia
// firmada y el proxio la guarda (@dotrino/proxy-client >= 0.20.0).
//
// Va contra el PROXIO REAL, como `rooms.spec.ts`: es el único sitio donde se puede
// comprobar que la cola y el directorio de llaves se comportan como decimos.

const ROOM = 'sel' + Math.random().toString(36).slice(2, 8)
async function abrir (browser: Browser, nick: string, k: VaultKeys): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  await ctx.addInitScript(wireInit)
  await ctx.addInitScript(vaultInit(nick, k))
  await ctx.addInitScript(`
    window.__MUNDIAL_TEST_NOW__ = ${Date.UTC(2026, 4, 1, 12)};
    try { localStorage.setItem('mundial.tutorial', '{"done":true}'); } catch (e) {}
  `)
  const page = await ctx.newPage()
  await page.goto('/')
  return { ctx, page }
}

/** Conecta al proxio con la identidad del vault de prueba y devuelve mi pubkey. */
async function conectar (page: Page): Promise<string> {
  return page.evaluate(async () => {
    const conn = await import('/src/lib/connection.ts')
    await conn.ensureConnected()
    // El anuncio de la llave sale POR DETRÁS del identify (no bloquea, a propósito).
    for (let i = 0; i < 60 && !conn.getMyPublickey(); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 800))
    const pk = conn.getMyPublickey()
    if (!pk) throw new Error('no se pudo identificar contra el proxio')
    if (!conn.canSeal()) throw new Error('el cliente se quedó sin con qué sellar')
    return pk
  })
}

/**
 * APAGARSE de verdad: se cierra el socket y se le da al proxio el instante que necesita
 * para soltar la pubkey. Cerrar solo la pestaña no basta — mientras el servidor siga
 * creyendo que estás conectado, lo que te manden se entrega a un socket muerto en vez de
 * encolarse, y eso no es «apagado», es «perdido».
 */
async function apagar (p: { ctx: BrowserContext; page: Page }) {
  await p.page.evaluate(async () => {
    const conn = await import('/src/lib/connection.ts')
    conn.getProxyClient().close()
  })
  await p.page.waitForTimeout(1500)
  await p.ctx.close()
}

/** Todo el cable de esta pestaña, como un solo texto. */
const cable = (page: Page) => page.evaluate(() => (window as any).__CABLE__.join('\n') as string)

test.describe('el proxio no ve nada del usuario', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 })

  test('dos miembros sincronizan una sala y en el cable no hay pronóstico', async ({ browser }) => {
    const kA = await llaves()
    const kB = await llaves()
    const A = await abrir(browser, 'anfitriona', kA)
    const B = await abrir(browser, 'invitado', kB)

    const pkA = await conectar(A.page)
    const pkB = await conectar(B.page)
    expect(pkA).not.toEqual(pkB)

    // B escucha la sala; sus miembros conocidos son A.
    await B.page.evaluate(async ({ room, pkA }) => {
      const { RoomSync } = await import('/src/lib/roomSync.ts')
      const w = window as any
      w.__RECIBIDOS__ = []
      w.__SIN_SELLAR__ = []
      w.__sync = new RoomSync(room, null, {
        onPrediction: (env: string) => w.__RECIBIDOS__.push(env),
        memberPubkeys: () => [pkA],
        allEnvelopes: () => [],
        onUnreachable: (pk: string, code: string) => w.__SIN_SELLAR__.push({ pk, code }),
      })
      await w.__sync.start()
    }, { room: ROOM, pkA })

    // A aporta su pronóstico REAL (sobre firmado por su vault) y lo difunde.
    const envA: string = await A.page.evaluate(async ({ room, pkB }) => {
      const { buildMemberEnvelope } = await import('/src/lib/room.ts')
      const { defaultPrediction } = await import('/src/lib/prediction.ts')
      const { encodePrediction } = await import('/src/lib/codec.ts')
      const { buildShareUrl } = await import('/src/lib/share.ts')
      const { RoomSync } = await import('/src/lib/roomSync.ts')
      const code = encodePrediction(defaultPrediction())
      const { url } = await buildShareUrl(code, 'Pronostico de la anfitriona')
      const frag = url.split('#')[1]
      const env = await buildMemberEnvelope(room, frag, Date.now())
      const w = window as any
      w.__SIN_SELLAR__ = []
      w.__sync = new RoomSync(room, env, {
        onPrediction: () => {},
        memberPubkeys: () => [pkB],
        allEnvelopes: () => [env],
        onUnreachable: (pk: string, code2: string) => w.__SIN_SELLAR__.push({ pk, code: code2 }),
      })
      await w.__sync.start()
      return env
    }, { room: ROOM, pkB })

    // B lo recibe, y lo recibe VERIFICABLE: el sobre abre y es de A.
    await expect.poll(
      () => B.page.evaluate(() => (window as any).__RECIBIDOS__.length),
      { timeout: 30000 }
    ).toBeGreaterThan(0)

    const leido = await B.page.evaluate(async () => {
      const { memberFromEnvelope } = await import('/src/lib/room.ts')
      const env = (window as any).__RECIBIDOS__[0]
      const p = await memberFromEnvelope(env)
      return { roomId: p?.roomId, pubkey: p?.member?.publickey, verified: p?.member?.verified, env }
    })
    expect(leido.roomId).toBe(ROOM)
    expect(leido.verified).toBe(true)
    expect(leido.pubkey).toBe(pkA)
    expect(leido.env).toBe(envA)

    // A nadie se le quedó sin sellar (los dos anunciaron su llave).
    expect(await A.page.evaluate(() => (window as any).__SIN_SELLAR__)).toEqual([])
    expect(await B.page.evaluate(() => (window as any).__SIN_SELLAR__)).toEqual([])

    // EL CABLE, EN LOS DOS EXTREMOS: ni el sobre, ni el tipo del mensaje, ni el apodo.
    for (const [quien, page] of [['A', A.page], ['B', B.page]] as const) {
      const texto = await cable(page)
      expect(texto.length, quien + ': el espía tiene que haber grabado algo').toBeGreaterThan(100)
      expect(texto, quien + ': el sobre del pronóstico no puede viajar en claro').not.toContain(envA)
      expect(texto, quien).not.toContain('ROOM_PREDICTION')
      expect(texto, quien).not.toContain('ROOM_REQUEST')
      expect(texto, quien).not.toContain('anfitriona')
      expect(texto, quien).not.toContain('invitado')
    }

    await A.ctx.close(); await B.ctx.close()
  })

  test('el destinatario APAGADO: la invitación espera en la cola y llega sellada', async ({ browser }) => {
    const kA = await llaves()
    const kB = await llaves()

    // B pasa una vez por el proxio: lo justo para ANUNCIAR su llave de cifrado. Y se va.
    const B1 = await abrir(browser, 'quien-esta-apagado', kB)
    const pkB = await conectar(B1.page)
    await apagar(B1)

    // A invita a alguien que NO está. Nunca se han emparejado: la llave se averigua.
    const A = await abrir(browser, 'quien-invita', kA)
    await conectar(A.page)
    const urlSala = `https://pronostico.dotrino.com/#room=BLOB-DE-LA-SALA-${ROOM}`
    const salida = await A.page.evaluate(async ({ pkB, urlSala }) => {
      const { sendRoomInvites } = await import('/src/lib/inbox.ts')
      return sendRoomInvites([pkB], urlSala)
    }, { pkB, urlSala })
    expect(salida.sent).toBe(1)
    expect(salida.failed).toEqual([])

    const cableA = await cable(A.page)
    expect(cableA, 'la URL de la sala no puede viajar en claro').not.toContain(urlSala)
    expect(cableA).not.toContain('ROOM_INVITE')
    expect(cableA).not.toContain('quien-invita')

    // B se enciende: la cola se drena y la invitación se abre.
    const B2 = await abrir(browser, 'quien-esta-apagado', kB)
    await B2.page.evaluate(async () => {
      const { RoomInbox } = await import('/src/lib/inbox.ts')
      const w = window as any
      w.__INV__ = []
      w.__buzon = new RoomInbox((inv: any) => w.__INV__.push(inv))
      await w.__buzon.start()
    })
    await expect.poll(
      () => B2.page.evaluate(() => (window as any).__INV__.length),
      { timeout: 45000 }
    ).toBe(1)
    const inv = await B2.page.evaluate(() => (window as any).__INV__[0])
    expect(inv.url).toBe(urlSala)
    expect(inv.nick).toBe('quien-invita')

    const cableB = await cable(B2.page)
    expect(cableB, 'tampoco al bajar de la cola').not.toContain(urlSala)
    expect(cableB).not.toContain('ROOM_INVITE')

    await A.ctx.close(); await B2.ctx.close()
  })

  test('a quien NUNCA anunció llave no se le manda nada — y se dice cuál es el fallo', async ({ browser }) => {
    const kA = await llaves()
    const kNadie = await llaves()
    const A = await abrir(browser, 'quien-invita', kA)
    await conectar(A.page)

    const pkNadie = JSON.stringify({ kty: 'EC', crv: 'P-256', x: kNadie.sigPub.x, y: kNadie.sigPub.y, ext: true })
    const urlSala = 'https://pronostico.dotrino.com/#room=NO-DEBE-SALIR-' + ROOM
    const salida = await A.page.evaluate(async ({ pk, urlSala }) => {
      const { sendRoomInvites } = await import('/src/lib/inbox.ts')
      return sendRoomInvites([pk], urlSala)
    }, { pk: pkNadie, urlSala })

    expect(salida.sent).toBe(0)
    expect(salida.failed).toHaveLength(1)
    // POR `code`, nunca por la frase: «no tengo su llave» y «se cayó la red» se arreglan
    // de formas distintas, y verlos iguales manda a quien depura al camino equivocado.
    expect(salida.failed[0].code).toBe('no-encpub')

    const texto = await cable(A.page)
    expect(texto, 'no puede caer al camino en claro').not.toContain(urlSala)
    expect(texto).not.toContain('ROOM_INVITE')
    // Lo único que salió fue la PREGUNTA por la llave.
    expect(texto).toContain('enc-lookup')

    await A.ctx.close()
  })
})
