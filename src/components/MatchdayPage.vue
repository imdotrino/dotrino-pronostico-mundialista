<script setup lang="ts">
// Sección "LA FECHA": el pronóstico partido a partido, día a día. Aquí se VEN y
// EDITAN los partidos que aún no se juegan (hasta su kickoff) y se consultan los
// ya jugados con sus puntos contra los resultados oficiales. La entrada es ÚNICA
// por cuenta (se sincroniza por el store del ecosistema) y cada pick se SELLA.
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamById } from '../lib/teams'
import type { SavedPrediction } from '../lib/store'
import type { MatchResult } from '../lib/standings'
import {
  allFixtures, fixturePhaseKey, fixturePredictable, fixtureStarted, dayKey, nowMs,
  dailyProofMap, scoreMatchdayPicks, MATCHDAY_SCORING, type Fixture,
} from '../lib/matchday'
import { kickoffUTC } from '../lib/schedule'

const { t, locale } = useI18n()

const props = defineProps<{
  entry: SavedPrediction | null
  official: SavedPrediction | null
}>()

const emit = defineEmits<{
  save: [items: { id: number; r: MatchResult }[]]
  share: []
  reseal: []
}>()

// Reloj vivo: re-evalúa los bloqueos por kickoff sin recargar.
const now = ref(nowMs())
let tick: number | null = null
onMounted(() => { tick = window.setInterval(() => { now.value = nowMs() }, 30_000) })
onUnmounted(() => { if (tick != null) clearInterval(tick) })

const fixtures = computed(() => allFixtures(props.official))
const picks = computed(() => props.entry?.results ?? {})
const seals = computed(() => props.entry?.dailySeals ?? {})

// Próximos (editables o por definir), agrupados por día local; jugados aparte.
interface DayGroup { day: string; label: string; isToday: boolean; items: Fixture[] }
const upcomingDays = computed<DayGroup[]>(() => {
  const today = dayKey(now.value)
  const groups = new Map<string, DayGroup>()
  for (const f of fixtures.value) {
    // Los partidos de HOY se quedan en su día aunque ya hayan empezado (fila
    // bloqueada con tu pick + marcador oficial); los de días pasados van a
    // "Jugados".
    if (fixtureStarted(f, now.value) && dayKey(f.kickoff) !== today) continue
    const d = dayKey(f.kickoff)
    let g = groups.get(d)
    if (!g) {
      g = {
        day: d,
        label: new Date(f.kickoff).toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }),
        isToday: d === today,
        items: [],
      }
      groups.set(d, g)
    }
    g.items.push(f)
  }
  return [...groups.values()]
})

const played = computed<Fixture[]>(() =>
  fixtures.value.filter((f) => fixtureStarted(f, now.value) && dayKey(f.kickoff) !== dayKey(now.value)).reverse())

// "En juego" (heurística por hora: sin estado en vivo en el fixture).
const isLive = (f: Fixture): boolean =>
  fixtureStarted(f, now.value) && now.value < f.kickoff + 2.5 * 3_600_000

// Puntaje propio (no estricto: la UI ya impide editar tras el kickoff). El dato
// "sellados a tiempo" muestra cuánto de eso es PROBABLE ante terceros (salas).
const score = computed(() => scoreMatchdayPicks(picks.value, null, props.official, false))
const proof = computed(() => dailyProofMap(props.entry))
const pickedIds = computed(() => Object.keys(picks.value).map(Number))
const provenCount = computed(() => pickedIds.value.filter((id) => {
  const k = kickoffUTC(id)
  return proof.value[id] != null && k != null && proof.value[id]! <= Date.parse(k)
}).length)
const unsealedCount = computed(() => pickedIds.value.filter((id) => !seals.value[id]).length)

// --- Edición -----------------------------------------------------------------
interface Draft { gh: string; ga: string; adv: 'h' | 'a' | null }
const drafts = ref<Record<number, Draft>>({})

