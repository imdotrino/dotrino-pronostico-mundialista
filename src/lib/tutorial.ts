// Tutorial guiado de la app (burbujas tipo donar/compartir) usando el paquete
// compartido del ecosistema @dotrino/tutorial. Explica el menú
// (burger) y, sobre todo, cómo se CREAN y COMPARTEN los pronósticos y las salas.
//
// Cada burbuja se muestra UNA sola vez (persistido por la librería), una a la
// vez, en orden, y posicionada para no salirse de pantalla. Como muchos anclajes
// viven en el cajón lateral o en una sección concreta, cada paso usa `before()`
// para CONDUCIR el estado de la app (abrir el cajón, cambiar de sección) y dejar
// el objetivo visible antes de mostrarse.
import { createTutorial, type DotrinoTutorial } from '@dotrino/tutorial'

export interface TutorialCtx {
  /** Idioma actual de la app ('es' | 'en'). */
  lang: () => string
  /** Cambia de sección (pronósticos / la fecha / salas). */
  setSection: (s: 'predictions' | 'rooms' | 'fecha') => void
  /** Abre o cierra el cajón lateral (en móvil). */
  setSidebar: (open: boolean) => void
  /** ¿Existe al menos una sala? (para el paso de compartir sala). */
  hasRoom: () => boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isMobile = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 959px)').matches

let instance: DotrinoTutorial | null = null

/**
 * Arranca el tutorial (una sola vez por dispositivo). Devuelve el controlador.
 * Si ya estaba creado, no se duplica.
 */
export function startAppTutorial (ctx: TutorialCtx): DotrinoTutorial | null {
  if (instance) return instance

  // El paquete persiste lo visto POR PASO (`mundial.tutorial:seen:<id>`); la
  // clave llana `mundial.tutorial` es nuestra marca de "tour terminado" (se
  // escribe abajo en cc-tutorial-done). Si ya está, ni se monta el componente:
  // es lo que App.vue y los e2e consultan para saber que no habrá burbujas.
  try { if (localStorage.getItem('mundial.tutorial')) return null } catch { /* */ }

  // En móvil, abrir/cerrar el cajón requiere esperar su animación (0.25s) para
  // que el objetivo termine visible; en escritorio el cajón es fijo (no-op).
  const openDrawer = async () => { if (isMobile()) { ctx.setSidebar(true); await sleep(300) } }
  const closeDrawer = async () => { if (isMobile()) { ctx.setSidebar(false); await sleep(300) } }
  const goPredictions = async () => { ctx.setSection('predictions'); await sleep(80) }
  const goRooms = async () => { ctx.setSection('rooms'); await sleep(80) }

  instance = createTutorial({
    lang: ctx.lang(),
    storageKey: 'mundial.tutorial',
    startDelay: 900,        // deja respirar a la carga inicial
    stepTimeout: 4000,
    steps: [
      {
        id: 'burger', order: 1, placement: 'bottom',
        target: '[data-testid="menu-btn"]',
        skipIf: () => !isMobile(),          // en escritorio no hay burger (barra fija)
        before: closeDrawer,
        title: { es: 'El menú', en: 'The menu' },
        text: {
          es: 'Con este botón abres el menú: aquí están tus pronósticos, las salas y las opciones.',
          en: 'This button opens the menu: your predictions, the rooms and the options.',
        },
      },
      {
        id: 'sections', order: 2, placement: 'right',
        target: '[data-testid="sb-sections"]',
        before: openDrawer,
        title: { es: 'Dos secciones', en: 'Two sections' },
        text: {
          es: 'Cambia entre Pronósticos (tus quinielas) y Salas (competir con amigos en una tabla compartida).',
          en: 'Switch between Predictions (your brackets) and Rooms (compete with friends on a shared leaderboard).',
        },
      },
      {
        id: 'matchday', order: 2.5, placement: 'right',
        target: '[data-testid="sb-tab-fecha"]',
        before: openDrawer,
        title: { es: 'El pronóstico de la fecha', en: 'The matchday prediction' },
        text: {
          es: 'Cada día, pronostica los partidos que se juegan antes de que empiecen: cada pronóstico se sella con fecha certificada. Es único por cuenta.',
          en: 'Each day, predict the matches before they start: every pick gets a certified timestamp seal. One per account.',
        },
      },
      {
        id: 'createPrediction', order: 3, placement: 'right',
        target: '[data-testid="sb-new"]',
        before: async () => { await goPredictions(); await openDrawer() },
        title: { es: 'Crear un pronóstico', en: 'Create a prediction' },
        text: {
          es: 'Pulsa Nuevo, elige el tipo (Simple, Medio o Completo) y empieza a ordenar los grupos y armar la llave.',
          en: 'Tap New, pick the type (Simple, Medium or Full) and start ordering the groups and building the bracket.',
        },
      },
      {
        id: 'sharePrediction', order: 4, placement: 'bottom',
        target: '[data-testid="bar-share"]',
        before: async () => { await goPredictions(); await closeDrawer() },
        title: { es: 'Compartir el pronóstico', en: 'Share the prediction' },
        text: {
          es: 'Comparte el pronóstico abierto con un enlace firmado (QR, copiar o redes). Tu contenido viaja en el enlace; nunca llega a un servidor.',
          en: 'Share the open prediction with a signed link (QR, copy or social). Your content travels in the link; it never reaches a server.',
        },
      },
      {
        id: 'roomsNav', order: 5, placement: 'right',
        target: '[data-testid="sb-tab-rooms"]',
        before: openDrawer,
        title: { es: 'Las Salas', en: 'Rooms' },
        text: {
          es: 'En una sala, varios amigos suben su pronóstico y se arma una tabla de posiciones. Entra aquí para verlas.',
          en: 'In a room, several friends upload their prediction and a leaderboard is built. Enter here to see them.',
        },
      },
      {
        id: 'createRoom', order: 6, placement: 'right',
        target: '[data-testid="sb-new-room"]',
        before: async () => { await goRooms(); await openDrawer() },
        title: { es: 'Crear una sala', en: 'Create a room' },
        text: {
          es: 'Crea una sala: ponle nombre, elige el modo y confírmala. Queda lista para invitar a tus amigos.',
          en: 'Create a room: give it a name, pick the mode and confirm. It is then ready to invite your friends.',
        },
      },
      {
        id: 'shareRoom', order: 7, placement: 'bottom',
        // Si hay una sala abierta, el botón de la barra activa; si no, el de cada
        // sala en la lista del cajón.
        target: () =>
          document.querySelector('[data-testid="room-bar-share"]') ||
          document.querySelector('[data-testid="room-item"] .share-i'),
        skipIf: () => !ctx.hasRoom(),       // sin salas aún: aparecerá cuando tengas una
        before: async () => {
          await goRooms()
          if (!document.querySelector('[data-testid="room-bar-share"]')) await openDrawer()
        },
        title: { es: 'Invitar a la sala', en: 'Invite to the room' },
        text: {
          es: 'Con este botón compartes la sala: un enlace firmado (QR + redes) para que tus amigos se unan y suban su pronóstico.',
          en: 'This button shares the room: a signed link (QR + social) so your friends can join and upload their prediction.',
        },
      },
    ],
  })

  // Al terminar (o saltar) el tutorial, devolvemos la app a un estado neutro:
  // sección Pronósticos y, en móvil, el cajón cerrado.
  if (instance) {
    instance.addEventListener('cc-tutorial-done', () => {
      try { localStorage.setItem('mundial.tutorial', 'done') } catch { /* */ }
      ctx.setSection('predictions')
      if (isMobile()) ctx.setSidebar(false)
    })
  }
  return instance
}
