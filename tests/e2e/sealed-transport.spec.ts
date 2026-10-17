import { test, expect, type BrowserContext, type Page, type Browser } from '@playwright/test'
import { makeKeys, vaultInit, wireInit, type VaultKeys } from './_vault'

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
async function openPage (browser: Browser, nick: string, k: VaultKeys): Promise<{ ctx: BrowserContext; page: Page }> {
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
async function connect (page: Page): Promise<string> {
  return page.evaluate(async () => {
    const conn = await import('/src/lib/connection.ts')
    await conn.ensureConnected()
    // El anuncio de la llave sale POR DETRÁS del identify (no bloquea, a propósito).
    for (let i = 0; i < 60 && !conn.getMyPublickey(); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 800))
    const pk = conn.getMyPublickey()
    if (!pk) throw new Error('could not identify against the proxy')
    if (!conn.canSeal()) throw new Error('the client has nothing to seal with')
    return pk
  })
}

/**
 * APAGARSE de verdad: se cierra el socket y se le da al proxio el instante que necesita
 * para soltar la pubkey. Cerrar solo la pestaña no basta — mientras el servidor siga
 * creyendo que estás conectado, lo que te manden se entrega a un socket muerto en vez de
 * encolarse, y eso no es «apagado», es «perdido».
 */
async function shutDown (p: { ctx: BrowserContext; page: Page }) {
  await p.page.evaluate(async () => {
    const conn = await import('/src/lib/connection.ts')
    conn.getProxyClient().close()
  })
  await p.page.waitForTimeout(1500)
  await p.ctx.close()
}

/** Todo el cable de esta pestaña, como un solo texto. */
const wireText = (page: Page) => page.evaluate(() => (window as any).__WIRE__.join('\n') as string)

