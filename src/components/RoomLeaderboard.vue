<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Room, RoomMember } from '../lib/roomStore'
import { isMemberSealed } from '../lib/roomStore'
import type { SavedPrediction } from '../lib/store'
import { scoreEntry } from '../lib/scoring'
import { scoreMatchdayPicks } from '../lib/matchday'
import { kickoffUTC } from '../lib/schedule'
import { shortKey } from '../lib/rating'
import { TOURNAMENT_START } from '../lib/room'
import { getReputation } from '../lib/reputation'
import { getIdentity } from '../lib/identity'
import { createVaultProfileProvider } from '@dotrino/profile'
import '@dotrino/profile'

const { t, locale } = useI18n()

const props = defineProps<{
  room: Room
  official: SavedPrediction | null
  myPubkey: string | null
  /** Sala del pronóstico de la FECHA: puntaje por partido gateado por sello. */
  daily?: boolean
}>()
const emit = defineEmits<{ (e: 'remove-forward', m: RoomMember): void }>()

// nº de picks del miembro cuyo sello POR PARTIDO verificó y es ANTERIOR al
// kickoff (solo esos puntúan en salas de la fecha).
function provenPicks (m: RoomMember): { ok: number; total: number } {
  const ids = Object.keys(m.results ?? {}).map(Number)
  let ok = 0
  for (const id of ids) {
    const k = kickoffUTC(id)
    if (m.proof?.[id] != null && k != null && m.proof[id]! <= Date.parse(k)) ok++
  }
  return { ok, total: ids.length }
}

// Sello de tiempo del pronóstico (signer.dotrino.com): cuándo existió.
// 'a tiempo' = sellado antes del primer partido. En salas de la FECHA el sello
// es POR PARTIDO: se muestra cuántos picks quedaron probados a tiempo.
function sealInfo (m: RoomMember): { cls: string; icon: string; text: string } {
  const fmt = (ts: number) => new Date(ts).toLocaleString()
  if (props.daily) {
    const { ok, total } = provenPicks(m)
    const cls = !total ? 'none' : ok === total ? 'ok' : ok > 0 ? 'late' : 'bad'
    return { cls, icon: ok === total && total > 0 ? '🕓' : total ? '⚠' : '—', text: t('rooms.dailySealedPicks', { ok, total }) }
  }
  if (m.sealedAt == null) return { cls: 'none', icon: '—', text: t('rooms.sealNone') }
  if (!m.sealValid) return { cls: 'bad', icon: '⚠', text: t('rooms.sealInvalid') }
  if (m.sealedAt < TOURNAMENT_START) return { cls: 'ok', icon: '🕓', text: t('rooms.sealOkAt', { date: fmt(m.sealedAt) }) }
  return { cls: 'late', icon: '⚠', text: t('rooms.sealLate', { date: fmt(m.sealedAt) }) }
}

// Quitar MI reenvío con doble toque (sin confirm() nativo).
const removePending = ref<string | null>(null)
let removeTimer: number | null = null
function askRemoveForward (m: RoomMember) {
  if (removePending.value !== m.publickey) {
    removePending.value = m.publickey
    if (removeTimer != null) clearTimeout(removeTimer)
    removeTimer = window.setTimeout(() => { removePending.value = null }, 3000)
    return
  }
  removePending.value = null
  emit('remove-forward', m)
}

// Adapta un miembro de la sala a la forma que espera scoreEntry().
function asEntry (m: RoomMember): SavedPrediction {
  return {
    id: m.publickey, name: m.nickname || '', code: m.code,
    mode: m.mode, scope: m.scope, results: m.results, updatedAt: m.updatedAt, mine: false,
  }
}

interface Row { member: RoomMember; sealed: boolean; total: number; isMe: boolean }

const rows = computed<Row[]>(() => {
  const out: Row[] = props.room.members.filter((m) => !m.deleted).map((m) => {
    // En salas de la fecha no hay sello global de sala: cada partido se revela
    // al kickoff (la máscara vive en "Partidos") y el puntaje es por partido,
    // contando SOLO los picks con sello verificado anterior al kickoff.
    const sealed = props.daily ? false : isMemberSealed(props.room, m, props.myPubkey)
    const total = props.daily
      ? scoreMatchdayPicks(m.results, m.proof, props.official, true).total
      : (sealed ? -1 : scoreEntry(asEntry(m), props.official).total)
    return { member: m, sealed, total, isMe: m.publickey === props.myPubkey }
  })
  // Los sellados al final; el resto por puntaje descendente.
  return out.sort((a, b) => {
    if (a.sealed !== b.sealed) return a.sealed ? 1 : -1
    return b.total - a.total
  })
})

