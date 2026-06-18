// Cliente WebSocket mínimo contra el proxy del ecosistema Dotrino.
//
// Su única responsabilidad aquí es resolver un TOKEN corto (la dirección
// lógica de 4-8 caracteres que el proxy asigna a cada conexión) a la
// IDENTIDAD real del peer (su clave pública JWK). Para eso replica lo esencial
// del flujo de handshake del messenger (ver
// `../dotrino-messenger/src/stores/threadsStore.js`):
//
//   1. Abrimos un WebSocket a `wss://proxy.dotrino.com`. El proxy nos
//      responde con `{type:'connected', token}` (nuestro token efímero).
//   2. Le mandamos al token destino un `IDENTIFY_CHALLENGE|{nonce}`, donde el
//      nonce viene del vault de identidad (`id.makeChallenge()`).
//   3. El peer (cualquier app del ecosistema que esté online: messenger, este
//      mismo pronosticador, etc.) responde con `IDENTIFY_RESPONSE|{...}`
//      firmando el nonce con SU clave privada.
//   4. Verificamos la firma con `id.verifyResponse(payload)` → obtenemos su
//      `publickey` (y `encryptionPubkey`).
//
// Importante: el handshake SOLO funciona si el dueño del token está conectado
// con una app del ecosistema que sepa responder al challenge. Si está offline
// o el token no existe, caemos en timeout (mensaje claro al usuario).
//
// NOTA: a diferencia del messenger no usamos `@dotrino/proxy-client`
// (no es dependencia de este proyecto). Implementamos el subconjunto del
// protocolo de cable que necesitamos: enviar a `to:[token]` un `message`
// string y recibir frames `{type:'message', from, message}`.

// La misma URL que usa el messenger (VITE_WS_URL || wss://proxy.dotrino.com).
const PROXY_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) || 'wss://proxy.dotrino.com'

// Formato de cable del messenger: `TIPO|json`.
function formatMessage (type: string, payload: unknown): string {
  return `${type}|${JSON.stringify(payload)}`
}

function parseMessage (raw: string): { type: string | null; payload: unknown } {
  const i = raw.indexOf('|')
  if (i < 0) return { type: null, payload: null }
  try {
    return { type: raw.slice(0, i), payload: JSON.parse(raw.slice(i + 1)) }
  } catch {
    return { type: null, payload: null }
  }
}

// El vault de identidad expone estos métodos (ver el .d.ts del paquete
// @dotrino/identity). Solo tipamos lo que usamos aquí para no
// acoplarnos al import del tipo completo.
interface ChallengeMaker {
  makeChallenge (): Promise<{ nonce: string }>
  verifyResponse (response: unknown): Promise<{
    ok: boolean
    publickey?: string
    encryptionPubkey?: string | null
  }>
}

export interface ResolveTokenResult {
  publickey: string
  encryptionPubkey?: string | null
  nickname?: string
}

export class ProxyTokenError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'ProxyTokenError'
  }
}

/**
 * Resuelve un token corto a la identidad real del peer mediante un
 * challenge/response firmado a través del proxy.
 *
 * @param token  Token destino (4-8 alfanuméricos, en mayúsculas).
 * @param id     Instancia del vault de identidad (para crear y verificar el challenge).
 * @param timeoutMs  Tiempo máximo de espera por la respuesta del peer.
 */
export function resolveTokenToIdentity (
  token: string,
  id: ChallengeMaker,
  timeoutMs = 12000,
): Promise<ResolveTokenResult> {
  return new Promise<ResolveTokenResult>((resolve, reject) => {
    let ws: WebSocket | null = null
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) {
        try { ws.close(1000) } catch { /* ignore */ }
        ws = null
      }
    }

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const succeed = (result: ResolveTokenResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    timer = setTimeout(() => {
      fail(new ProxyTokenError(
        'No hubo respuesta a tiempo. El contacto puede estar desconectado o el token no existe.',
      ))
    }, timeoutMs)

    try {
      ws = new WebSocket(PROXY_URL)
    } catch {
      fail(new ProxyTokenError('No se pudo conectar al proxy del ecosistema.'))
      return
    }

    ws.addEventListener('error', () => {
      fail(new ProxyTokenError('Error de conexión con el proxy del ecosistema.'))
    })

    ws.addEventListener('close', () => {
      // Si se cierra antes de resolver, lo tratamos como fallo (a menos que ya
      // hayamos resuelto/rechazado, en cuyo caso `settled` lo ignora).
      fail(new ProxyTokenError('La conexión con el proxy se cerró inesperadamente.'))
    })

    ws.addEventListener('message', (ev: MessageEvent) => {
      let frame: { type?: string; token?: string; from?: string; message?: string; error?: string }
      try {
        frame = JSON.parse(String(ev.data))
      } catch {
        return
      }

      switch (frame.type) {
        case 'connected': {
          // Ya tenemos token propio: lanzamos el challenge contra el destino.
          // El nonce lo crea el vault para poder verificar luego la respuesta.
          ;(async () => {
            try {
              const { nonce } = await id.makeChallenge()
              const msg = formatMessage('IDENTIFY_CHALLENGE', { nonce })
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ to: [token], message: msg }))
              }
            } catch {
              fail(new ProxyTokenError('No se pudo generar el challenge de identidad.'))
            }
          })()
          break
        }
        case 'message': {
          const raw = typeof frame.message === 'string' ? frame.message : ''
          const { type, payload } = parseMessage(raw)
          if (type !== 'IDENTIFY_RESPONSE' || !payload) break
          ;(async () => {
            try {
              const result = await id.verifyResponse(payload)
              if (!result.ok || !result.publickey) {
                fail(new ProxyTokenError('La firma del contacto no es válida.'))
                return
              }
              const p = payload as { nickname?: string }
              succeed({
                publickey: result.publickey,
                encryptionPubkey: result.encryptionPubkey ?? null,
                nickname: typeof p.nickname === 'string' ? p.nickname : undefined,
              })
            } catch {
              fail(new ProxyTokenError('No se pudo verificar la identidad del contacto.'))
            }
          })()
          break
        }
        case 'error': {
          // Error de servidor (p.ej. token destino inexistente al enrutar).
          fail(new ProxyTokenError(frame.error || 'El proxy rechazó la operación.'))
          break
        }
        // Otros frames (joined/left/etc.) no nos interesan para resolver token.
      }
    })
  })
}
