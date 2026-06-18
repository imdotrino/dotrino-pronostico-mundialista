declare module 'vuedraggable' {
  import type { DefineComponent } from 'vue'
  const draggable: DefineComponent<Record<string, unknown>>
  export default draggable
}

// El subpath `/vue` de @dotrino/nav@0.2.0 no trae tipos
// (sí existen desde 0.2.1 vía `exports["./vue"].types`). Shim temporal hasta
// subir la dependencia a ≥0.2.1; entonces se puede borrar este bloque.
declare module '@dotrino/nav/vue' {
  import type { Ref } from 'vue'
  export function useBackLayer (
    openRef: Ref<unknown>,
    opts?: {
      onClose?: () => void
      nav?: unknown
      url?: string | (() => string)
    }
  ): { nav: unknown }
}
