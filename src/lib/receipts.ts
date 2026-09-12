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
// "timbra"; el acuse baja por la cola del proxy al reconectar.
//
// EL ACUSE VA SELLADO (@dotrino/notifications >= 0.4.0, CONVENCIONES §4.1). Lleva el
// enlace del pronóstico, su nombre y el apodo de quien lo abrió: iba en claro, y el
// proxio no cifra. Si no se puede sellar no se manda — y se dice con su `code`.

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
  // Escuchar ANTES de conectar: la cola del proxio se drena al identificarse, y un acuse
  // que llevaba horas esperando se perdería por engancharse un instante tarde.
  receipts().start()
  await ensureConnected()
}

/**
 * Lado del que ABRE: avisa al autor que abriste su pronóstico. No-op si el
 * contenido es propio o si el throttle (24h por contenido) lo bloquea.
 */
export async function reportOpen (toPubkey: string, url: string, name?: string): Promise<void> {
  if (!toPubkey || !url) return
  await ensureConnected()
  try {
    await receipts().report({ toPubkey, url, name })
  } catch (e: any) {
    // No se traga: un acuse que no sale es normal (el autor puede no tener llave de
    // cifrado anunciada todavía), pero tiene que poder buscarse por su `code` — con la
    // frase no, que es lo que convierte «no tengo su llave» y «se cayó la red» en el
    // mismo misterio.
    console.warn('acuse de apertura no enviado (' + (e?.code || 'sin code') + '): no se manda en claro')
  }
}
