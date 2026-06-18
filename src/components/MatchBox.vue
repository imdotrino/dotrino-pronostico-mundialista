<script lang="ts">
// Caja de un partido de eliminatorias: dos cupos (arriba/abajo) mostrando
// bandera + código de país. Presentacional: recibe los datos ya resueltos.
export interface SideView {
  teamId: number | null
  flag: string
  code: string
  /** etiqueta cuando el cupo está vacío (p.ej. "1.º A" o "Ganador 89") */
  label: string
}
</script>

<script setup lang="ts">
defineProps<{
  sides: [SideView, SideView]
  chosen: number | null
  clickable: boolean
  big?: boolean
  /** true si en este cruce se acertó quién avanza (vs resultados oficiales). */
  scored?: boolean
  /** true si el cruce se puede llenar pero aún no se eligió ganador. */
  pending?: boolean
}>()
const emit = defineEmits<{ choose: [teamId: number | null] }>()
</script>

<template>
  <div class="match" :class="{ big, pending }">
    <span v-if="scored" class="scored-star" title="★">★</span>
    <button
      v-for="(s, i) in sides"
      :key="i"
      type="button"
      class="side"
      :class="{
        picked: s.teamId != null && chosen === s.teamId,
        empty: s.teamId == null,
        clickable: clickable && s.teamId != null,
      }"
      @click="emit('choose', s.teamId)"
    >
      <template v-if="s.teamId != null">
        <span class="flag">{{ s.flag }}</span>
        <span class="code">{{ s.code }}</span>
      </template>
      <span v-else class="ph">{{ s.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.match {
  position: relative;
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  overflow: hidden; display: flex; flex-direction: column;
}
/* Estrella: se acertó quién avanza en este cruce (vs resultados oficiales). */
.scored-star {
  position: absolute; top: 0; left: 1px; z-index: 2; pointer-events: none;
  color: var(--gold); font-size: 0.6rem; line-height: 1; text-shadow: 0 0 4px rgba(255, 207, 63, 0.6);
}
.side {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 1px; min-width: 0; min-height: 30px;
  background: transparent; border: none; color: var(--text);
  padding: 0.25rem 0.15rem; cursor: default; border-top: 1px solid var(--line);
}
.side:first-child { border-top: none; }
.side.clickable { cursor: pointer; }
.side.clickable:hover { background: var(--panel-2); }
.side.picked { background: rgba(65, 180, 255, 0.24); box-shadow: inset 0 0 0 1px rgba(65, 180, 255, 0.5); }
.side.picked .code { color: var(--green); }
.flag { font-size: 1.15rem; line-height: 1; }
.code { font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.04em; line-height: 1; }
.ph { font-size: 0.56rem; color: var(--muted); font-style: italic; text-align: center; line-height: 1.05; }

/* Incompleto: el cruce se puede llenar pero falta elegir ganador. SOLO borde
   cálido que contrasta con el azul para que salte a la vista (sin relleno). */
.match.pending {
  border-color: var(--pending);
  box-shadow: inset 0 0 0 1px var(--pending);
}
.match.pending .ph { color: var(--pending); font-style: normal; opacity: 0.95; }

.match.big { border-color: var(--gold); box-shadow: 0 0 18px rgba(255, 207, 63, 0.18); }
/* La final (big) sin campeón también es un cruce por llenar: mismo borde
   cálido; recupera el marco dorado al elegir campeón (ya no está pendiente). */
.match.big.pending {
  border-color: var(--pending);
  box-shadow: inset 0 0 0 1px var(--pending);
}
.match.big .flag { font-size: 1.7rem; }
.match.big .code { font-size: 0.95rem; }
.match.big .side { min-height: 54px; padding: 0.5rem; }

@media (min-width: 760px) {
  .flag { font-size: 1.35rem; }
  .code { font-size: 0.82rem; }
  /* Sin bump de alto: en escritorio el bracket llena el alto disponible y los
     partidos se distribuyen con space-around (ver BracketTab .board flex:1). */
}
</style>