const hasOfficial = computed(() => !!props.official?.code)
const sealedActive = computed(() => props.room.sealedUntil > Date.now())
const sealedDate = computed(() => new Date(props.room.sealedUntil).toLocaleString())

// Reputación de los rivales (registro compartido, ponderada por mi web-of-trust).
// Guardamos confianza y afinidad (dos ejes independientes).
type Rep = { confianza: number | null; afinidad: number | null }
const repByPubkey = ref<Record<string, Rep>>({})
async function loadReps () {
  const rep = await getReputation()
  if (!rep) return
  for (const m of props.room.members) {
    if (m.deleted || m.publickey === props.myPubkey || m.publickey in repByPubkey.value) continue
    try {
      const r = await rep.reputationOf(m.publickey)
      repByPubkey.value = { ...repByPubkey.value, [m.publickey]: {
        confianza: r.score,
        afinidad: r.indicators?.afinidad?.score ?? null
      } }
    } catch { /* sin reputación */ }
  }
}
const pct = (v: number | null | undefined): number | null => (v == null ? null : Math.round(v * 100))
const repPct = (pk: string): number | null => pct(repByPubkey.value[pk]?.confianza)
const afinPct = (pk: string): number | null => pct(repByPubkey.value[pk]?.afinidad)
onMounted(loadReps)
watch(() => props.room.members.map((m) => m.publickey).join(), loadReps)

// --- Perfil del rival: tarjeta compartida <dotrino-profile> ---
const profilePk = ref<string | null>(null)
const profileName = ref('')
let _provider: any = null
async function ensureProvider () {
  if (_provider) return _provider
  const [identity, reputation] = await Promise.all([getIdentity(), getReputation()])
  if (reputation) _provider = createVaultProfileProvider({ identity, reputation })
  return _provider
}
function openProfile (m: RoomMember) {
  if (m.publickey === props.myPubkey) return
  profileName.value = m.nickname || ''
  profilePk.value = m.publickey
}
function bindProfile (el: any) {
  if (!el) return
  ensureProvider().then((p) => { if (p) el.provider = p })
}
function onProfileRate () { repByPubkey.value = {}; loadReps() }
// Tema oscuro del pronosticador (azure/gold sobre panel).
const profileTheme: Record<string, string> = {
  '--ccp-bg': 'var(--panel)',
  '--ccp-bg-2': 'var(--panel-2)',
  '--ccp-bg-3': 'var(--panel-2)',
  '--ccp-bg-4': 'rgba(233, 242, 255, 0.18)',
  '--ccp-border': 'var(--line)',
  '--ccp-text': 'var(--text)',
  '--ccp-muted': 'var(--muted)',
  '--ccp-accent': 'var(--azure)',
  '--ccp-accent-2': 'var(--azure-dim)',
  '--ccp-gold': 'var(--gold)',
  '--ccp-derived': 'var(--gold)',
  '--ccp-online': 'var(--azure)',
  '--ccp-affinity': '#ff7aa8',
  '--ccp-input-bg': 'var(--panel-2)',
  '--ccp-radius': '12px',
}
</script>

