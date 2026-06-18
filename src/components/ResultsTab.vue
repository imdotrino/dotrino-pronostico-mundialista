<script setup lang="ts">
// Pestaña de RESULTADOS: para cada grupo, sus 6 partidos. Botones [1][X][2]
// (local gana / empate / visitante gana). En modo 'score' además dos inputs de
// goles (0-99); al cargarlos se deriva un `o` coherente. Solo visible cuando el
// modo NO es 'manual'. En solo lectura no se edita.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GROUPS, teamById, GROUP_LETTERS } from '../lib/teams'
import { GROUP_PAIRS, groupMatchIndex, teamAt, computeStandings, koWinnerSide, outcomeOf, type MatchResult, type Results } from '../lib/standings'
import { resolveMatches, type Prediction, type ResolvedMatch } from '../lib/prediction'
import { decodePrediction } from '../lib/codec'
import { R32, R16, QF, SF, FINAL, THIRD_PLACE, type Slot } from '../lib/bracket'
import { formatLocal, kickoffUTC } from '../lib/schedule'
import type { SavedPrediction } from '../lib/store'
import { sourceSummary, type Feed } from '../lib/officialResults'

const { t, locale } = useI18n()

// Enfrentamientos de un grupo ORDENADOS por fecha de partido (cronológico).
// Devuelve { pi, pair } donde pi es el índice en GROUP_PAIRS.
function groupMatches (g: number): { pi: number; pair: readonly [number, number] }[] {
  return GROUP_PAIRS
    .map((pair, pi) => ({ pi, pair: pair as readonly [number, number] }))
    .sort((a, b) => {
      const ka = kickoffUTC(groupMatchIndex(g, a.pi)) ?? ''
      const kb = kickoffUTC(groupMatchIndex(g, b.pi)) ?? ''
      return ka < kb ? -1 : ka > kb ? 1 : a.pi - b.pi
    })
}

// Fecha/hora local de un partido (grupo: groupMatchIndex; eliminatoria: num),
// o null si no hay dato en el calendario. La zona la resuelve el navegador.
function kickoff (key: number): string | null {
  return formatLocal(key, locale.value)
}

const props = defineProps<{
  pred: Prediction; readonly?: boolean; official?: SavedPrediction | null
  // Solo cuando se edita la entrada de "Resultados oficiales": habilita traer del
  // relay y publicar correcciones manuales (firmadas por el vault).
  isOfficial?: boolean
  isAdmin?: boolean
  officialStatus?: 'idle' | 'loading' | 'ok' | 'offline'
  officialFeed?: Feed | null
  officialUpdatedAt?: number
  publishStatus?: 'idle' | 'publishing' | 'ok' | 'error' | 'unauthorized' | 'nochange'
}>()
const emit = defineEmits<{ (e: 'refresh-official'): void; (e: 'publish-official'): void }>()

// Procedencia de los resultados oficiales (proveedores activos + overrides).
const officialSources = computed(() => (props.officialFeed ? sourceSummary(props.officialFeed) : null))
const officialWhen = computed(() => (props.officialUpdatedAt
  ? new Date(props.officialUpdatedAt).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
  : ''))
const publishMsg = computed(() => {
  switch (props.publishStatus) {
    case 'publishing': return t('results.publishing')
    case 'ok': return t('results.published')
    case 'nochange': return t('results.publishNoChange')
    case 'unauthorized': return t('results.publishUnauthorized')
    case 'error': return t('results.publishError')
    default: return ''
  }
})

// Solo en modo 'score' mostramos los inputs de goles.
const showGoals = computed(() => props.pred.mode === 'score')
// En alcance 'groups' (solo grupos) no se cargan eliminatorias.
const showKnockout = computed(() => props.pred.scope !== 'groups')

// --- Estrella en partidos que sumaron puntos vs los Resultados oficiales ---
// (App pasa `official=null` cuando se está editando la entrada oficial.)
const officialDecoded = computed(() => {
  try { return props.official?.code ? decodePrediction(props.official.code) : null } catch { return null }
})
const officialResults = computed<Results>(() => props.official?.results ?? officialDecoded.value?.results ?? {})

