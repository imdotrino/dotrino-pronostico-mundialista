// Singleton compartido del vault de identidad id.dotrino.com.
// Lo usan la firma de pronósticos (share.ts) y el panel de perfil/contactos/
// rankings (IdentityPanel). Conecta una sola vez vía iframe + postMessage.

import { Identity } from '@dotrino/identity'

export type IdentityInstance = InstanceType<typeof Identity>

let _idPromise: Promise<IdentityInstance | null> | null = null

/** Conecta (una sola vez) al vault de identidad. Devuelve null si no alcanza. */
export function getIdentity (): Promise<IdentityInstance | null> {
  // Hook SOLO para tests e2e: si la página inyectó un vault de prueba (clave
  // generada en el navegador), lo usamos en vez del iframe real id.dotrino.com.
  // En producción este flag nunca está seteado.
  const testVault = (globalThis as { __TEST_VAULT_PROMISE__?: Promise<IdentityInstance | null> }).__TEST_VAULT_PROMISE__
  if (testVault) { _idPromise = testVault; return _idPromise }
  if (!_idPromise) {
    _idPromise = Identity.connect()
      .then((id) => id)
      .catch((e) => { console.warn('Identity vault inalcanzable:', e); return null })
  }
  return _idPromise
}
