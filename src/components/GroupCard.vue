<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
import { teamById, type Team } from '../lib/teams'
import type { Prediction } from '../lib/prediction'

const { t } = useI18n()

const props = defineProps<{ pred: Prediction; group: number; letter: string; readonly?: boolean }>()

// v-model bidireccional: lee/escribe el orden de team ids del grupo en el
// BORRADOR (las posiciones confirmadas solo cambian al "Confirmar cambios").
const teams = computed<Team[]>({
  get: () => props.pred.draftGroupOrder[props.group]!.map(teamById),
  set: (list) => { props.pred.draftGroupOrder[props.group] = list.map((t) => t.id) },
})

const POS = ['1º', '2º', '3º', '4º']

// En mobile (puntero grueso) el drag arranca SOLO desde el grip de los 9 puntos,
// para no robarle el gesto al scroll. En desktop, arrastra desde cualquier punto.
const dragHandle = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? '.drag' : undefined
</script>

<template>
  <div class="group-card" data-testid="group-card" :data-letter="letter">
    <div class="group-head">{{ t('group.title', { letter }) }}</div>
    <draggable
      v-model="teams"
      item-key="id"
      :animation="160"
      ghost-class="ghost"
      :disabled="readonly"
      :handle="dragHandle"
      class="team-list"
    >
      <template #item="{ element, index }">
        <div class="team-row" data-testid="team-row" :data-team-id="element.id" :class="{ qualifies: index < 2, third: index === 2, grab: !readonly }">
          <span class="pos">{{ POS[index] }}</span>
          <span class="flag">{{ element.flag }}</span>
          <span class="name">{{ element.name }}</span>
          <span v-if="!readonly" class="drag" :aria-label="t('common.reorder')">⋮⋮</span>
        </div>
      </template>
    </draggable>
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
}
.team-list { display: flex; flex-direction: column; }
.team-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.7rem;
  border-top: 1px solid var(--line);
  background: var(--panel);
  cursor: default;
}
.team-row.grab { cursor: grab; }
.team-row.grab:active { cursor: grabbing; }
.team-row.qualifies { background: rgba(65, 180, 255, 0.14); }
.team-row.third { background: rgba(255, 207, 63, 0.1); }
.pos { width: 1.6rem; font-size: 0.8rem; color: var(--muted); font-weight: 700; }
.flag { font-size: 1.3rem; line-height: 1; }
.name { flex: 1; font-size: 0.95rem; }
.drag { cursor: grab; color: var(--muted); padding: 0 0.2rem; touch-action: none; user-select: none; }
.drag:active { cursor: grabbing; }
@media (pointer: coarse) {
  /* En mobile el grip es el único punto de arrastre: tap target más amplio. */
  .drag { padding: 0.35rem 0.55rem; margin: -0.35rem -0.2rem; font-size: 1.1rem; }
}
.ghost { opacity: 0.5; background: var(--panel-2); }
</style>