// Partido de grupo acertado (mismo gana/empata/pierde que el oficial).
function scoredGroup (g: number, pair: number): boolean {
  if (!props.official) return false
  const idx = groupMatchIndex(g, pair)
  const po = outcomeOf(props.pred.results[idx])
  const oo = outcomeOf(officialResults.value[idx])
  return po != null && oo != null && po === oo
}
// Llave acertada (mismo equipo que avanza que el oficial).
function scoredKO (num: number): boolean {
  if (!props.official) return false
  const pw = resolved.value.get(num)?.winner ?? null
  const ow = officialDecoded.value?.picks[num] ?? null
  return pw != null && ow != null && pw === ow
}

// --- Eliminatorias (llaves) -----------------------------------------------
// Resolución de cada partido de llave a equipos concretos (o null si el cupo
// aún no se conoce). Reactivo a picks/groupOrder.
const resolved = computed(() => resolveMatches(props.pred))
function rm (num: number): ResolvedMatch | undefined { return resolved.value.get(num) }

// Etiquetas de cupos vacíos (misma lógica que BracketTab).
const r32Slots = new Map<number, { home: Slot; away: Slot }>(
  R32.map((x) => [x.num, { home: x.home, away: x.away }]),
)
const laterFrom = new Map<number, [number, number]>(
  [...R16, ...QF, ...SF, THIRD_PLACE, FINAL].map((x) => [x.num, x.from]),
)
function slotLabel (slot: Slot): string {
  if (slot.kind === 'W') return t('bracket.winnerOf', { letter: GROUP_LETTERS[slot.group] })
  if (slot.kind === 'RU') return t('bracket.runnerUpOf', { letter: GROUP_LETTERS[slot.group] })
  return t('bracket.thirdSlot')
}
// Etiqueta del placeholder para el lado local (top=true) o visitante de un partido.
function placeholder (num: number, top: boolean): string {
  const r32 = r32Slots.get(num)
  if (r32) return slotLabel(top ? r32.home : r32.away)
  if (num === THIRD_PLACE.num) return t('bracket.loserSF')
  const from = laterFrom.get(num)
  if (from) return t('bracket.winnerNum', { n: from[top ? 0 : 1] })
  return '?'
}

// Rondas en orden, con los números de partido (numeración oficial). El título
// es una clave i18n que se traduce reactivamente en el template.
const koRounds: { titleKey: string; nums: number[] }[] = [
  { titleKey: 'bracket.r32', nums: R32.map((x) => x.num) }, //   73-88
  { titleKey: 'bracket.r16', nums: R16.map((x) => x.num) }, //   89-96
  { titleKey: 'bracket.qf', nums: QF.map((x) => x.num) }, //     97-100
  { titleKey: 'bracket.sf', nums: SF.map((x) => x.num) }, //     101-102
  { titleKey: 'bracket.third', nums: [THIRD_PLACE.num] }, //     103
  { titleKey: 'bracket.final', nums: [FINAL.num] }, //           104
]

// Resultado (goles) guardado de un partido de eliminatoria.
function koResult (num: number): MatchResult | undefined { return props.pred.results[num] }

// Equipo elegido como ganador (el que avanza).
function koChosen (num: number): number | null { return props.pred.picks[num] ?? null }

// Elegir ganador: setea pred.picks[num]. Toggle al volver a tocar (vacía).
// Solo si ese lado tiene equipo (se permite aunque el rival esté vacío).
function koChoose (num: number, teamId: number | null): void {
  if (props.readonly || teamId == null) return
  if (props.pred.picks[num] === teamId) delete props.pred.picks[num]
  else props.pred.picks[num] = teamId
}

// ¿El partido de eliminatoria quedó empatado en los 90'? (goles iguales) →
// se muestran las casillas de penales.
function koIsTie (num: number): boolean {
  const r = props.pred.results[num]
  return !!r && typeof r.gh === 'number' && typeof r.ga === 'number' && r.gh === r.ga
}

// Recalcula quién avanza (pick) a partir del marcador y penales: gana por goles
// y, si hay empate en 90', por penales. Si aún no está decidido, vacía el pick.
function applyKoWinner (num: number): void {
  const side = koWinnerSide(props.pred.results[num])
  const match = rm(num)
  if (side === 'h' && match?.home != null) props.pred.picks[num] = match.home
  else if (side === 'a' && match?.away != null) props.pred.picks[num] = match.away
  else delete props.pred.picks[num]
}