test.describe('el proxio no ve nada del usuario', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 })

  test('dos miembros sincronizan una sala y en el cable no hay pronóstico', async ({ browser }) => {
    const kA = await makeKeys()
    const kB = await makeKeys()
    const A = await openPage(browser, 'anfitriona', kA)
    const B = await openPage(browser, 'invitado', kB)

    const pkA = await connect(A.page)
    const pkB = await connect(B.page)
    expect(pkA).not.toEqual(pkB)

    // B escucha la sala; sus miembros conocidos son A.
    await B.page.evaluate(async ({ room, pkA }) => {
      const { RoomSync } = await import('/src/lib/roomSync.ts')
      const w = window as any
      w.__RECEIVED__ = []
      w.__UNSEALED__ = []
      w.__sync = new RoomSync(room, null, {
        onPrediction: (env: string) => w.__RECEIVED__.push(env),
        memberPubkeys: () => [pkA],
        allEnvelopes: () => [],
        onUnreachable: (pk: string, code: string) => w.__UNSEALED__.push({ pk, code }),
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
      w.__UNSEALED__ = []
      w.__sync = new RoomSync(room, env, {
        onPrediction: () => {},
        memberPubkeys: () => [pkB],
        allEnvelopes: () => [env],
        onUnreachable: (pk: string, code2: string) => w.__UNSEALED__.push({ pk, code: code2 }),
      })
      await w.__sync.start()
      return env
    }, { room: ROOM, pkB })

    // B lo recibe, y lo recibe VERIFICABLE: el sobre abre y es de A.
    await expect.poll(
      () => B.page.evaluate(() => (window as any).__RECEIVED__.length),
      { timeout: 30000 }
    ).toBeGreaterThan(0)

    const opened = await B.page.evaluate(async () => {
      const { memberFromEnvelope } = await import('/src/lib/room.ts')
      const env = (window as any).__RECEIVED__[0]
      const p = await memberFromEnvelope(env)
      return { roomId: p?.roomId, pubkey: p?.member?.publickey, verified: p?.member?.verified, env }
    })
    expect(opened.roomId).toBe(ROOM)
    expect(opened.verified).toBe(true)
    expect(opened.pubkey).toBe(pkA)
    expect(opened.env).toBe(envA)

    // A nadie se le quedó sin sellar (los dos anunciaron su llave).
    expect(await A.page.evaluate(() => (window as any).__UNSEALED__)).toEqual([])
    expect(await B.page.evaluate(() => (window as any).__UNSEALED__)).toEqual([])

    // EL CABLE, EN LOS DOS EXTREMOS: ni el sobre, ni el tipo del mensaje, ni el apodo.
    for (const [who, page] of [['A', A.page], ['B', B.page]] as const) {
      const wire = await wireText(page)
      expect(wire.length, who + ': el espía tiene que haber grabado algo').toBeGreaterThan(100)
      expect(wire, who + ': el sobre del pronóstico no puede viajar en claro').not.toContain(envA)
      expect(wire, who).not.toContain('ROOM_PREDICTION')
      expect(wire, who).not.toContain('ROOM_REQUEST')
      expect(wire, who).not.toContain('anfitriona')
      expect(wire, who).not.toContain('invitado')
    }

    await A.ctx.close(); await B.ctx.close()
  })

  test('el destinatario APAGADO: la invitación espera en la cola y llega sellada', async ({ browser }) => {
    const kA = await makeKeys()
    const kB = await makeKeys()

    // B pasa una vez por el proxio: lo justo para ANUNCIAR su llave de cifrado. Y se va.
    const B1 = await openPage(browser, 'quien-esta-apagado', kB)
    const pkB = await connect(B1.page)
    await shutDown(B1)

    // A invita a alguien que NO está. Nunca se han emparejado: la llave se averigua.
    const A = await openPage(browser, 'quien-invita', kA)
    await connect(A.page)
    const roomUrl = `https://pronostico.dotrino.com/#room=BLOB-DE-LA-SALA-${ROOM}`
    const result = await A.page.evaluate(async ({ pkB, roomUrl }) => {
      const { sendRoomInvites } = await import('/src/lib/inbox.ts')
      return sendRoomInvites([pkB], roomUrl)
    }, { pkB, roomUrl })
    expect(result.sent).toBe(1)
    expect(result.failed).toEqual([])

    const wireA = await wireText(A.page)
    expect(wireA, 'la URL de la sala no puede viajar en claro').not.toContain(roomUrl)
    expect(wireA).not.toContain('ROOM_INVITE')
    expect(wireA).not.toContain('quien-invita')

    // B se enciende: la cola se drena y la invitación se abre.
    const B2 = await openPage(browser, 'quien-esta-apagado', kB)
    await B2.page.evaluate(async () => {
      const { RoomInbox } = await import('/src/lib/inbox.ts')
      const w = window as any
      w.__INVITES__ = []
      w.__inbox = new RoomInbox((inv: any) => w.__INVITES__.push(inv))
      await w.__inbox.start()
    })
    await expect.poll(
      () => B2.page.evaluate(() => (window as any).__INVITES__.length),
      { timeout: 45000 }
    ).toBe(1)
    const inv = await B2.page.evaluate(() => (window as any).__INVITES__[0])
    expect(inv.url).toBe(roomUrl)
    expect(inv.nick).toBe('quien-invita')

    const wireB = await wireText(B2.page)
    expect(wireB, 'tampoco al bajar de la cola').not.toContain(roomUrl)
    expect(wireB).not.toContain('ROOM_INVITE')

    await A.ctx.close(); await B2.ctx.close()
  })

  test('dos desconocidos de la misma sala se descubren por el SALUDO y se sellan', async ({ browser }) => {
    // Sin creador y sin miembros conocidos: lo único que comparten es el canal, que solo
    // lista TOKENS. De quién es cada uno lo dice el saludo del transporte (`helloTo`),
    // que solo lleva una llave pública — la misma que el proxio ya tiene atada a esa
    // conexión. A partir de ahí ya hay una identidad a la que sellarle.
    const room = ROOM + '-hola'
    const A = await openPage(browser, 'ana', await makeKeys())
    const B = await openPage(browser, 'beto', await makeKeys())

    const start = (p: { page: Page }, nick: string) => p.page.evaluate(async ({ room, nick }) => {
      const { RoomSync } = await import('/src/lib/roomSync.ts')
      const { buildMemberEnvelope } = await import('/src/lib/room.ts')
      const { defaultPrediction } = await import('/src/lib/prediction.ts')
      const { encodePrediction } = await import('/src/lib/codec.ts')
      const { buildShareUrl } = await import('/src/lib/share.ts')
      const { url } = await buildShareUrl(encodePrediction(defaultPrediction()), 'P de ' + nick)
      const env = await buildMemberEnvelope(room, url.split('#')[1] as string, Date.now())
      const w = window as any
      w.__R__ = []
      w.__sync = new RoomSync(room, env, {
        onPrediction: (e: string) => w.__R__.push(e),
        memberPubkeys: () => [],        // NADIE conocido: ni miembros ni creador
        allEnvelopes: () => [env],
      })
      await w.__sync.start()
      return env
    }, { room, nick })

    await connect(A.page); await connect(B.page)
    const envA = await start(A, 'ana')
    const envB = await start(B, 'beto')

    await expect.poll(() => A.page.evaluate(() => (window as any).__R__.length), { timeout: 30000 }).toBeGreaterThan(0)
    await expect.poll(() => B.page.evaluate(() => (window as any).__R__.length), { timeout: 30000 }).toBeGreaterThan(0)
    expect(await A.page.evaluate(() => (window as any).__R__)).toContain(envB)
    expect(await B.page.evaluate(() => (window as any).__R__)).toContain(envA)

    // El saludo lleva una llave pública y nada más: el sobre sigue sin asomar.
    for (const [who, page] of [['A', A.page], ['B', B.page]] as const) {
      const wire = await wireText(page)
      expect(wire, who).not.toContain(envA)
      expect(wire, who).not.toContain(envB)
      expect(wire, who).not.toContain('ROOM_PREDICTION')
    }

    await A.ctx.close(); await B.ctx.close()
  })

  test('a quien NUNCA anunció llave no se le manda nada — y se dice cuál es el fallo', async ({ browser }) => {
    const kA = await makeKeys()
    const kNobody = await makeKeys()
    const A = await openPage(browser, 'quien-invita', kA)
    await connect(A.page)

    const pkNobody = JSON.stringify({ kty: 'EC', crv: 'P-256', x: kNobody.sigPub.x, y: kNobody.sigPub.y, ext: true })
    const roomUrl = 'https://pronostico.dotrino.com/#room=NO-DEBE-SALIR-' + ROOM
    const result = await A.page.evaluate(async ({ pk, roomUrl }) => {
      const { sendRoomInvites } = await import('/src/lib/inbox.ts')
      return sendRoomInvites([pk], roomUrl)
    }, { pk: pkNobody, roomUrl })

    expect(result.sent).toBe(0)
    expect(result.failed).toHaveLength(1)
    // POR `code`, nunca por la frase: «no tengo su llave» y «se cayó la red» se arreglan
    // de formas distintas, y verlos iguales manda a quien depura al camino equivocado.
    expect(result.failed[0].code).toBe('no-encpub')

    const wire = await wireText(A.page)
    expect(wire, 'no puede caer al camino en claro').not.toContain(roomUrl)
    expect(wire).not.toContain('ROOM_INVITE')
    // Lo único que salió fue la PREGUNTA por la llave.
    expect(wire).toContain('enc-lookup')

    await A.ctx.close()
  })
})
