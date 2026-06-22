<script setup lang="ts">
// Compartir un PRONÓSTICO: reusa el Web Component COMPARTIDO del ecosistema
// (<dotrino-share>) para QR/copiar/redes, y le inyecta por el slot "actions"
// los botones propios de esta app (Imprimir / PDF de la hoja del pronóstico).
// Es el mismo modal que cuarenta/ajedrez; aquí solo cambia la URL (firmada) y se
// agregan las acciones extra.
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildShareUrl, type PredictionSeal } from '../lib/share'
import { getNotificationsController } from '../lib/notifications'
import '@dotrino/share'

const { t, locale } = useI18n()

// presetSeal: sello GUARDADO del pronóstico (se reutiliza en el enlace: la fecha
// certificada es la del sellado, no la de esta compartida). El sello usado se
// emite en `sealed` para que App lo persista (compartir autosella).
const props = defineProps<{ code: string; open: boolean; name?: string; presetUrl?: string | null; presetSeal?: PredictionSeal | null }>()
const emit = defineEmits<{ close: []; print: [url: string]; pdf: [url: string]; sealed: [seal: PredictionSeal, code: string] }>()

const url = ref('')
const nickname = ref<string | undefined>(undefined)

// Solo tiene sentido pedir "avísame cuando lo abran" al compartir un pronóstico
// PROPIO (el enlace lleva mi pubkey → el acuse vuelve a mí). En uno ajeno
// re-compartido el acuse iría al autor original, no a mí.
const trackable = computed(() => !props.presetUrl)
// Inyecta el controlador de notificaciones como PROPIEDAD del custom element
// (no atributo), igual patrón que <dotrino-profile>.
function bindShare (el: (Element & { notifications?: unknown }) | null) {
  if (el) el.notifications = getNotificationsController()
}

async function generate () {
  url.value = ''
  try {
    // Pronóstico ajeno: reusamos su enlace original (ya firmado por su autor).
    if (props.presetUrl) { url.value = props.presetUrl; nickname.value = undefined }
    else {
      // Capturado ANTES del await: el sello corresponde a ESTE código. Si el
      // usuario edita mientras el sellador responde (hasta 8 s), emitir el code
      // sellado permite al receptor descartar el sello desfasado.
      const code = props.code
      const res = await buildShareUrl(code, props.name, props.presetSeal)
      url.value = res.url
      nickname.value = res.nickname
      if (res.seal) emit('sealed', res.seal, code)
    }
  } catch { url.value = '' }
}
watch(() => props.open, (o) => { if (o) generate() })

const hint = computed(() => {
  const by = t('share.signedBy', { name: nickname.value || t('share.anonIdentity') })
  return `${by} · ${t('share.scan')} pronostico.dotrino.com`
})

const theme = {
  '--ccs-bg': 'var(--panel)', '--ccs-text': 'var(--text)', '--ccs-muted': 'var(--muted)',
  '--ccs-border': 'var(--line)', '--ccs-accent': 'var(--green-d)', '--ccs-accent-text': '#fff',
  '--ccs-input-bg': 'var(--bg)',
}
</script>

<template>
  <dotrino-share
    :ref="bindShare"
    :lang="locale"
    :style="theme"
    :url="url"
    :heading="t('share.title')"
    :hint="hint"
    :open="open"
    :track="trackable ? '' : null"
    @cc-share-close="emit('close')"
  >
    <!-- acciones propias de pronosticador: imprimir / PDF de la hoja -->
    <div slot="actions" class="print-row">
      <button class="act-btn print" @click="emit('print', url)" :disabled="!url">
        <span class="ico">🖨</span> {{ t('common.print') }}
      </button>
      <button class="act-btn pdf" @click="emit('pdf', url)" :disabled="!url">
        <img src="/pdf.svg" alt="" class="pdf-ico" /> {{ t('common.pdf') }}
      </button>
    </div>
  </dotrino-share>
</template>

<style scoped>
.print-row { display: flex; gap: 0.5rem; width: 100%; }
.act-btn {
  flex: 1; border: none; border-radius: 8px; padding: 0.6rem; font-weight: 800;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.4rem;
}
.act-btn .ico { font-size: 1.05rem; }
.act-btn .pdf-ico { display: block; width: 15px; height: 18px; flex-shrink: 0; }
.act-btn:hover { filter: brightness(1.06); }
.act-btn:disabled { opacity: 0.5; cursor: default; }
/* Imprimir: contorno azul (acción "ligera"). */
.act-btn.print { background: transparent; color: var(--azure); border: 1.5px solid var(--azure); }
/* Descargar PDF: fondo claro con borde rojo para que se vea el ícono oficial. */
.act-btn.pdf { background: #fff; color: #b3160c; border: 1.5px solid #d4362d; }
</style>