// Carga goles (modo 'score') del local ('h') o visitante ('a') de una llave.
// El ganador se deriva del marcador (más goles; si empatan, de los penales).
function koSetGoals (num: number, side: 'h' | 'a', raw: string): void {
  if (props.readonly) return
  const prev = props.pred.results[num]
  const gh = side === 'h' ? clampGoals(raw) : prev?.gh
  const ga = side === 'a' ? clampGoals(raw) : prev?.ga
  let o: 0 | 1 | 2 = prev?.o ?? 1
  if (typeof gh === 'number' && typeof ga === 'number') o = gh > ga ? 0 : gh < ga ? 2 : 1
  // Si dejan de estar empatados, se descartan los penales.
  const tie = typeof gh === 'number' && typeof ga === 'number' && gh === ga
  props.pred.results[num] = {
    o, gh, ga,
    ph: tie ? prev?.ph : undefined,
    pa: tie ? prev?.pa : undefined,
  }
  applyKoWinner(num)
}

// Carga penales (solo si hay empate en 90') y recalcula el que avanza.
function koSetPens (num: number, side: 'h' | 'a', raw: string): void {
  if (props.readonly) return
  const prev = props.pred.results[num]
  if (!prev) return
  const ph = side === 'h' ? clampGoals(raw) : prev.ph
  const pa = side === 'a' ? clampGoals(raw) : prev.pa
  props.pred.results[num] = { ...prev, ph, pa }
  applyKoWinner(num)
}

// Resultado actual de un partido (o undefined si no cargado).
function resultOf (g: number, pair: number): MatchResult | undefined {
  return props.pred.results[groupMatchIndex(g, pair)]
}

// Fija el ganador (gana/empata/pierde) preservando goles previos si existieran.
function setOutcome (g: number, pair: number, o: 0 | 1 | 2): void {
  if (props.readonly) return
  const idx = groupMatchIndex(g, pair)
  const prev = props.pred.results[idx]
  props.pred.results[idx] = { ...prev, o }
}

// Lee un número 0..99 de un input; vacío → undefined.
function clampGoals (raw: string): number | undefined {
  if (raw === '') return undefined
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(99, n))
}

// Carga goles del local ('h') o del visitante ('a') y deriva el `o` coherente.
function setGoals (g: number, pair: number, side: 'h' | 'a', raw: string): void {
  if (props.readonly) return
  const idx = groupMatchIndex(g, pair)
  const prev = props.pred.results[idx]
  const gh = side === 'h' ? clampGoals(raw) : prev?.gh
  const ga = side === 'a' ? clampGoals(raw) : prev?.ga
  // `o` coherente con los goles si ambos están cargados; si no, preserva el previo.
  let o: 0 | 1 | 2 = prev?.o ?? 1
  if (typeof gh === 'number' && typeof ga === 'number') {
    o = gh > ga ? 0 : gh < ga ? 2 : 1
  }
  props.pred.results[idx] = { o, gh, ga }
}

// --- Barra de utilidades (solo cuando es editable) -------------------------
// Llena los 72 partidos de grupo con resultados al azar, respetando el modo:
//   - 'score':   goles 0..4 para cada lado, con `o` coherente.
//   - 'winlose': solo `o` aleatorio 0/1/2.
// Reasigna un objeto nuevo a `pred.results` para que el watch profundo reaccione.
function fillRandom (): void {
  if (props.readonly) return
  const score = props.pred.mode === 'score'
  const next: Results = {}
  // 1) Partidos de grupo al azar.
  for (let g = 0; g < 12; g++) {
    for (let pair = 0; pair < 6; pair++) {
      const idx = groupMatchIndex(g, pair)
      if (score) {
        const gh = Math.floor(Math.random() * 5)
        const ga = Math.floor(Math.random() * 5)
        const o: 0 | 1 | 2 = gh > ga ? 0 : gh < ga ? 2 : 1
        next[idx] = { o, gh, ga }
      } else {
        next[idx] = { o: Math.floor(Math.random() * 3) as 0 | 1 | 2 }
      }
    }
  }
  // 2) Aplicar posiciones para que se resuelvan los participantes de las llaves.
  const st = computeStandings(next, props.pred.mode)
  props.pred.results = next
  props.pred.groupOrder = st.groupOrder.map((a) => [...a])
  props.pred.thirdsRank = [...st.thirdsRank]
  props.pred.draftGroupOrder = st.groupOrder.map((a) => [...a])
  props.pred.draftThirdsRank = [...st.thirdsRank]
  // 3) Recorrer el bracket en orden y elegir ganador al azar entre los presentes
  //    (cada elección define los participantes de la ronda siguiente). En alcance
  //    'groups' no hay llaves: dejamos los picks vacíos.
  props.pred.picks = {}
  if (props.pred.scope === 'groups') return
  for (const round of koRounds) {
    for (const num of round.nums) {
      const m = resolved.value.get(num)
      const sides = [m?.home ?? null, m?.away ?? null].filter((t): t is number => t != null)
      if (sides.length === 0) continue
      const winner = sides[Math.floor(Math.random() * sides.length)]!
      props.pred.picks[num] = winner
      if (score) {
        const wg = 1 + Math.floor(Math.random() * 4)
        const lg = Math.floor(Math.random() * wg)
        const winnerIsHome = winner === (m?.home ?? null)
        props.pred.results[num] = winnerIsHome ? { o: 0, gh: wg, ga: lg } : { o: 2, gh: lg, ga: wg }
      }
    }
  }
}

