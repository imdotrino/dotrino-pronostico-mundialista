<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// Fila reusable de botones de compartir en redes sociales. Opera sobre una URL
// ya armada (firmada/lista para compartir) y un texto corto opcional.
const props = defineProps<{ url: string; text?: string }>()

const shareText = () => props.text || t('share.shareText')

// Abre un enlace de compartir en una pestaña nueva (sin acceso al opener).
function openShare (href: string): void {
  window.open(href, '_blank', 'noopener')
}

// WhatsApp: texto + enlace en el mismo parámetro.
function shareWhatsApp (): void {
  openShare('https://wa.me/?text=' + encodeURIComponent(shareText() + ' ' + props.url))
}

// Telegram: enlace y texto en parámetros separados.
function shareTelegram (): void {
  openShare('https://t.me/share/url?url=' + encodeURIComponent(props.url) + '&text=' + encodeURIComponent(shareText()))
}

// X (Twitter): intent de tweet.
function shareX (): void {
  openShare('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText()) + '&url=' + encodeURIComponent(props.url))
}

// Facebook: sharer clásico.
function shareFacebook (): void {
  openShare('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(props.url))
}

// "Más" / Instagram: usa la Web Share API nativa (en móvil permite elegir
// Instagram u otras apps). Si no está disponible, copia el enlace como fallback.
async function shareNative (): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: shareText(), text: shareText(), url: props.url })
    } catch { /* el usuario canceló o falló: lo ignoramos */ }
  } else {
    try { await navigator.clipboard.writeText(props.url) } catch { /* */ }
  }
}
</script>

<template>
  <div class="social" role="group" :aria-label="t('share.socialGroup')">
    <button class="ico wa" @click="shareWhatsApp" :aria-label="t('share.shareWhatsApp')" title="WhatsApp">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.4 7.4 0 0 1-1.4-1.7c-.1-.2 0-.4.1-.5l.4-.4.2-.4c.1-.1 0-.3 0-.4l-.7-1.7c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1c0 1.2.9 2.4 1 2.6.1.2 1.8 2.7 4.3 3.8.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.4-.2Z"/></svg>
    </button>
    <button class="ico tg" @click="shareTelegram" :aria-label="t('share.shareTelegram')" title="Telegram">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M21.9 4.3 18.6 19.7c-.2 1.1-.9 1.4-1.8.9l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-4.9 9-8.1c.4-.3-.1-.5-.6-.2L6.3 13l-4.8-1.5c-1-.3-1-1 .2-1.5L20.6 2.8c.9-.3 1.6.2 1.3 1.5Z"/></svg>
    </button>
    <button class="ico x" @click="shareX" :aria-label="t('share.shareX')" title="X">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M18.2 2h3.3l-7.2 8.3L23 22h-6.6l-5.2-6.8L5.3 22H2l7.7-8.8L1.4 2H8l4.7 6.2L18.2 2Zm-1.2 18h1.8L7.1 3.9H5.2L17 20Z"/></svg>
    </button>
    <button class="ico fb" @click="shareFacebook" :aria-label="t('share.shareFacebook')" title="Facebook">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"/></svg>
    </button>
    <button class="ico ig" @click="shareNative" :aria-label="t('share.shareNative')" :title="t('share.shareMore')">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.3 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .3-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4a3.8 3.8 0 0 1-1.4-.9 3.8 3.8 0 0 1-.9-1.4c-.2-.4-.3-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.3 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 1.8c-3.1 0-3.5 0-4.7.1-.9 0-1.4.2-1.7.3-.4.2-.7.4-1 .7-.3.3-.5.6-.7 1-.1.3-.3.8-.3 1.7-.1 1.2-.1 1.6-.1 4.7s0 3.5.1 4.7c0 .9.2 1.4.3 1.7.2.4.4.7.7 1 .3.3.6.5 1 .7.3.1.8.3 1.7.3 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c.9 0 1.4-.2 1.7-.3.4-.2.7-.4 1-.7.3-.3.5-.6.7-1 .1-.3.3-.8.3-1.7.1-1.2.1-1.6.1-4.7s0-3.5-.1-4.7c0-.9-.2-1.4-.3-1.7a2.8 2.8 0 0 0-.7-1 2.8 2.8 0 0 0-1-.7c-.3-.1-.8-.3-1.7-.3-1.2-.1-1.6-.1-4.7-.1Zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Zm0 8.1a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm6.2-8.3a1.1 1.1 0 1 1-2.3 0 1.1 1.1 0 0 1 2.3 0Z"/></svg>
    </button>
  </div>
</template>

<style scoped>
/* Fila de botones de redes sociales */
.social {
  display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center;
}
.ico {
  width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; transition: filter 0.15s ease, transform 0.1s ease;
}
.ico:hover { filter: brightness(1.1); }
.ico:active { transform: scale(0.94); }
.ico.wa { background: #25d366; }
.ico.tg { background: #2aabee; }
.ico.x  { background: #000; border: 1px solid var(--line); }
.ico.fb { background: #1877f2; }
.ico.ig { background: linear-gradient(45deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5); }
</style>
