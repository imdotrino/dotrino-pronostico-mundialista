// Puente al registro de reputación compartido (reputation.dotrino.com).
// Reusa el web-of-trust local del vault para ponderar (anti-sybil). En el
// pronosticador: mostrar la reputación de los rivales en el leaderboard.

import { createVaultReputation } from '@dotrino/reputation'
import { getIdentity } from './identity'

let _rep: ReturnType<typeof createVaultReputation> | null = null

export async function getReputation () {
  if (_rep) return _rep
  const id = await getIdentity()
  if (!id) return null
  _rep = createVaultReputation(id as any)
  return _rep
}
