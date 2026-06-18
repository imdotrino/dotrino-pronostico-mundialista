<script setup lang="ts">
// Tabla de posiciones de un grupo, en SOLO LECTURA, calculada en vivo desde los
// resultados (modos 'winlose'/'score'). Reutiliza el estilo de GroupCard.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamById } from '../lib/teams'
import { groupStandingsTable } from '../lib/standings'
import type { Prediction } from '../lib/prediction'

const { t } = useI18n()

const props = defineProps<{ pred: Prediction; group: number; letter: string }>()

// Filas 1º..4º ya ordenadas por el algoritmo del modelo.
const rows = computed(() => groupStandingsTable(props.group, props.pred.results, props.pred.mode))

// En modo 'score' mostramos columnas de diferencia de gol (DG) y goles (GF).
const showGoals = computed(() => props.pred.mode === 'score')

const POS = ['1º', '2º', '3º', '4º']
</script>

<template>
  <div class="group-card" data-testid="standings-table" :data-letter="letter">
    <div class="group-head">
      {{ t('group.title', { letter }) }}
      <span class="cols">
        <span class="ch">{{ t('standings.pts') }}</span>
        <template v-if="showGoals">
          <span class="ch">{{ t('standings.gd') }}</span>
          <span class="ch">{{ t('standings.gf') }}</span>
        </template>
      </span>
    </div>
    <div class="team-list">
      <div
        v-for="(row, index) in rows"
        :key="row.teamId"
        class="team-row"
        data-testid="standings-row"
        :data-team-id="row.teamId"
        :class="{ qualifies: index < 2, third: index === 2 }"
      >
        <span class="pos">{{ POS[index] }}</span>
        <span class="flag">{{ teamById(row.teamId).flag }}</span>
        <span class="name">{{ teamById(row.teamId).name }}</span>
        <span class="cols">
          <span class="cv pts" data-testid="standings-pts">{{ row.pts }}</span>
          <template v-if="showGoals">
            <span class="cv">{{ row.gd > 0 ? '+' + row.gd : row.gd }}</span>
            <span class="cv">{{ row.gf }}</span>
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.group-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow);
}
.group-head {
  background: var(--green-d);
  padding: 0.5rem 0.85rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cols { display: flex; gap: 0.35rem; }
.ch { width: 2.1rem; text-align: center; font-size: 0.7rem; color: var(--muted); font-weight: 700; }
.team-list { display: flex; flex-direction: column; }
.team-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.7rem;
  border-top: 1px solid var(--line);
  background: var(--panel);
}
.team-row.qualifies { background: rgba(65, 180, 255, 0.14); }
.team-row.third { background: rgba(255, 207, 63, 0.1); }
.pos { width: 1.6rem; font-size: 0.8rem; color: var(--muted); font-weight: 700; }
.flag { font-size: 1.3rem; line-height: 1; }
.name { flex: 1; font-size: 0.95rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv { width: 2.1rem; text-align: center; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.cv.pts { font-weight: 800; color: var(--azure); }
</style>
