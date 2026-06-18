<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamById, GROUP_LETTERS } from '../lib/teams'
import { resolveMatches, type Prediction, type ResolvedMatch } from '../lib/prediction'
import { decodePrediction } from '../lib/codec'
import { R32, R16, QF, SF, FINAL, THIRD_PLACE, type Slot } from '../lib/bracket'
import MatchBox, { type SideView } from './MatchBox.vue'
import type { SavedPrediction } from '../lib/store'

const { t } = useI18n()

const props = defineProps<{ pred: Prediction; readonly?: boolean; official?: SavedPrediction | null }>()

const resolved = computed(() => resolveMatches(props.pred))
function m (num: number): ResolvedMatch | undefined { return resolved.value.get(num) }

// Acierto de quién avanza en un cruce, vs los resultados oficiales (estrella).
const officialPicks = computed<Record<number, number>>(() => {
  try { return props.official?.code ? decodePrediction(props.official.code).picks : {} } catch { return {} }
})
function scoredKO (num: number): boolean {
  if (!props.official) return false
  const pw = resolved.value.get(num)?.winner ?? null
  const ow = officialPicks.value[num] ?? null
  return pw != null && ow != null && pw === ow
}

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

function side (num: number, top: boolean): SideView {
  const match = m(num)
  const teamId = (top ? match?.home : match?.away) ?? null
  if (teamId != null) {
    const t = teamById(teamId)
    return { teamId, flag: t.flag, code: t.code, label: '' }
  }
  let label = ''
  const r32 = r32Slots.get(num)
  if (r32) label = slotLabel(top ? r32.home : r32.away)
  else if (num === THIRD_PLACE.num) label = t('bracket.loserSF')
  else {
    const from = laterFrom.get(num)
    if (from) label = t('bracket.winnerNum', { n: from[top ? 0 : 1] })
  }
  return { teamId: null, flag: '', code: '', label }
}

function sides (num: number): [SideView, SideView] { return [side(num, true), side(num, false)] }
function chosen (num: number): number | null { return props.pred.picks[num] ?? null }

// "Incompleto": el cruce todavía no está resuelto. Es incompleto si le falta
// algún equipo (uno o ambos cupos vacíos, p.ej. "Ganador 74") O si ya tiene sus
// dos equipos pero aún no se eligió quién avanza (su "hijo" sin seleccionar).
// Solo queda completo cuando tiene ambos equipos y ganador marcado. En lectura
// no se resalta.
function pending (num: number): boolean {
  if (props.readonly) return false
  const match = m(num)
  const home = match?.home ?? null
  const away = match?.away ?? null
  if (home == null || away == null) return true
  return chosen(num) == null
}

function choose (num: number, teamId: number | null) {
  // Se permite elegir aunque el rival esté vacío (basta con que el cupo tocado
  // tenga equipo).
  if (props.readonly || teamId == null) return
  if (props.pred.picks[num] === teamId) delete props.pred.picks[num]
  else props.pred.picks[num] = teamId
}

const leftCols = [
  { titleKey: 'bracket.r32Short', nums: [74, 77, 73, 75, 83, 84, 81, 82] },
  { titleKey: 'bracket.r16Short', nums: [89, 90, 93, 94] },
  { titleKey: 'bracket.qfShort', nums: [97, 98] },
  { titleKey: 'bracket.sfShort', nums: [101] },
]
const rightCols = [
  { titleKey: 'bracket.sfShort', nums: [102] },
  { titleKey: 'bracket.qfShort', nums: [99, 100] },
  { titleKey: 'bracket.r16Short', nums: [91, 92, 95, 96] },
  { titleKey: 'bracket.r32Short', nums: [76, 78, 79, 80, 86, 88, 85, 87] },
]

const championId = computed(() => m(FINAL.num)?.winner ?? null)
// Ganador del partido por el 3.er puesto (medalla de bronce). null si aún no se
// definió (la medalla queda apagada para que se note que falta llenarlo).
const bronzeId = computed(() => m(THIRD_PLACE.num)?.winner ?? null)

// --- Conectores ("palitos") del bracket ---------------------------------
// Con `justify-content:space-around`, el centro del partido i (de N) cae en la
// fracción (2i+1)/(2N) del alto de la columna. Aprovechamos eso para dibujar
// las líneas con porcentajes (sin medidas fijas), de modo que sigan alineadas
// aunque el alto sea flexible.
interface Connector {
  /** centro del par destino, en % del alto de la columna (también el centro
   *  de la línea horizontal de salida) */
  midPct: number
  /** extremos del tramo vertical que une el par, en % */
  topPct: number
  botPct: number
}