<template>
  <div class="lb">
    <p v-if="!hasOfficial" class="note">{{ t('rooms.noOfficial') }}</p>
    <p v-if="daily" class="note">📅 {{ t('rooms.dailyBoardNote') }}</p>
    <p v-if="!daily && sealedActive" class="note sealed">🔒 {{ t('rooms.sealedUntil', { date: sealedDate }) }}</p>
    <p v-if="!rows.length" class="empty">{{ t('rooms.noMembers') }}</p>

    <table v-else class="tbl">
      <thead>
        <tr>
          <th class="pos">#</th>
          <th>{{ t('rooms.member') }}</th>
          <th class="num">{{ t('rooms.points') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="r.member.publickey" :class="{ me: r.isMe }">
          <td class="pos">{{ r.sealed ? '–' : i + 1 }}</td>
          <td class="who">
            <span class="nm" :class="{ clickable: !r.isMe }"
                  @click="!r.isMe && openProfile(r.member)"
                  :title="!r.isMe ? t('rooms.member') : undefined">
              {{ r.member.nickname || t('common.anonymous') }}
              <span v-if="r.isMe" class="you">{{ t('rooms.you') }}</span>
              <span v-if="r.member.name" class="pname">· {{ r.member.name }}</span>
            </span>
            <span class="vrow">
              <span class="badge" :class="{ ok: r.member.verified }">{{ r.member.verified ? '✓' : '⚠' }}</span>
              <span class="seal" :class="sealInfo(r.member).cls" :title="sealInfo(r.member).text">{{ sealInfo(r.member).icon }}</span>
              <span v-if="r.member.via" class="via">↪ {{ t('rooms.contributedBy', { n: r.member.via === myPubkey ? t('rooms.you2') : (r.member.viaNick || shortKey(r.member.via)) }) }}</span>
              <span class="mono">{{ shortKey(r.member.publickey) }}</span>
              <span v-if="!r.isMe && repPct(r.member.publickey) != null" class="rep" title="Confianza (ponderada por tu web-of-trust)">{{ repPct(r.member.publickey) }}%</span>
              <span v-if="!r.isMe && afinPct(r.member.publickey) != null" class="rep afin" title="Afinidad de tu red">♥{{ afinPct(r.member.publickey) }}%</span>
              <button v-if="r.member.via === myPubkey" class="rm-fwd" @click.stop="askRemoveForward(r.member)">
                {{ removePending === r.member.publickey ? t('rooms.removeFriendSure') : t('rooms.removeFriend') }}
              </button>
            </span>
          </td>
          <td class="num">
            <span v-if="r.sealed" class="lock">🔒</span>
            <strong v-else>{{ r.total }}</strong>
          </td>
        </tr>
      </tbody>
    </table>

    <dotrino-profile
      v-if="profilePk"
      :ref="bindProfile"
      modal
      mode="edit"
      :style="profileTheme"
      :lang="locale"
      :pubkey="profilePk"
      :name="profileName"
      @cc-profile-close="profilePk = null"
      @cc-profile-rate="onProfileRate"
    ></dotrino-profile>
  </div>
</template>

<style scoped>
.lb { padding: 0.2rem 0; }
.note { font-size: 0.8rem; color: var(--muted); margin-bottom: 0.6rem; }
.note.sealed { color: var(--gold); }
.empty { color: var(--muted); font-style: italic; font-size: 0.85rem; padding: 0.6rem 0; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--line); }
.tbl td { padding: 0.5rem; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
.pos { width: 2rem; text-align: center; font-family: var(--font-display); color: var(--muted); }
.num { text-align: right; width: 4rem; }
.num strong { color: var(--azure); font-size: 1.05rem; }
.who { min-width: 0; }
.nm { font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem; }
.nm.clickable { cursor: pointer; }
.nm.clickable:hover { color: var(--azure); text-decoration: underline; }
.you { font-size: 0.65rem; background: var(--azure); color: #042038; border-radius: 5px; padding: 0 0.3rem; font-weight: 800; }
.vrow { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.1rem; flex-wrap: wrap; }
.badge { font-size: 0.7rem; color: #e0a; }
.via { font-size: 0.66rem; color: var(--azure); border: 1px solid var(--azure); border-radius: 4px; padding: 0 0.3rem; white-space: nowrap; }
.pname { font-size: 0.78rem; color: var(--muted); font-weight: 400; }
.seal { font-size: 0.7rem; cursor: help; }
.seal.bad, .seal.late { color: var(--gold); }
.seal.none { color: var(--muted); opacity: 0.6; }
.rm-fwd { background: transparent; color: #ff6b6b; border: 1px solid #ff6b6b; border-radius: 5px; padding: 0 0.4rem; font-size: 0.66rem; font-weight: 700; cursor: pointer; font-family: inherit; }
.badge.ok { color: var(--green); }
.mono { font-family: monospace; font-size: 0.66rem; color: var(--muted); }
.rep { font-size: 0.66rem; font-weight: 700; color: var(--green); background: rgba(0,0,0,.18); border-radius: 4px; padding: 0 0.25rem; }
.rep.afin { color: #ff7aa8; }
.me { background: rgba(65, 180, 255, 0.06); }
.lock { opacity: 0.7; }
</style>
