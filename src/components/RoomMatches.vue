<script setup lang="ts">
// Comparación PARTIDO A PARTIDO de la sala: filas = los 104 partidos (grupos
// por orden cronológico + eliminatorias por ronda), columnas = el resultado
// OFICIAL y el pronóstico de cada miembro. Verde = acertó el 1X2 / quién
// avanza; verde fuerte = marcador exacto. Los sellados se ven como 🔒.
//
// SALAS DE LA FECHA (`daily`): cada partido se revela al KICKOFF (antes, los
// picks ajenos se ven 🔒); los aciertos solo pintan si el pick tiene sello por
// partido VERIFICADO anterior al kickoff (⚠ = pick sin prueba, no puntúa).
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Room, RoomMember } from '../lib/roomStore'
import { isMemberSealed } from '../lib/roomStore'
import type { SavedPrediction } from '../lib/store'
import { decodePrediction } from '../lib/codec'
import { resolveMatches, type Prediction } from '../lib/prediction'
import { GROUPS, teamById } from '../lib/teams'
import {
  GROUP_PAIRS, groupMatchIndex, teamAt, outcomeOf, type Results, type MatchResult,
} from '../lib/standings'
import { R32, R16, QF, SF, THIRD_PLACE, FINAL } from '../lib/bracket'
import { kickoffUTC } from '../lib/schedule'
import { scoreMatchdayPicks, nowMs, type MatchdayScore } from '../lib/matchday'

const { t } = useI18n()

const props = defineProps<{
  room: Room
  official: SavedPrediction | null
  myPubkey: string | null
  /** Sala del pronóstico de la FECHA (ver cabecera). */
  daily?: boolean
}>()

// Reloj vivo (salas de la fecha): destapa los picks al llegar el kickoff.
const now = ref(nowMs())
let tick: number | null = null
onMounted(() => { tick = window.setInterval(() => { now.value = nowMs() }, 30_000) })
onUnmounted(() => { if (tick != null) clearInterval(tick) })

interface Col {
  member: RoomMember
  sealed: boolean
  isMe: boolean
  pred: Prediction | null
  resolved: Map<number, { winner: number | null }> | null
  /** puntaje por partido de la fecha (solo salas daily) */
  dscore: MatchdayScore | null
}

const cols = computed<Col[]>(() =>
  props.room.members.filter((m) => !m.deleted).map((m) => {
    let pred: Prediction | null = null
    try { pred = decodePrediction(m.code) } catch { /* código inválido */ }
    if (pred && m.results) pred.results = m.results
    return {
      member: m,
      sealed: props.daily ? false : isMemberSealed(props.room, m, props.myPubkey),
      isMe: m.publickey === props.myPubkey,
      pred,
      resolved: pred ? resolveMatches(pred) : null,
      dscore: props.daily ? scoreMatchdayPicks(m.results, m.proof, props.official, true) : null,
    }
  }),
)

// Oficial: resultados locales + picks decodificados (quién avanzó de verdad).
const officialPred = computed<Prediction | null>(() => {
  try { return props.official?.code ? decodePrediction(props.official.code) : null } catch { return null }
})
const officialResults = computed<Results>(() => props.official?.results ?? officialPred.value?.results ?? {})
const officialResolved = computed(() => (officialPred.value ? resolveMatches(officialPred.value) : null))

// --- Celdas ------------------------------------------------------------------

const flag = (id: number) => teamById(id).flag
const code = (id: number) => teamById(id).code

function fmtResult (r: MatchResult | undefined): string {
  if (!r) return ''
  if (typeof r.gh === 'number' && typeof r.ga === 'number') {
    let s = `${r.gh}-${r.ga}`
    if (typeof r.ph === 'number' && typeof r.pa === 'number') s += ` (${r.ph}-${r.pa})`
    return s
  }
  const o = outcomeOf(r)
  return o === 0 ? '1' : o === 2 ? '2' : o === 1 ? 'X' : ''
}
// ¿fmtResult devolvió un marcador (y no un 1/X/2)?
const isScoreText = (s: string) => !!s && !['1', 'X', '2'].includes(s)

interface Cell { text: string; hit: boolean; exact: boolean; sealed: boolean; unproven?: boolean }
const SEALED_CELL: Cell = { text: '🔒', hit: false, exact: false, sealed: true }
const EMPTY: Cell = { text: '', hit: false, exact: false, sealed: false }