// Devuelve los conectores de una columna de N partidos (los une de a pares).
function connectorsFor (n: number): Connector[] {
  const out: Connector[] = []
  for (let pair = 0; pair < n / 2; pair++) {
    const a = pair * 2
    const b = pair * 2 + 1
    const fa = ((2 * a + 1) / (2 * n)) * 100
    const fb = ((2 * b + 1) / (2 * n)) * 100
    out.push({ topPct: fa, botPct: fb, midPct: (fa + fb) / 2 })
  }
  return out
}

// Para la columna de semis (1 partido) basta un único stub horizontal centrado
// hacia la final; lo tratamos como "par" degenerado sin tramo vertical.
function connectorsForCol (nums: number[]): Connector[] {
  if (nums.length <= 1) return [{ topPct: 50, botPct: 50, midPct: 50 }]
  return connectorsFor(nums.length)
}
</script>

<template>
  <div class="bracket">
    <p class="hint">
      {{ t('bracket.hint') }}
    </p>

    <div class="board">
      <div v-for="(col, ci) in leftCols" :key="'l' + ci" class="col">
        <span class="col-title">{{ t(col.titleKey) }}</span>
        <div class="col-matches">
          <MatchBox
            v-for="num in col.nums"
            :key="num"
            :sides="sides(num)"
            :chosen="chosen(num)"
            :clickable="!readonly"
            :scored="scoredKO(num)"
            :pending="pending(num)"
            @choose="choose(num, $event)"
          />
          <!-- Conectores hacia la columna siguiente (salen por la derecha). -->
          <div class="connectors right" aria-hidden="true">
            <div
              v-for="(c, k) in connectorsForCol(col.nums)"
              :key="k"
              class="conn"
              :class="{ single: c.topPct === c.botPct }"
              :style="{ top: c.topPct + '%', bottom: (100 - c.botPct) + '%' }"
            >
              <!-- stubs horizontales que salen de cada partido del par -->
              <span class="conn-h conn-h-top" />
              <span class="conn-h conn-h-bot" />
              <!-- tramo vertical que une el par -->
              <span class="conn-v" />
              <!-- horizontal de salida desde el centro del par hacia la
                   columna siguiente -->
              <span class="conn-out" />
            </div>
          </div>
        </div>
      </div>

      <div class="col center">
        <span class="trophy" :class="{ won: championId != null }">🏆</span>
        <MatchBox
          big
          :sides="sides(FINAL.num)"
          :chosen="chosen(FINAL.num)"
          :clickable="!readonly"
          :scored="scoredKO(FINAL.num)"
          :pending="pending(FINAL.num)"
          @choose="choose(FINAL.num, $event)"
        />
        <div v-if="championId != null" class="champ-name">
          {{ teamById(championId).flag }} {{ teamById(championId).name }}
        </div>
        <div class="third">
          <span class="medal" :class="{ won: bronzeId != null }" :title="t('bracket.bronze')">🥉</span>
          <span class="col-title">{{ t('bracket.thirdPlace') }}</span>
          <MatchBox
            :sides="sides(THIRD_PLACE.num)"
            :chosen="chosen(THIRD_PLACE.num)"
            :clickable="!readonly"
            :scored="scoredKO(THIRD_PLACE.num)"
            :pending="pending(THIRD_PLACE.num)"
            @choose="choose(THIRD_PLACE.num, $event)"
          />
          <div v-if="bronzeId != null" class="bronze-name">
            {{ teamById(bronzeId).flag }} {{ teamById(bronzeId).name }}
          </div>
        </div>
      </div>

      <div v-for="(col, ci) in rightCols" :key="'r' + ci" class="col">
        <span class="col-title">{{ t(col.titleKey) }}</span>
        <div class="col-matches">
          <!-- Conectores hacia la columna siguiente (espejo: salen por la
               izquierda). En la mitad derecha el flujo va hacia el centro,
               por eso conectamos desde la columna actual hacia su izquierda. -->
          <div class="connectors left" aria-hidden="true">
            <div
              v-for="(c, k) in connectorsForCol(col.nums)"
              :key="k"
              class="conn"
              :class="{ single: c.topPct === c.botPct }"
              :style="{ top: c.topPct + '%', bottom: (100 - c.botPct) + '%' }"
            >
              <span class="conn-h conn-h-top" />
              <span class="conn-h conn-h-bot" />
              <span class="conn-v" />
              <span class="conn-out" />
            </div>
          </div>
          <MatchBox
            v-for="num in col.nums"
            :key="num"
            :sides="sides(num)"
            :chosen="chosen(num)"
            :clickable="!readonly"
            :scored="scoredKO(num)"
            :pending="pending(num)"
            @choose="choose(num, $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bracket { padding-bottom: 2rem; }