function draftFrom (r: MatchResult | undefined): Draft {
  return {
    gh: typeof r?.gh === 'number' ? String(r.gh) : '',
    ga: typeof r?.ga === 'number' ? String(r.ga) : '',
    adv: r && typeof r.ph === 'number' && typeof r.pa === 'number' ? (r.ph > r.pa ? 'h' : 'a') : null,
  }
}
function syncDrafts () {
  const d: Record<number, Draft> = {}
  for (const f of fixtures.value) {
    const cur = drafts.value[f.id]
    // Lo que estás tipeando manda; un borrador vacío se rellena desde el pick
    // guardado (p. ej. cuando la nube trae picks hechos en otro dispositivo).
    d[f.id] = cur && (cur.gh !== '' || cur.ga !== '') ? cur : draftFrom(picks.value[f.id])
  }
  drafts.value = d
}
watch(() => props.entry?.id, () => { drafts.value = {}; syncDrafts() }, { immediate: true })
watch(fixtures, syncDrafts)
watch(picks, syncDrafts)

function parsedScore (d: Draft): { gh: number; ga: number } | null {
  if (d.gh === '' || d.ga === '') return null
  const gh = Math.max(0, Math.min(15, Math.floor(Number(d.gh))))
  const ga = Math.max(0, Math.min(15, Math.floor(Number(d.ga))))
  if (Number.isNaN(gh) || Number.isNaN(ga)) return null
  return { gh, ga }
}
const isKoDraw = (f: Fixture): boolean => {
  const s = parsedScore(drafts.value[f.id] ?? { gh: '', ga: '', adv: null })
  return f.stage === 'ko' && !!s && s.gh === s.ga
}

// Guardado por partido con un pequeño debounce (evita sellar a mitad de tipeo).
const timers = new Map<number, number>()
function queueSave (f: Fixture) {
  const prev = timers.get(f.id)
  if (prev != null) clearTimeout(prev)
  timers.set(f.id, window.setTimeout(() => { timers.delete(f.id); saveOne(f) }, 700))
}
function saveOne (f: Fixture) {
  if (!fixturePredictable(f, now.value)) return
  const d = drafts.value[f.id]
  if (!d) return
  const s = parsedScore(d)
  if (!s) return
  const r: MatchResult = { o: s.gh > s.ga ? 0 : s.gh < s.ga ? 2 : 1, gh: s.gh, ga: s.ga }
  if (f.stage === 'ko' && s.gh === s.ga && d.adv) { r.ph = d.adv === 'h' ? 1 : 0; r.pa = d.adv === 'h' ? 0 : 1 }
  const prev = picks.value[f.id]
  const same = prev && prev.gh === r.gh && prev.ga === r.ga &&
    (prev.ph ?? null) === (r.ph ?? null) && (prev.pa ?? null) === (r.pa ?? null)
  if (same) return
  emit('save', [{ id: f.id, r }])
}
function pickAdvance (f: Fixture, side: 'h' | 'a') {
  const d = drafts.value[f.id]
  if (!d) return
  d.adv = side
  queueSave(f)
}

// --- Presentación --------------------------------------------------------------
const flag = (id: number | null) => (id == null ? '' : teamById(id).flag)
const code = (id: number | null) => (id == null ? '?' : teamById(id).code)
function phase (f: Fixture): string {
  const p = fixturePhaseKey(f)
  return t(p.key, p.params ?? {})
}
const hourOf = (f: Fixture) => new Date(f.kickoff).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
const dateOf = (f: Fixture) => new Date(f.kickoff).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })

type SealState = 'sealed' | 'late' | 'missing' | 'none'
function sealState (f: Fixture): SealState {
  if (!picks.value[f.id]) return 'none'
  const s = seals.value[f.id]
  if (!s) return 'missing'
  return s.ts <= f.kickoff ? 'sealed' : 'late'
}
function sealLabel (f: Fixture): string {
  const s = seals.value[f.id]
  if (!s) return t('daily.unsealed')
  const date = new Date(s.ts).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
  return sealState(f) === 'late' ? t('daily.sealedLate', { date }) : t('daily.sealedAt', { date })
}