// Celda de una sala de la FECHA: pick = marcador del miembro para ese partido.
// Antes del kickoff los picks AJENOS van tapados; después, el acierto solo
// pinta si el sello por partido probó el pick a tiempo (si no, ⚠ y 0 puntos).
function dailyCell (c: Col, id: number): Cell {
  const r = c.member.results?.[id]
  if (!r) return EMPTY
  const iso = kickoffUTC(id)
  const started = iso != null && now.value >= Date.parse(iso)
  if (!started && !c.isMe) return SEALED_CELL
  let text = fmtResult(r)
  // Eliminatoria con definición: anexa quién avanza según el pick.
  const ms = c.dscore?.per.get(id)
  const proven = !!ms?.counted
  const hit = !!started && proven && !!ms && (ms.outcome || ms.advance)
  const exact = !!started && proven && !!ms?.exact
  if (started && !proven) text += ' ⚠'
  return { text, hit: hit && !exact, exact, sealed: false, unproven: started && !proven }
}

function groupCell (c: Col, idx: number): Cell {
  if (props.daily) return dailyCell(c, idx)
  if (c.sealed) return SEALED_CELL
  const r = c.pred?.results[idx]
  if (!r) return EMPTY
  const or = officialResults.value[idx]
  const po = outcomeOf(r)
  const oo = outcomeOf(or)
  const hit = po != null && oo != null && po === oo
  const exact = hit && !!or && typeof r.gh === 'number' && typeof r.ga === 'number' &&
    r.gh === or.gh && r.ga === or.ga
  return { text: fmtResult(r), hit, exact, sealed: false }
}

function koCell (c: Col, num: number): Cell {
  if (props.daily) return dailyCell(c, num)
  if (c.sealed) return SEALED_CELL
  const winner = c.resolved?.get(num)?.winner ?? null
  if (winner == null) return EMPTY
  const score = c.pred ? fmtResult(c.pred.results[num]) : ''
  const ow = officialPred.value?.picks[num] ?? null
  const hit = ow != null && winner === ow
  return { text: code(winner) + (isScoreText(score) ? ` ${score}` : ''), hit, exact: false, sealed: false }
}

// --- Filas (con celdas precomputadas) ----------------------------------------

interface Row { key: string; label: string; official: string; cells: Cell[] }
interface Section { title: string; rows: Row[] }

const visibleSections = computed<Section[]>(() => {
  const out: Section[] = []
  const cs = cols.value

  for (let g = 0; g < GROUPS.length; g++) {
    const rows: Row[] = []
    const pairs = GROUP_PAIRS.map((pair, pi) => ({ pi, pair })).sort((a, b) => {
      const ka = kickoffUTC(groupMatchIndex(g, a.pi)) ?? ''
      const kb = kickoffUTC(groupMatchIndex(g, b.pi)) ?? ''
      return ka < kb ? -1 : ka > kb ? 1 : a.pi - b.pi
    })
    for (const { pi, pair } of pairs) {
      const idx = groupMatchIndex(g, pi)
      const home = teamAt(g, pair[0]!)
      const away = teamAt(g, pair[1]!)
      const official = fmtResult(officialResults.value[idx])
      const cells = cs.map((c) => groupCell(c, idx))
      // En salas de la fecha, una celda tapada (🔒) igual hace visible la fila:
      // muestra que alguien ya pronosticó el partido que viene.
      if (!official && !cells.some((c) => c.text && (!c.sealed || props.daily))) continue
      rows.push({ key: 'g' + idx, label: `${flag(home)} ${code(home)} – ${code(away)} ${flag(away)}`, official, cells })
    }
    if (rows.length) out.push({ title: t('group.title', { letter: GROUPS[g]!.letter }), rows })
  }

  const koSection = (title: string, nums: number[]) => {
    const rows: Row[] = []
    for (const num of nums) {
      // Etiqueta: equipos reales si el oficial ya conoce la llave; si no, #num.
      const rm = officialResolved.value?.get(num)
      const label = rm && rm.home != null && rm.away != null
        ? `${flag(rm.home)} ${code(rm.home)} – ${code(rm.away)} ${flag(rm.away)}`
        : `#${num}`
      const ow = officialPred.value?.picks[num] ?? null
      const oScore = fmtResult(officialResults.value[num])
      const official = ow != null ? code(ow) + (isScoreText(oScore) ? ` ${oScore}` : '') : ''
      const cells = cs.map((c) => koCell(c, num))
      if (!official && !cells.some((c) => c.text && (!c.sealed || props.daily))) continue
      rows.push({ key: 'k' + num, label, official, cells })
    }
    if (rows.length) out.push({ title, rows })
  }
  koSection(t('bracket.r32'), R32.map((m) => m.num))
  koSection(t('bracket.r16'), R16.map((m) => m.num))
  koSection(t('bracket.qf'), QF.map((m) => m.num))
  koSection(t('bracket.sf'), SF.map((m) => m.num))
  koSection(t('bracket.third'), [THIRD_PLACE.num])
  koSection(t('bracket.final'), [FINAL.num])
  return out
})