.hint { text-align: center; color: var(--muted); font-size: 0.8rem; margin-bottom: 1rem; flex-shrink: 0; }

/* Las columnas reparten el ancho disponible y entran SIN scroll, tanto en
   móvil como en escritorio. */
.board {
  display: flex; align-items: stretch; gap: 2px; padding-bottom: 1rem;
  width: 100%; max-width: 100%; overflow: hidden;
}

/* En escritorio el bracket llena el alto disponible (app-shell sin scroll
   vertical): el tablero crece y space-around reparte los partidos. */
.col { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; }
.col-title {
  text-align: center; color: var(--green); font-size: 0.54rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 0.3rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.col-matches {
  flex: 1; display: flex; flex-direction: column; justify-content: space-around; gap: 0.25rem;
  position: relative; /* lienzo para los conectores */
}

/* --- Conectores del bracket ------------------------------------------------
   Capa absoluta sobre la columna; el ancho del "stub" se sale al gap entre
   columnas. No intercepta clicks. */
.connectors {
  position: absolute; top: 0; bottom: 0; width: 0; pointer-events: none; z-index: 1;
}
.connectors.right { right: 0; }
.connectors.left { left: 0; }

/* Cada par: contenedor cuyo alto abarca del centro del partido superior al
   del inferior (en %). Dentro dibujamos las líneas. */
.conn { position: absolute; width: 0; }
.connectors.right .conn { right: 0; }
.connectors.left .conn { left: 0; }

/* Grosor y color tenues, compartidos por todas las líneas. */
.conn-h, .conn-v, .conn-out { position: absolute; background: var(--line); }
.conn-h, .conn-out { height: 1px; }
.conn-v { width: 1px; }

/* Largo del stub horizontal hacia afuera (la mitad del gap aprox.). */
.connectors.right .conn-h,
.connectors.right .conn-out { left: 0; width: 4px; }
.connectors.left .conn-h,
.connectors.left .conn-out { right: 0; width: 4px; }

/* Stubs en los extremos (centros de cada partido del par). */
.conn-h-top { top: 0; }
.conn-h-bot { bottom: 0; }

/* Tramo vertical que une los dos extremos del par, al final de los stubs. */
.conn-v { top: 0; bottom: 0; }
.connectors.right .conn-v { left: 4px; }
.connectors.left .conn-v { right: 4px; }

/* Horizontal de salida desde el centro del par hacia la columna siguiente. */
.conn-out { top: 50%; }
.connectors.right .conn-out { left: 4px; width: 6px; }
.connectors.left .conn-out { right: 4px; width: 6px; }

/* Caso degenerado (semis, 1 partido): sin tramo vertical ni stubs de par,
   solo un palito recto hacia la final. */
.conn.single .conn-h, .conn.single .conn-v { display: none; }
.conn.single .conn-out { top: 0; }
.connectors.right .conn.single .conn-out { left: 0; }
.connectors.left .conn.single .conn-out { right: 0; }

.center { flex: 1.4 1 0; justify-content: center; align-items: center; gap: 0.4rem; }
.center > * { width: 100%; }
.trophy { font-size: 1.7rem; text-align: center; filter: grayscale(1) opacity(0.4); transition: filter 0.3s; }
.trophy.won { filter: none; text-shadow: 0 0 18px rgba(255, 207, 63, 0.6); }
.champ-name { color: var(--gold); font-weight: 800; font-size: 0.78rem; text-align: center; }
.third { margin-top: 0.6rem; }
/* Medalla de bronce del 3.er puesto: apagada (gris) hasta que se define, igual
   que el trofeo del campeón, para que se note que falta elegir el ganador. */
.medal { display: block; font-size: 1.2rem; text-align: center; filter: grayscale(1) opacity(0.4); transition: filter 0.3s; margin-bottom: 0.1rem; }
.medal.won { filter: none; text-shadow: 0 0 14px rgba(205, 127, 50, 0.6); }
.bronze-name { color: #cd7f32; font-weight: 800; font-size: 0.74rem; text-align: center; margin-top: 0.2rem; }

@media (min-width: 760px) {
  /* Mismo reparto flexible, solo con más aire y tipografías mayores. */
  .board { gap: 0.5rem; }
  .center { flex: 1.6 1 0; }
  .trophy { font-size: 2.6rem; }
  .col-title { font-size: 0.7rem; }
}
</style>
