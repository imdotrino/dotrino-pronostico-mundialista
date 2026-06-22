# Pronóstico Mundialista

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Misión: aplicaciones que resuelven problemas comunes, respetando tu privacidad — sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

Aplicación de pronósticos del Mundial del ecosistema [Dotrino](https://dotrino.github.io/dotrino/): predice resultados de los partidos, compite con tus amigos y lleva tu tabla de aciertos. Como toda app del ecosistema, corre del lado del cliente y tú controlas tu información.

## Filosofía

El eje del ecosistema **[Dotrino](https://dotrino.com)** es el **autohosteo** y el **control sobre la propia información**: qué comparto, cómo lo comparto y cuándo lo comparto.

### Manifiesto

> **Tu información, en tu servidor, bajo tus reglas.**
> Dotrino nace de una idea simple: lo que es tuyo, se queda contigo. Tú decides **qué** compartes, **cómo** lo compartes y **cuándo** lo compartes. Sin intermediarios, sin nubes ajenas, sin letra pequeña.
>
> Cada aplicación del ecosistema Dotrino vive donde tú quieras: tu propio servidor, tu propia infraestructura. Tus datos no viajan a empresas que los monetizan. Tú eres el dueño y el administrador. Compartes solo lo que eliges, con quien eliges, durante el tiempo que eliges.

### Tres pilares

> - **Qué comparto:** solo la información que decido exponer, nada más.
> - **Cómo lo comparto:** con el formato, el acceso y las condiciones que yo defino.
> - **Cuándo lo comparto:** en el momento que quiero, y lo retiro cuando quiero.
>
> Todo sobre infraestructura que tú controlas. Eso es autohosteo. Eso es soberanía digital.

---

## Qué hace

App cliente (Vue 3 + Vite + TS, PWA) para armar **varios** pronósticos del
**Mundial 2026** (48 selecciones, sorteo final del 5 dic 2025), firmarlos con tu
identidad y compartirlos por QR / redes / PDF. Bilingüe **ES/EN**, tema visual
"estadio nocturno" (azul, tipografías Anton + Hanken Grotesk), responsive (móvil
y escritorio con barra lateral fija).

### Tres modos de juego (por pronóstico)
- **Simple** — ordenás a mano la tabla de cada grupo y el ranking de los 12
  terceros (los 8 mejores clasifican) **arrastrando la fila completa**. No se
  cargan resultados.
- **Medio** — marcás **gana/empata/pierde** de cada partido de grupo; las
  posiciones se **calculan** (puntos → enfrentamiento directo → orden de sorteo).
- **Completo** — cargás el **marcador** (goles) de cada partido; las posiciones
  se calculan con diferencia de gol y goles a favor.

El tipo se **elige al crear** el pronóstico (con descripciones claras) y queda
**fijo**; para cambiarlo se **clona a otro tipo** (acción ⧉, conserva los datos).
Cada pronóstico muestra su **tipo** y su **% de llenado** en la barra lateral.

En Medio/Completo aparece la pestaña **Resultados** (carga de partidos) y la
pestaña Grupos muestra la tabla calculada (solo lectura). Un botón **Confirmar
cambios** aplica las posiciones a las llaves (invalidando en cascada los picks
afectados); en Simple, confirmar aparece cuando el reordenado afecta las llaves.
Si **cambiás de sección** con cambios sin aplicar, un modal ofrece **aplicarlos
o ignorarlos**.

### Llaves
- Formato **simétrico** con la final al centro y trofeo, y **líneas conectoras**
  que unen cada partido con la ronda siguiente. Cada cupo muestra bandera +
  **código de país**; los vacíos, su etiqueta (`1.º A`, `Gan. 89`, …).
- Dieciseisavos se llenan con los clasificados; las rondas siguientes se llenan
  al elegir quién avanza (se puede elegir aunque el rival esté vacío).
- En Medio/Completo, un cupo solo se completa cuando la posición ya es **segura**
  según lo cargado; si no, queda en placeholder (no se "adivina").

### Resultados oficiales y puntuación
- En la barra lateral hay una entrada especial **"Resultados"** (los oficiales
  del torneo): **no es un pronóstico**, solo se cargan los marcadores; las
  posiciones y llaves se derivan solas. Utilidades: **Aleatorio**, **Borrar
  todos**, **Obtener oficial** (simulado hasta que empiece el Mundial).
- En eliminatorias el que avanza lo decide el **marcador**; si hay empate,
  aparecen casilleros de **penales**.
- Cada partido muestra su **fecha y hora local** (convertida desde UTC del
  calendario oficial); los de grupo se listan **ordenados por fecha**.
- Cada pronóstico se **puntúa** contra los resultados oficiales (chip de puntos
  en la barra lateral). Solo cuenta lo **cierto**: posiciones aseguradas (+3 c/u),
  aciertos de llaves por ronda (R32 +4 … final/campeón +20, 3.º +5), acierto
  1/–/2 por partido (+1, Medio y Completo) y marcador exacto (+2, solo Completo).
  El panel **"¿Cómo se puntúa?"** lo explica con pestañas por modo, y la pestaña
  **Puntajes** detalla cada acierto (con su fase y fecha) y por qué suma.
- En Resultados y en las Llaves, una **estrella** ⭐ marca los partidos donde el
  pronóstico acertó (quién avanza / resultado).

### Multi-pronóstico + identidad
- **Mis pronósticos** (editables), **Pronósticos amigos** (importados, solo
  lectura) y **Resultados** (oficiales). Crear, renombrar, eliminar, duplicar.
- **Mi identidad** (vault `id.dotrino.com` vía `@dotrino/identity`):
  perfil (apodo que firma), **contactos** por **token** corto del proxy (resuelto
  con challenge/response firmado) y **rankings** (web-of-trust, estrellas).

### Compartir / exportar
- El pronóstico se codifica COMPLETO en una cadena **base64url** (codec v3:
  modo + posiciones + ranking de terceros + ganadores de llaves + resultados con
  goles y penales) — todo lo necesario para **reconstruirlo desde el link**.
- Se **firma con ECDSA P-256** y se arma `https://pronostico.dotrino.com/#<payload>`
  mostrado como **QR**. El payload va **empaquetado en un solo blob binario**
  (versión + firma + **clave pública comprimida** de 33 bytes + código +
  apodo + **nombre** del pronóstico, máx 50) y base64url **una vez** — QR liviano.
  Al importar/abrir un enlace se **verifica la firma** y se reconstruye Y del
  punto comprimido. Enlaces viejos en JSON se siguen leyendo.
- Al **compartir/imprimir** un pronóstico **incompleto**, un modal avisa el % y
  permite continuar igual (no bloquea).
- Botones de **redes** (WhatsApp, Telegram, X, Facebook, Instagram/Web Share API).
- **Imprimir** y **Descargar PDF** en una hoja **A4** (plantilla distinta por
  modo) con el QR firmado, vía `html2canvas` + `jspdf`.

### Salas (compartir, comparar y competir)
- **Salas** es la otra "página" del app (conmutador **Pronósticos / Salas** en la
  barra lateral): reúne los pronósticos firmados de varias personas para
  **comparar** y llevar una **tabla de posiciones** vs. los resultados oficiales.
- 100% del lado del cliente: cada quien guarda en su `localStorage`
  (`mundial.rooms.v1`) las salas en las que está. **Sin servidor autoritativo**;
  el proxy y los enlaces solo reparten/sincronizan (filosofía Dotrino).
- **Crear / unirse** desde la barra lateral (igual que los pronósticos): la sala
  se selecciona ahí y el contenido se ve como página, **sin modales**. La barra
  superior muestra **en qué sala estás** y el estado de sincronización.
- **Invitar** de dos formas (híbrido): por **enlace/QR** firmado
  (`#room=<blob>`) o eligiendo **contactos** del vault (se les envía por
  `sendByPubkey`, con **cola offline del proxy hasta 24 h**: les llega aunque no
  estén online, al abrir la app). Cada miembro **aporta** uno de sus pronósticos
  (debe respetar el tipo exigido por la sala); identidad **obligatoria**, así que
  cada entrada de la tabla tiene **autoría verificable** (se rechazan firmas no
  válidas).
- **Sobre firmado con fecha del autor:** cada aporte viaja como un sobre que el
  autor **firma con su vault** (`{ sala, frag, ts }`, o `{ sala, retract, ts }`
  para borrar). El `ts` del autor es la **versión** para *last-write-wins*:
  re-aportar o borrar le gana a lo anterior.
- **Sincronización por gossip:** en vivo vía **canales del proxy**
  (`mundial-room-<id>`), cada peer **reenvía todos los sobres que conoce** (no
  solo el suyo), así la sala converge aunque no todos estén online a la vez.
  Reenviar es **seguro**: los sobres van firmados, un peer no puede alterarlos.
  Usa el **cliente estándar del ecosistema** (`@dotrino/proxy-client`,
  WebRTC + fallback al proxy), identificándose con la clave del vault (`identify`).
- **Los aportes llegan offline:** además del envío en vivo, se difunden por
  `sendByPubkey` a las pubkeys de los miembros (**cola offline 24 h** del proxy),
  y un **buzón global** (`RoomInbox`) los aplica a la sala correcta aunque no la
  tengas abierta al reconectar.
- **Borrar mi aporte = tombstone firmado:** el autor firma un *retract*; el
  miembro queda como **lápida** (oculta en la UI) con `ts` mayor, para que un
  reenvío viejo **no lo reviva**. Solo el autor puede borrar lo suyo (va firmado).
- **Sello de fecha (sellador):** al compartir/aportar se pide un **sello de
  tiempo** a `signer.dotrino.com` (autoridad de tiempo del ecosistema): firma
  `{ hash, ts }` con SU clave, probando **cuándo** existió el pronóstico sin verlo.
  El sello viaja dentro del blob firmado; la UI marca cada aporte 🕓 *a tiempo* /
  ⚠ *tarde o inválido* / — *sin fecha* contra el inicio del torneo. Es
  best-effort: si el sellador no responde, se comparte igual sin sello.
- **Privacidad configurable:** la sala puede **sellar** los pronósticos (ocultos
  hasta el primer partido, 11-jun-2026) para evitar copia, o dejarlos visibles.
- **Simular puntajes:** la barra de Salas tiene acceso a **Resultados** (los
  oficiales) para cargar/simular marcadores y ver cómo cambia la tabla de la sala.
- Vistas dentro de la sala: **Posiciones** (puntaje de cada miembro vs. oficial),
  **Comparar** (campeón/final y ganadores de grupo lado a lado, con aciertos
  resaltados) y **Miembros** (invitar + lista con verificación).

### Persistencia y sync (store del ecosistema)
- Pronósticos y salas se guardan **localmente en `localStorage`** (caché instantánea
  que la app lee de forma síncrona) y se **espejan** al store estándar del
  ecosistema **`@dotrino/store`** (`store.dotrino.com`, IndexedDB),
  fusionando al arrancar lo que haya en la nube (*last-writer-wins* por `updatedAt`).
- Esto habilita **sync entre dispositivos** (vía el sync cifrado del store a tu
  Google Drive, opcional) sin perder el funcionamiento offline: si el store no
  está disponible, todo sigue andando solo con `localStorage`.
- Es **aditivo y best-effort** (`src/lib/cloud.ts`): cada registro (pronóstico,
  sala) viaja como una entrada del store en su thread (`predictions`, `rooms`).
  En tests se desactiva con `VITE_DISABLE_CLOUD=1` para no tocar el store real.

### PWA
- Instalable; iconos y favicon generados desde `images/logo.svg`
  (`scripts/gen-icons.mjs`, corre en cada build).
- **En desarrollo** el service worker es `selfDestroying` (sin caché). Para
  producción, quitar `selfDestroying` en `vite.config.ts` para reactivar la PWA.

## Estructura

```
images/logo.svg           fuente única de iconos/favicon del PWA
scripts/gen-icons.mjs     genera icons + favicon desde el SVG
src/
├── i18n.ts             vue-i18n (ES/EN) + selector de idioma
├── lib/
│   ├── teams.ts        48 equipos (grupos A–L, bandera, código FIFA, id estable)
│   ├── bracket.ts      estructura R32→final + asignación de mejores terceros
│   ├── standings.ts    cálculo de tabla por resultados + posiciones "seguras"
│   ├── prediction.ts   estado, resolución por partido (certeza), prune en cascada
│   ├── codec.ts        encode/decode compacto v3 (Lehmer + bits + base64url)
│   ├── scoring.ts      puntuación de un pronóstico vs resultados oficiales
│   ├── schedule.ts     fechas/horas UTC de los 104 partidos → hora local
│   ├── identity.ts     singleton del vault id.dotrino.com (+ hook vault de prueba e2e)
│   ├── signer.ts       cliente del sellador de tiempo (signer.dotrino.com): sello + verificación
│   ├── share.ts        firma ECDSA + blob binario del enlace (punto comprimido) + sello de fecha
│   ├── proxy.ts        resolver token→identidad (challenge firmado por el proxy)
│   ├── rating.ts       reputación derivada (web-of-trust)
│   ├── store.ts        librería de pronósticos en localStorage
│   ├── cloud.ts        espejo/rehidratación contra el store del ecosistema
│   ├── roomStore.ts    salas en localStorage (Room/RoomMember, sellado) + espejo nube
│   ├── room.ts         enlaces de sala firmados (#room=) y de aporte (#rm=)
│   ├── connection.ts   conexión única al proxy (cliente estándar + identify vault)
│   ├── roomSync.ts     sync de una sala: gossip de sobres firmados + cola offline
│   ├── inbox.ts        buzón global: invitaciones + aportes (sendByPubkey, cola 24 h)
│   └── analytics.ts    GoatCounter cookieless (solo prod), paths con dominio
├── composables/
│   └── useRooms.ts     estado compartido de salas (lista, activa, sync)
├── components/
│   ├── GroupCard.vue / ThirdsBlock.vue   grupos + terceros arrastrables (Simple)
│   ├── StandingsTable.vue                 tabla calculada (Medio/Completo)
│   ├── ResultsTab.vue                     carga de resultados (grupos + llaves)
│   ├── BracketTab.vue / MatchBox.vue      llaves simétricas con conectores
│   ├── Sidebar.vue        conmutador Pronósticos/Salas + listas + acciones
│   ├── RoomsPage.vue      página de salas: crear/unirse + sala activa (tabs)
│   ├── RoomLeaderboard.vue tabla de posiciones de la sala (vs. oficial)
│   ├── RoomCompare.vue    comparación lado a lado (campeón/final/grupos)
│   ├── ScoresTab.vue      pestaña "Puntajes": desglose de aciertos y por qué
│   ├── ShareModal.vue     QR + redes + imprimir/PDF
│   ├── ScoringInfo.vue    panel "¿Cómo se puntúa?" (pestañas por modo)
│   ├── IdentityPanel.vue  perfil / contactos / rankings
│   └── PrintView.vue      hoja imprimible/PDF A4 (plantilla por modo)
└── App.vue              cabecera, modos, pestañas, carga desde #hash, impresión
```

> Nota: la asignación de los 8 mejores terceros usa un emparejamiento
> determinista que respeta los grupos permitidos por cada cruce. Aproxima el
> anexo oficial de la FIFA (la combinación de 8 grupos determina los cruces).

## Build y tests

```bash
./build.sh         # instala deps si falta y compila a dist/
npm run dev        # desarrollo (HTTPS autofirmado: https://localhost:5173)
npm run typecheck  # vue-tsc
npm run lint:fix   # eslint
npm run test:e2e   # Playwright (round-trip del link + salas: enlaces, UI y
                   #   sync EN VIVO entre dos navegadores vía el proxy)
```

> **Dev sobre HTTPS:** el dev server usa `@vitejs/plugin-basic-ssl` (cert
> autofirmado) para tener **contexto seguro** — necesario para el vault de
> identidad, el portapapeles y Web Share al entrar desde otra máquina (LAN o
> Tailscale). El navegador avisará del cert no confiable: aceptar. `allowedHosts`
> ya incluye `.ts.net` y `.local`. (Producción no usa esto.)

Deploy a GitHub Pages (dominio `pronostico.dotrino.com`) vía GitHub Actions en
cada push a `main` (`.github/workflows/deploy.yml`).

## Analítica

Tráfico **cookieless y autohosteado** con **GoatCounter** en `goat.dotrino.com`
(agregados, sin cookies ni datos personales). Solo cuenta en **producción**
(`pronostico.dotrino.com`): nunca en dev/local, LAN ni previews (`src/lib/analytics.ts`).

> **Convención del ecosistema:** `goat.dotrino.com` es una instancia **compartida**
> por todas las apps Dotrino. Para que en el dashboard se distinga a qué app
> pertenece cada link, **los paths deben llevar el dominio por delante**
> (p. ej. `pronostico.dotrino.com/tab/scores` en vez de `/tab/scores`). Esto aplica
> tanto a los pageviews (callback `path` definido antes de cargar `count.js`) como
> a los eventos (`trackEvent`). El resto de las apps lo hacen con
> `window.goatcounter={path:function(p){return location.hostname+p}}` en su
> `index.html`.

## Estado

✅ Funcional. Datos del sorteo final 2026 cargados.
