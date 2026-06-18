import { test, expect } from '@playwright/test'

// Verifica el motor COMÚN de acuses (createShareReceipts) en el navegador, con
// proxy y controlador de notificaciones fakeados (sin tocar infra en vivo):
//   - report(): el que ABRE encola un sobre __ccn identificado por sendByPubkey.
//   - start(): el AUTOR, al recibir ese sobre, dispara notify(category, {...})
//     con el enlace en data.url para re-ver el contenido.

test('acuse de apertura: report envía sobre y start dispara notificación con el link', async ({ page }) => {
  await page.goto('/')

  const r = await page.evaluate(async () => {
    const mod = await import('/node_modules/@dotrino/notifications/src/index.js')
    const { createShareReceipts } = mod as { createShareReceipts: (cfg: unknown) => {
      report: (o: unknown) => Promise<boolean>
      start: () => void
    } }

    // Proxy falso: captura sendByPubkey y el handler de 'message'.
    let onMessage: ((from: string, payload: unknown) => void) | null = null
    const sent: Array<{ pk: unknown; payload: unknown }> = []
    const fakeProxy = {
      on: (ev: string, fn: (from: string, payload: unknown) => void) => {
        if (ev === 'message') onMessage = fn
        return () => { onMessage = null }
      },
      sendByPubkey: (pk: unknown, payload: unknown) => { sent.push({ pk, payload }) },
    }

    // Controlador de notificaciones falso: captura notify().
    const notifyCalls: Array<{ category: string; opts: Record<string, unknown> }> = []
    const fakeNotifications = {
      notify: (category: string, opts: Record<string, unknown>) => { notifyCalls.push({ category, opts }); return Promise.resolve(null) },
    }

    const url = 'https://mundial.dotrino.com/#BLOB123'

    // Lado AUTOR (recibe). Identidad del autor = PK_A.
    const authorReceipts = createShareReceipts({
      proxyClient: fakeProxy,
      identity: { me: { publickey: 'PK_A', nickname: 'alfa' } },
      notifications: fakeNotifications,
      lang: 'es',
    })
    authorReceipts.start()

    // Lado del que ABRE (PK_B abre el contenido de PK_A).
    const openerReceipts = createShareReceipts({
      proxyClient: fakeProxy,
      identity: { me: { publickey: 'PK_B', nickname: 'beta' } },
      notifications: fakeNotifications,
    })
    const reported = await openerReceipts.report({ toPubkey: 'PK_A', url, name: 'Mi pronóstico' })

    // Simula la entrega del sobre al autor por el proxy.
    const env = sent[0]?.payload
    if (onMessage) (onMessage as (f: string, p: unknown) => void)('tok', env)

    return {
      reported,
      sentTo: sent[0]?.pk,
      env,
      notifyCount: notifyCalls.length,
      notify: notifyCalls[0],
    }
  })

  expect(r.reported).toBe(true)
  expect(r.sentTo).toBe('PK_A')
  // Sobre estándar identificado.
  const env = r.env as Record<string, unknown>
  expect(env.__ccn).toBe(1)
  expect(env.url).toBe('https://mundial.dotrino.com/#BLOB123')
  expect(env.name).toBe('Mi pronóstico')
  expect((env.from as Record<string, unknown>).pubkey).toBe('PK_B')
  expect((env.from as Record<string, unknown>).nick).toBe('beta')
  // El autor recibió la notificación con el link en data.url.
  expect(r.notifyCount).toBe(1)
  expect(r.notify!.category).toBe('shareOpened')
  expect((r.notify!.opts.data as Record<string, unknown>).url).toBe('https://mundial.dotrino.com/#BLOB123')
  expect(String(r.notify!.opts.title)).toContain('Abrieron')
  expect(String(r.notify!.opts.body)).toContain('Mi pronóstico')
})