const headerName = (m: RoomMember) => m.nickname || t('common.anonymous')
</script>

<template>
  <div class="mm">
    <p v-if="!cols.length" class="empty">{{ t('rooms.noMembers') }}</p>
    <p v-else-if="!visibleSections.length" class="empty">{{ t('rooms.matchesEmpty') }}</p>

    <div v-else class="wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th class="match-h">{{ t('rooms.matchCol') }}</th>
            <th class="of-h">{{ t('rooms.officialCol') }}</th>
            <th v-for="c in cols" :key="c.member.publickey" class="m-h" :class="{ me: c.isMe }" :title="headerName(c.member) + (c.member.name ? ' · ' + c.member.name : '')">
              {{ headerName(c.member) }}<span v-if="c.isMe" class="you">{{ t('rooms.you') }}</span>
            </th>
          </tr>
        </thead>
        <tbody v-for="s in visibleSections" :key="s.title">
          <tr class="sec">
            <td :colspan="2 + cols.length">{{ s.title }}</td>
          </tr>
          <tr v-for="row in s.rows" :key="row.key">
            <td class="match">{{ row.label }}</td>
            <td class="of">{{ row.official }}</td>
            <td v-for="(cell, ci) in row.cells" :key="ci" class="cell"
                :class="{ hit: cell.hit && !cell.exact, exact: cell.exact, me: cols[ci]!.isMe, unproven: cell.unproven }">
              {{ cell.text }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="visibleSections.length" class="legend">
      <span class="chip hit">{{ t('rooms.legendHit') }}</span>
      <span class="chip exact">{{ t('rooms.legendExact') }}</span>
      <template v-if="daily">
        <span class="chip">🔒 {{ t('rooms.dailyLegendLocked') }}</span>
        <span class="chip warn">⚠ {{ t('rooms.dailyNotProven') }}</span>
      </template>
    </p>
  </div>
</template>

<style scoped>
.mm { padding: 0.2rem 0; }
.empty { color: var(--muted); font-style: italic; font-size: 0.85rem; padding: 0.6rem 0; }
.wrap { overflow-x: auto; max-width: 100%; border: 1px solid var(--line); border-radius: 10px; }
.tbl { border-collapse: collapse; min-width: 100%; font-size: 0.8rem; }
.tbl th { position: sticky; top: 0; background: var(--panel-2); color: var(--muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.45rem 0.5rem; text-align: left; z-index: 2; }
.tbl td { padding: 0.35rem 0.5rem; border-top: 1px solid var(--line-soft); white-space: nowrap; }
.match-h, .match { position: sticky; left: 0; background: var(--panel); z-index: 1; }
th.match-h { z-index: 3; }
.match { font-weight: 600; }
.of-h, .of { color: var(--azure); font-weight: 700; }
.m-h { max-width: 9rem; overflow: hidden; text-overflow: ellipsis; }
.m-h.me { color: var(--azure); }
.sec td { background: var(--panel-2); color: var(--gold); font-weight: 800; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
.cell { text-align: center; color: var(--muted); }
.cell.me { color: var(--text); }
.cell.hit { background: rgba(78, 222, 128, 0.14); color: var(--green); font-weight: 700; }
.cell.exact { background: rgba(78, 222, 128, 0.30); color: var(--green); font-weight: 800; }
.you { font-size: 0.58rem; background: var(--azure); color: #042038; border-radius: 5px; padding: 0 0.25rem; font-weight: 800; margin-left: 0.3rem; }
.legend { display: flex; gap: 0.5rem; margin-top: 0.5rem; font-size: 0.72rem; }
.chip { border-radius: 5px; padding: 0.1rem 0.45rem; color: var(--muted); background: rgba(255, 255, 255, 0.05); }
.chip.hit { background: rgba(78, 222, 128, 0.14); color: var(--green); }
.chip.exact { background: rgba(78, 222, 128, 0.30); color: var(--green); font-weight: 700; }
.chip.warn { background: rgba(255, 207, 63, 0.12); color: var(--gold); }
.cell.unproven { color: var(--gold); }
</style>
