// Acuses de apertura de pronósticos compartidos, sobre el motor COMÚN del
// ecosistema (@dotrino/notifications → createShareReceipts).
//
// - Lado del que ABRE: al importar un pronóstico AJENO firmado, avisamos al autor
//   por su pubkey (que viene en el propio enlace) con `reportOpen`. El proxy lo
//   encola 24h (sendByPubkey) y entrega cuando el autor se identifique.
// - Lado AUTOR: `startReceipts` escucha esos acuses y dispara una notificación
//   local con el MISMO enlace; al hacer click, la app reabre el contenido (el
//   handler de hashchange de App.vue lo re-importa).
//
// El contenido NO viaja por el push (política del ecosistema): el push solo
// "timbra"; el contenido baja por la cola cifrada del proxy al reconectar.

import { createShareReceipts, type ShareReceipts } from '@dotrino/notifications'
import { ensureConnected, getProxyClient } from './connection'
import { getIdentity } from './identity'
import { getNotificationsController } from './notifications'

let _receipts: ShareReceipts | null = null

function receipts (): ShareReceipts {
  if (!_receipts) {
    _receipts = createShareReceipts({
      proxyClient: () => getProxyClient(),
      identity: () => getIdentity(),
      notifications: getNotificationsController(),
      category: 'shareOpened',
      // Render por defecto del paquete (bilingüe): "Abrieron tu contenido" + «name» · nick.
    })
  }
  return _receipts
}

/**
 * Lado AUTOR: empieza a escuchar acuses de apertura (idempotente). Requiere la
 * conexión al proxy + identify (para que el proxy nos enrute por pubkey).
 */
export async function startReceipts (): Promise<void> {
  await ensureConnected()
  receipts().start()
}

/**
 * Lado del que ABRE: avisa al autor que abriste su pronóstico. No-op si el
 * contenido es propio o si el throttle (24h por contenido) lo bloquea.
 */
export async function reportOpen (toPubkey: string, url: string, name?: string): Promise<void> {
  if (!toPubkey || !url) return
  await ensureConnected()
  try { await receipts().report({ toPubkey, url, name }) } catch { /* best-effort */ }
}
