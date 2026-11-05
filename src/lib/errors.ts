// Leer un error sin suponer su forma: lo que lanza el pilar trae `code`, y lo que no, no.

/** El `code` de un error (el contrato que se compara), o `undefined` si no lo trae. */
export function errorCode (e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

/** El `message` de un error, o `undefined` si no lo trae. */
export function errorMessage (e: unknown): string | undefined {
  const message = (e as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' ? message : undefined
}

/** Lo que el pilar del transporte deja en `meta` al entregar un mensaje. */
export interface MessageMeta {
  sealed?: boolean
  /** La identidad que lo mandó, según el proxio (la pone en lo que llega por pubkey). */
  fromPubkey?: string | null
  /** La llave de cifrado que lo selló, si el sobre lo dice. */
  senderEncPub?: string
}