function fmtPick (r: MatchResult | undefined, f: Fixture): string {
  if (!r || typeof r.gh !== 'number' || typeof r.ga !== 'number') return '—'
  let s = `${r.gh}-${r.ga}`
  if (f.stage === 'ko' && typeof r.ph === 'number' && typeof r.pa === 'number') {
    s += ` · ${r.ph > r.pa ? code(f.home) : code(f.away)}`
  }
  return s
}
const officialOf = (f: Fixture): MatchResult | undefined => props.official?.results?.[f.id]
const ptsOf = (f: Fixture): number => score.value.per.get(f.id)?.pts ?? 0
</script>

<template>
  <div class="md scrolly" data-testid="matchday-page">
    <!-- Cabecera: qué es + puntos + compartir -->
    <section class="head">
      <div class="head-top">
        <h2>📅 {{ t('daily.title') }}</h2>
        <button class="share" data-testid="daily-share" @click="emit('share')">{{ t('common.share') }}</button>
      </div>
      <p class="desc">{{ t('daily.desc') }}</p>
      <p class="desc note">{{ t('daily.uniqueNote') }}</p>
      <div class="stats">
        <span class="stat big" data-testid="daily-total"><strong>{{ score.total }}</strong> {{ t('scores.totalPts') }}</span>
        <span class="stat">{{ t('daily.pickedCount', { n: pickedIds.length }) }}</span>
        <span class="stat" :class="{ warn: provenCount < pickedIds.length }">🕓 {{ t('daily.provenCount', { ok: provenCount, total: pickedIds.length }) }}</span>
      </div>
      <p class="scoring-note">{{ t('daily.scoringNote', { o: MATCHDAY_SCORING.outcome, e: MATCHDAY_SCORING.exact, a: MATCHDAY_SCORING.advance }) }}</p>
      <p v-if="unsealedCount" class="reseal-row">
        ⚠ {{ t('daily.unsealedCount', { n: unsealedCount }) }}
        <button class="mini" data-testid="daily-reseal" @click="emit('reseal')">{{ t('daily.reseal') }}</button>
      </p>
    </section>

    <!-- Próximos: editables hasta el kickoff -->
    <section v-for="g in upcomingDays" :key="g.day" class="day" :class="{ today: g.isToday }">
      <h3 class="day-h">
        <span v-if="g.isToday" class="today-tag">{{ t('daily.today') }}</span>
        {{ g.label }}
      </h3>
      <div v-for="f in g.items" :key="f.id" class="row" data-testid="daily-row" :data-match="f.id">
        <div class="meta">
          <span class="ph">{{ phase(f) }}</span>
          <span v-if="isLive(f)" class="live-tag">● {{ t('daily.live') }}</span>
          <span class="hr">{{ hourOf(f) }}</span>
        </div>
        <!-- Llave aún sin equipos: por definir -->
        <p v-if="f.home == null || f.away == null" class="tbd">{{ t('daily.noTeams') }}</p>
        <!-- Ya empezó (hoy): pick congelado + marcador oficial en vivo -->
        <template v-else-if="fixtureStarted(f, now)">
          <div class="duel">
            <span class="team"><span class="fl">{{ flag(f.home) }}</span> <span class="cd mono-code">{{ code(f.home) }}</span></span>
            <span class="res">
              <span class="of">{{ fmtPick(officialOf(f), f) }}</span>
              <span class="mine" :class="{ none: !picks[f.id] }">{{ picks[f.id] ? t('daily.myPick', { p: fmtPick(picks[f.id], f) }) : t('daily.noPick') }}</span>
            </span>
            <span class="team right"><span class="cd mono-code">{{ code(f.away) }}</span> <span class="fl">{{ flag(f.away) }}</span></span>
          </div>
          <p v-if="picks[f.id]" class="seal" :class="sealState(f)">
            <template v-if="sealState(f) === 'sealed'">🕓 {{ sealLabel(f) }}</template>
            <template v-else-if="sealState(f) === 'late'">⚠ {{ sealLabel(f) }}</template>
            <template v-else>⚠ {{ t('daily.notProven') }}</template>
          </p>
        </template>
        <template v-else>
          <div class="duel">
            <span class="team"><span class="fl">{{ flag(f.home) }}</span> <span class="cd mono-code">{{ code(f.home) }}</span></span>
            <span class="score">
              <input v-model="drafts[f.id]!.gh" type="number" min="0" max="15" inputmode="numeric" data-testid="daily-row-gh" @input="queueSave(f)" @keydown.stop />
              <span class="dash">–</span>
              <input v-model="drafts[f.id]!.ga" type="number" min="0" max="15" inputmode="numeric" data-testid="daily-row-ga" @input="queueSave(f)" @keydown.stop />
            </span>
            <span class="team right"><span class="cd mono-code">{{ code(f.away) }}</span> <span class="fl">{{ flag(f.away) }}</span></span>
          </div>
          <div v-if="isKoDraw(f)" class="adv">
            <span class="adv-q">{{ t('daily.advance') }}</span>
            <button :class="{ on: drafts[f.id]!.adv === 'h' }" @click="pickAdvance(f, 'h')">{{ flag(f.home) }} {{ code(f.home) }}</button>
            <button :class="{ on: drafts[f.id]!.adv === 'a' }" @click="pickAdvance(f, 'a')">{{ flag(f.away) }} {{ code(f.away) }}</button>
          </div>
          <p class="seal" :class="sealState(f)" data-testid="daily-row-seal">
            <template v-if="sealState(f) === 'sealed'">🕓 {{ sealLabel(f) }}</template>
            <template v-else-if="sealState(f) === 'late'">⚠ {{ sealLabel(f) }}</template>
            <template v-else-if="sealState(f) === 'missing'">⚠ {{ t('daily.unsealed') }}</template>
            <template v-else>{{ t('daily.noPickYet') }}</template>
          </p>
        </template>
      </div>
    </section>
    <p v-if="!upcomingDays.length" class="empty">{{ t('daily.noUpcoming') }}</p>

    <!-- Jugados / en juego: pick congelado + resultado oficial + puntos -->
    <section v-if="played.length" class="playedsec">
      <h3 class="day-h">{{ t('daily.played') }}</h3>
      <div v-for="f in played" :key="f.id" class="row done" data-testid="daily-played-row">
        <div class="meta">
          <span class="ph">{{ phase(f) }} · {{ dateOf(f) }}</span>
          <span v-if="picks[f.id]" class="pts" :class="{ zero: !ptsOf(f) }">+{{ ptsOf(f) }}</span>
        </div>
        <div class="duel">
          <span class="team"><span class="fl">{{ flag(f.home) }}</span> <span class="cd mono-code">{{ code(f.home) }}</span></span>
          <span class="res">
            <span class="of">{{ fmtPick(officialOf(f), f) }}</span>
            <span class="mine" :class="{ none: !picks[f.id] }">{{ picks[f.id] ? t('daily.myPick', { p: fmtPick(picks[f.id], f) }) : t('daily.noPick') }}</span>
          </span>
          <span class="team right"><span class="cd mono-code">{{ code(f.away) }}</span> <span class="fl">{{ flag(f.away) }}</span></span>
        </div>
        <p v-if="picks[f.id]" class="seal" :class="sealState(f)">
          <template v-if="sealState(f) === 'sealed'">🕓 {{ sealLabel(f) }}</template>
          <template v-else>⚠ {{ t('daily.notProven') }}</template>
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.md { padding: 1rem; max-width: 640px; }
.head { background: var(--panel); border: 1px solid var(--azure); border-radius: 14px; padding: 1rem 1.1rem; margin-bottom: 1.1rem; }
.head-top { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
.head h2 { color: var(--azure); font-size: 1.15rem; }
.share {
  background: var(--azure); color: #042038; border: none; border-radius: 50px;
  padding: 0.4rem 1rem; font-weight: 800; cursor: pointer; font-family: inherit; font-size: 0.82rem;
}
.desc { color: var(--muted); font-size: 0.82rem; margin-top: 0.4rem; }
.desc.note { font-size: 0.74rem; }
.stats { display: flex; gap: 0.9rem; align-items: baseline; flex-wrap: wrap; margin-top: 0.7rem; }
.stat { color: var(--muted); font-size: 0.78rem; font-weight: 700; }
.stat.big { color: var(--text); font-size: 0.9rem; }
.stat.big strong { color: var(--azure); font-size: 1.5rem; font-family: var(--font-display); }
.stat.warn { color: var(--gold); }
.scoring-note { color: var(--muted); font-size: 0.72rem; margin-top: 0.5rem; }
.reseal-row { color: var(--gold); font-size: 0.78rem; margin-top: 0.5rem; font-weight: 700; }
.mini { background: none; border: 1px solid var(--gold); color: var(--gold); border-radius: 6px; padding: 0.1rem 0.5rem; margin-left: 0.3rem; cursor: pointer; font-size: 0.74rem; font-family: inherit; font-weight: 700; }

.day-h { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 1rem 0 0.5rem; display: flex; align-items: center; gap: 0.45rem; }
.today .day-h { color: var(--azure); }
.today-tag { background: var(--azure); color: #042038; border-radius: 6px; padding: 0.05rem 0.4rem; font-weight: 800; font-size: 0.68rem; }
.live-tag { color: var(--green); font-weight: 800; font-size: 0.7rem; letter-spacing: 0.04em; }
.row { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; }
.today .row { border-color: rgba(65, 180, 255, 0.45); }
.meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.35rem; }
.duel { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }
.team { display: inline-flex; align-items: center; gap: 0.35rem; min-width: 0; }
.fl { font-size: 1.2rem; }
.cd { font-weight: 800; font-size: 0.84rem; }
.score { display: inline-flex; align-items: center; gap: 0.3rem; }
.score input {
  width: 2.5rem; text-align: center; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; color: var(--text); font-size: 1rem; font-weight: 800; padding: 0.3rem 0.1rem; font-family: inherit;
}
.score input:focus { border-color: var(--azure); outline: none; }
.dash { color: var(--muted); }
.tbd { color: var(--muted); font-style: italic; font-size: 0.82rem; }
.adv { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.45rem; flex-wrap: wrap; }
.adv-q { font-size: 0.72rem; color: var(--gold); font-weight: 700; }
.adv button { background: transparent; border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 0.2rem 0.55rem; cursor: pointer; font-weight: 700; font-size: 0.76rem; font-family: inherit; }
.adv button.on { background: var(--azure); color: #042038; border-color: var(--azure); }

.seal { font-size: 0.7rem; margin-top: 0.4rem; color: var(--muted); }
.seal.sealed { color: var(--green); }
.seal.late, .seal.missing { color: var(--gold); }
.empty { color: var(--muted); font-style: italic; font-size: 0.85rem; padding: 0.6rem 0; }

.playedsec .row.done { opacity: 0.92; }
.res { display: inline-flex; flex-direction: column; align-items: center; gap: 0.1rem; }
.of { color: var(--azure); font-weight: 800; font-size: 1rem; }
.mine { color: var(--muted); font-size: 0.72rem; }
.mine.none { font-style: italic; }
.pts { background: rgba(78, 222, 128, 0.18); color: var(--green); border-radius: 6px; padding: 0.05rem 0.45rem; font-weight: 800; font-size: 0.76rem; }
.pts.zero { background: rgba(255, 255, 255, 0.06); color: var(--muted); }
</style>