// Borra todos los resultados (con confirmación).
function clearAll (): void {
  if (props.readonly) return
  if (!confirm(t('results.confirmClear'))) return
  props.pred.results = {}
}

// Traer / publicar resultados oficiales lo maneja App (relay results.dotrino.com):
// acá solo emitimos. `refresh-official` trae+aplica del relay; `publish-official`
// firma con el vault del admin las correcciones manuales y las sube.
</script>

<template>
  <div class="results">
    <!-- Barra de utilidades: solo cuando es editable (no en pronósticos amigos). -->
    <div v-if="!readonly" class="util-bar">
      <button class="util" @click="fillRandom">{{ t('results.random') }}</button>
      <button class="util" @click="clearAll">{{ t('results.clear') }}</button>
      <!-- Solo en la entrada de Resultados oficiales: traer del relay / publicar. -->
      <template v-if="isOfficial">
        <button class="util official" :disabled="officialStatus === 'loading'" @click="emit('refresh-official')">
          {{ officialStatus === 'loading' ? t('results.officialLoading') : t('results.officialRefresh') }}
        </button>
        <button v-if="isAdmin" class="util publish" :disabled="publishStatus === 'publishing'" @click="emit('publish-official')">
          {{ t('results.officialPublish') }}
        </button>
      </template>
    </div>

    <!-- Procedencia + estado de los resultados oficiales (de dónde vienen). -->
    <template v-if="isOfficial">
      <p v-if="officialSources" class="src-line">
        <span class="src-lbl">{{ t('results.officialSourceLabel') }}</span>
        <span v-for="s in officialSources.providers" :key="s.id" class="src-chip" :class="{ off: !s.ok }">{{ s.label }}</span>
        <span v-if="officialSources.overrides" class="src-chip manual">{{ t('results.officialManual', { n: officialSources.overrides }) }}</span>
        <span v-if="officialWhen" class="src-when">· {{ t('results.officialUpdated', { when: officialWhen }) }}</span>
      </p>
      <p v-if="officialStatus === 'offline'" class="src-line warn">{{ t('results.officialOffline') }}</p>
      <p v-if="publishMsg" class="src-line" :class="{ warn: publishStatus === 'error' || publishStatus === 'unauthorized' }">{{ publishMsg }}</p>
    </template>

    <p class="tab-hint">
      <template v-if="readonly">{{ t('results.hintReadonly') }}</template>
      <template v-else-if="showGoals">{{ t('results.hintGoals') }}</template>
      <template v-else>{{ t('results.hintWinlose') }}</template>
    </p>

    <!-- Sin datos: los pronósticos importados no traen resultados. -->
    <p v-if="readonly && Object.keys(pred.results).length === 0" class="no-data">
      {{ t('results.noData') }}
    </p>

    <div class="groups-grid">
      <div v-for="(grp, g) in GROUPS" :key="grp.letter" class="group-card">
        <div class="group-head">{{ t('group.title', { letter: grp.letter }) }}</div>
        <div class="match-list">
          <div
            v-for="mm in groupMatches(g)"
            :key="mm.pi"
            class="match-row"
          >
            <span v-if="scoredGroup(g, mm.pi)" class="scored-star" :title="t('scores.scored')">★</span>
            <div class="teams">
              <span class="side home">
                <span class="flag">{{ teamById(teamAt(g, mm.pair[0])).flag }}</span>
                <span class="code">{{ teamById(teamAt(g, mm.pair[0])).code }}</span>
              </span>
              <span class="vs">{{ t('common.vs') }}</span>
              <span class="side away">
                <span class="code">{{ teamById(teamAt(g, mm.pair[1])).code }}</span>
                <span class="flag">{{ teamById(teamAt(g, mm.pair[1])).flag }}</span>
              </span>
            </div>

            <!-- Inputs de goles (solo modo 'score'). -->
            <div v-if="showGoals" class="goals">
              <input
                class="goal"
                type="number"
                min="0"
                max="99"
                inputmode="numeric"
                :disabled="readonly"
                :value="resultOf(g, mm.pi)?.gh ?? ''"
                @input="setGoals(g, mm.pi, 'h', ($event.target as HTMLInputElement).value)"
              />
              <span class="dash">-</span>
              <input
                class="goal"
                type="number"
                min="0"
                max="99"
                inputmode="numeric"
                :disabled="readonly"
                :value="resultOf(g, mm.pi)?.ga ?? ''"
                @input="setGoals(g, mm.pi, 'a', ($event.target as HTMLInputElement).value)"
              />
            </div>

            <!-- Botones gana/empata/pierde: SOLO en modo Medio (winlose). En
                 modo con marcador (score) el resultado lo define el marcador. -->
            <div v-if="!showGoals" class="picks">
              <button
                class="pk"
                :class="{ on: resultOf(g, mm.pi)?.o === 0 }"
                :disabled="readonly"
                :title="t('results.winNamed', { team: teamById(teamAt(g, mm.pair[0])).name })"
                @click="setOutcome(g, mm.pi, 0)"
              >{{ teamById(teamAt(g, mm.pair[0])).code }}</button>
              <button
                class="pk draw"
                :class="{ on: resultOf(g, mm.pi)?.o === 1 }"
                :disabled="readonly"
                :title="t('results.draw')"
                @click="setOutcome(g, mm.pi, 1)"
              >–</button>
              <button
                class="pk"
                :class="{ on: resultOf(g, mm.pi)?.o === 2 }"
                :disabled="readonly"
                :title="t('results.winNamed', { team: teamById(teamAt(g, mm.pair[1])).name })"
                @click="setOutcome(g, mm.pi, 2)"
              >{{ teamById(teamAt(g, mm.pair[1])).code }}</button>
            </div>

            <!-- Fecha y hora local del partido (convertida desde UTC). -->
            <div v-if="kickoff(groupMatchIndex(g, mm.pi))" class="kickoff">
              {{ kickoff(groupMatchIndex(g, mm.pi)) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Eliminatorias: todas las llaves en orden, agrupadas por ronda. Ocultas
         en alcance 'solo grupos'. -->
    <section v-if="showKnockout" class="ko">
      <h3 class="ko-title">{{ t('results.knockout') }}</h3>
      <div v-for="round in koRounds" :key="round.titleKey" class="ko-round">
        <div class="ko-round-head">{{ t(round.titleKey) }}</div>
        <div class="ko-grid">
          <div v-for="num in round.nums" :key="num" class="ko-match">
            <span v-if="scoredKO(num)" class="scored-star" :title="t('scores.scored')">★</span>
            <div class="ko-num">#{{ num }}</div>

            <!-- Lado local. -->
            <div class="ko-side" :class="{ winner: koChosen(num) != null && koChosen(num) === rm(num)?.home }">
              <template v-if="rm(num)?.home != null">
                <span class="flag">{{ teamById(rm(num)!.home!).flag }}</span>
                <span class="code">{{ teamById(rm(num)!.home!).code }}</span>
              </template>
              <span v-else class="ph">{{ placeholder(num, true) }}</span>

              <!-- Score/Completo: goles deciden; si hay empate, penales. -->
              <template v-if="showGoals">
                <input
                  class="goal" type="number" min="0" max="99" inputmode="numeric"
                  :disabled="readonly"
                  :value="koResult(num)?.gh ?? ''"
                  @input="koSetGoals(num, 'h', ($event.target as HTMLInputElement).value)"
                />
                <input
                  v-if="koIsTie(num)" class="goal pen" type="number" min="0" max="99" inputmode="numeric"
                  :title="t('results.penalties')" :placeholder="t('results.pensAbbr')"
                  :disabled="readonly"
                  :value="koResult(num)?.ph ?? ''"
                  @input="koSetPens(num, 'h', ($event.target as HTMLInputElement).value)"
                />
              </template>
              <!-- Medio (winlose): no hay goles, se elige quién avanza. -->
              <button
                v-else
                class="ko-win"
                :class="{ on: koChosen(num) != null && koChosen(num) === rm(num)?.home }"
                :disabled="readonly || rm(num)?.home == null"
                @click="koChoose(num, rm(num)?.home ?? null)"
              >{{ t('results.advance') }}</button>
            </div>

            <!-- Lado visitante. -->
            <div class="ko-side" :class="{ winner: koChosen(num) != null && koChosen(num) === rm(num)?.away }">
              <template v-if="rm(num)?.away != null">
                <span class="flag">{{ teamById(rm(num)!.away!).flag }}</span>
                <span class="code">{{ teamById(rm(num)!.away!).code }}</span>
              </template>
              <span v-else class="ph">{{ placeholder(num, false) }}</span>

              <template v-if="showGoals">
                <input
                  class="goal" type="number" min="0" max="99" inputmode="numeric"
                  :disabled="readonly"
                  :value="koResult(num)?.ga ?? ''"
                  @input="koSetGoals(num, 'a', ($event.target as HTMLInputElement).value)"
                />
                <input
                  v-if="koIsTie(num)" class="goal pen" type="number" min="0" max="99" inputmode="numeric"
                  :title="t('results.penalties')" :placeholder="t('results.pensAbbr')"
                  :disabled="readonly"
                  :value="koResult(num)?.pa ?? ''"
                  @input="koSetPens(num, 'a', ($event.target as HTMLInputElement).value)"
                />
              </template>
              <button
                v-else
                class="ko-win"
                :class="{ on: koChosen(num) != null && koChosen(num) === rm(num)?.away }"
                :disabled="readonly || rm(num)?.away == null"
                @click="koChoose(num, rm(num)?.away ?? null)"
              >{{ t('results.advance') }}</button>
            </div>

            <!-- Fecha y hora local del partido (convertida desde UTC). -->
            <div v-if="kickoff(num)" class="kickoff">{{ kickoff(num) }}</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Barra de utilidades de resultados */
.util-bar { display: flex; gap: 0.4rem; flex-wrap: wrap; justify-content: center; margin-bottom: 0.9rem; }
.util {
  background: transparent; color: var(--muted); border: 1px solid var(--line);
  border-radius: 50px; padding: 0.4rem 0.9rem; cursor: pointer;
  font-family: inherit; font-weight: 700; font-size: 0.8rem;
}
.util:hover { background: rgba(255, 255, 255, 0.06); color: var(--text); }
.util.official { color: var(--azure); border-color: var(--azure); }
.util.official:hover { background: rgba(65, 180, 255, 0.18); color: var(--azure); }
.util.publish { color: var(--lime, #b6e34a); border-color: var(--lime, #b6e34a); }
.util.publish:hover { background: rgba(182, 227, 74, 0.16); }
.util:disabled { opacity: 0.5; cursor: default; }

/* Procedencia de los resultados oficiales (de dónde vienen los valores). */
.src-line {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem;
  margin: 0.1rem 0 0.4rem; font-size: 0.78rem; color: var(--muted);
}
.src-line.warn { color: #ffb454; }
.src-lbl { font-weight: 700; }
.src-chip {
  border: 1px solid var(--line); border-radius: 50px; padding: 0.05rem 0.5rem;
  font-weight: 700; font-size: 0.72rem; color: var(--azure); border-color: var(--azure);
}
.src-chip.off { color: var(--muted); border-color: var(--line); text-decoration: line-through; }
.src-chip.manual { color: var(--lime, #b6e34a); border-color: var(--lime, #b6e34a); }
.src-when { opacity: 0.8; }

.tab-hint { color: var(--muted); font-size: 0.83rem; margin-bottom: 0.9rem; text-align: center; }
.no-data {
  color: var(--gold); text-align: center; font-size: 0.85rem;
  margin-bottom: 1rem; padding: 0.6rem; border: 1px dashed var(--line); border-radius: 10px;
}
.groups-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.85rem; }
.group-card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  overflow: hidden; box-shadow: var(--shadow);
}
.group-head { background: var(--green-d); padding: 0.5rem 0.85rem; font-weight: 700; letter-spacing: 0.03em; }
.match-list { display: flex; flex-direction: column; }
.match-row {
  position: relative;
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  padding: 0.5rem 0.7rem; border-top: 1px solid var(--line);
}
/* Estrella en partidos que sumaron puntos vs los resultados oficiales. */
.scored-star {
  position: absolute; top: 1px; left: 2px; z-index: 1;
  color: var(--gold); font-size: 0.72rem; line-height: 1; pointer-events: none;
  text-shadow: 0 0 4px rgba(255, 207, 63, 0.5);
}
.teams { display: flex; align-items: center; gap: 0.4rem; flex: 1; min-width: 9.5rem; }
.side { display: inline-flex; align-items: center; gap: 0.3rem; }
/* Equipos compactos a la izquierda: la 1.ª bandera marca el borde donde
   arranca la fecha (que va en su propia línea, alineada a ese borde). */
.side.home { justify-content: flex-start; flex: 0 0 auto; }
.side.away { justify-content: flex-start; flex: 0 0 auto; }
.flag { font-size: 1.15rem; line-height: 1; }
.code { font-size: 0.85rem; font-weight: 700; }
.vs { color: var(--muted); font-size: 0.75rem; }
.goals { display: flex; align-items: center; gap: 0.25rem; }
.goal {
  width: 2.4rem; text-align: center; background: var(--bg); color: var(--text);
  border: 1px solid var(--line); border-radius: 8px; padding: 0.25rem; font-family: inherit;
  font-size: 0.9rem; font-variant-numeric: tabular-nums;
}
.goal:disabled { opacity: 0.6; }
.dash { color: var(--muted); }
.picks { display: flex; gap: 0.2rem; }
.pk {
  min-width: 2.6rem; height: 1.9rem; padding: 0 0.45rem;
  border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--muted); font-weight: 800; cursor: pointer;
  font-family: var(--font-display); letter-spacing: 0.03em; font-size: 0.82rem;
}
.pk.draw { min-width: 1.9rem; padding: 0; font-family: inherit; }
.pk:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); color: var(--text); }
.pk.on { background: var(--azure); color: #042038; border-color: var(--azure); }
.pk:disabled { cursor: default; }

/* Fecha/hora local del partido: línea chica y tenue debajo de cada fila. */
.kickoff { flex-basis: 100%; color: var(--muted); font-size: 0.62rem; opacity: 0.85; margin-top: -0.3rem; }
.ko-match .kickoff { margin-top: 0.1rem; padding: 0 0.3rem; }

/* --- Eliminatorias --- */
.ko { margin-top: 1.6rem; }
.ko-title {
  margin: 0 0 0.8rem; font-size: 1rem; font-weight: 800; letter-spacing: 0.03em;
  text-transform: uppercase; color: var(--azure);
}
.ko-round { margin-bottom: 1rem; }
.ko-round-head {
  color: var(--green); font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; margin-bottom: 0.45rem;
}
.ko-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.6rem; }
.ko-match {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 0.5rem 0.6rem; box-shadow: var(--shadow); position: relative;
}
.ko-num {
  position: absolute; top: 0.35rem; right: 0.5rem; color: var(--muted);
  font-size: 0.62rem; font-weight: 700; opacity: 0.7;
}
.ko-side {
  display: flex; align-items: center; gap: 0.4rem; padding: 0.25rem 0.3rem; min-height: 1.9rem;
  border-radius: 8px;
}
/* Lado que avanza (decidido por goles/penales). */
.ko-side.winner { background: rgba(46, 204, 113, 0.16); }
.ko-side.winner .code { color: var(--green); font-weight: 800; }
.ko-side .code { flex: 1; }
.ko-side .ph { flex: 1; color: var(--muted); font-size: 0.78rem; font-style: italic; }
/* Casilla de penales (más chica, destacada). */
.goal.pen { width: 1.9rem; border-color: var(--gold); color: var(--gold); }
.ko-win {
  border: 1px solid var(--line); border-radius: 8px; background: transparent;
  color: var(--muted); font-weight: 700; cursor: pointer; font-family: inherit;
  font-size: 0.72rem; padding: 0.25rem 0.55rem; white-space: nowrap;
}
.ko-win:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); color: var(--text); }
.ko-win.on { background: var(--azure); color: #042038; border-color: var(--azure); }
.ko-win:disabled { cursor: default; opacity: 0.5; }
</style>
