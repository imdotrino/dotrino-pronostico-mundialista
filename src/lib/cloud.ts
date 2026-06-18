// Capa de persistencia en la nube del ecosistema: espeja y rehidrata los datos
// locales (pronósticos, salas) contra el store estándar `store.dotrino.com`
// (`@dotrino/store` ≥ 0.3.0, IndexedDB + sync opcional a Drive).
//
// Es ADITIVA: localStorage sigue siendo la caché instantánea y la fuente que la
// app lee de forma síncrona. Esta capa, en segundo plano, sube los cambios y
// trae lo que haya en el store (merge last-writer-wins por `updatedAt`). Si el
// store no está disponible, todo sigue funcionando solo con localStorage.
//
// Modelo: cada registro (un pronóstico, una sala) es una ENTRADA del store en su
// thread (`predictions`, `rooms`), con `id` del registro y `ts = updatedAt`.

import { Store } from '@dotrino/store'

export const THREAD_PREDICTIONS = 'predictions'
export const THREAD_ROOMS = 'rooms'

export interface CloudRecord<T> { id: string; ts: number; data: T }

let _storePromise: Promise<InstanceType<typeof Store> | null> | null = null

// Permite desactivar la nube (p.ej. en e2e, para no escribir en el store real).
const CLOUD_DISABLED = (import.meta.env.VITE_DISABLE_CLOUD as string | undefined) === '1'

/** Conecta (una sola vez) al store del ecosistema. Null si no alcanza/desactivado. */
export function getCloudStore (): Promise<InstanceType<typeof Store> | null> {
  if (CLOUD_DISABLED) return Promise.resolve(null)
  if (!_storePromise) {
    _storePromise = Store.connect()
      .then((s) => s)
      .catch((e) => { console.warn('Store del ecosistema inalcanzable:', e); return null })
  }
  return _storePromise
}

// Último snapshot subido por thread {id → ts}, para no re-subir lo que no cambió
// ni re-subir lo que acabamos de traer del store.
const pushed = new Map<string, Map<string, number>>()
function snapOf (thread: string): Map<string, number> {
  let s = pushed.get(thread)
  if (!s) { s = new Map(); pushed.set(thread, s) }
  return s
}

/** Trae los registros de un thread del store (vacío si no alcanza). */
export async function pullThread<T> (thread: string): Promise<T[]> {
  const store = await getCloudStore()
  if (!store) return []
  try {
    const entries = await store.listThread(thread)
    const snap = snapOf(thread)
    const out: T[] = []
    for (const e of entries) {
      const rec = e as unknown as CloudRecord<T>
      if (!rec?.id) continue
      snap.set(rec.id, rec.ts || 0) // ya está en el store: no re-subir
      if (rec.data != null) out.push(rec.data)
    }
    return out
  } catch (e) { console.warn('pullThread falló:', e); return [] }
}

/**
 * Sincroniza el estado local de un thread con el store: sube los registros
 * nuevos/cambiados (por `ts`) y borra del store los que ya no existen local.
 * Fire-and-forget seguro: cualquier fallo se ignora (localStorage es la verdad).
 */
export async function syncThread<T> (thread: string, records: CloudRecord<T>[]): Promise<void> {
  const store = await getCloudStore()
  if (!store) return
  const snap = snapOf(thread)
  const currentIds = new Set(records.map((r) => r.id))
  for (const r of records) {
    const prev = snap.get(r.id)
    if (prev === undefined || r.ts > prev) {
      try { await store.appendMessage(thread, { id: r.id, ts: r.ts, data: r.data } as never); snap.set(r.id, r.ts) }
      catch (e) { console.warn('appendMessage falló:', e) }
    }
  }
  for (const id of [...snap.keys()]) {
    if (!currentIds.has(id)) {
      try { await store.removeMessage(thread, id); snap.delete(id) }
      catch (e) { console.warn('removeMessage falló:', e) }
    }
  }
}

/** ¿El sync a Drive está disponible/activo? (para mostrar estado en la UI) */
export async function cloudStatus () {
  const store = await getCloudStore()
  if (!store) return { connected: false, unlocked: false, dirty: false }
  try { return await store.syncStatus() } catch { return { connected: false, unlocked: false, dirty: false } }
}
