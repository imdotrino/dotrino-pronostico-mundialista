import { test, expect, type Page } from '@playwright/test'

// Flujo de UI de la SECCIÓN Salas (otra "página" con su barra lateral, sin
// modales). Sembramos una sala con miembros en localStorage para que el test
// sea determinista (sin depender del vault de identidad ni del proxy).

async function seedRoom (page: Page) {
  await page.goto('/')
  // Construimos un código de pronóstico válido con las libs reales y armamos una
  // sala con dos miembros en localStorage; luego recargamos para que la app lo lea.
  await page.evaluate(async () => {
    const { encodePrediction } = await import('/src/lib/codec.ts')
    const { defaultPrediction } = await import('/src/lib/prediction.ts')
    const code = encodePrediction(defaultPrediction())
    const room = {
      id: 'room-ui-1',
      name: 'Sala E2E',
      mode: 'free',
      sealedUntil: 0,
      hostPubkey: 'PK_HOST',
      hostNick: 'Host',
      mine: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      members: [
        { publickey: 'PK_A', nickname: 'Ana', verified: true, frag: 'fA', code, mode: 'manual', updatedAt: Date.now() },
        { publickey: 'PK_B', nickname: 'Beto', verified: true, frag: 'fB', code, mode: 'manual', updatedAt: Date.now() },
      ],
    }
    localStorage.setItem('mundial.rooms.v1', JSON.stringify([room]))
  })
  await page.reload()
}

test('la sección Salas lista, selecciona y muestra el contenido de la sala', async ({ page }) => {
  await seedRoom(page)

  // Cambiar a la sección Salas en la barra lateral.
  await page.click('[data-testid="sb-tab-rooms"]')

  // La sala sembrada aparece en la lista.
  const item = page.locator('[data-testid="room-item"]')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('Sala E2E')

  // Seleccionarla: aparece la barra activa con el nombre (sabés en qué sala estás).
  await item.click()
  const bar = page.locator('[data-testid="room-active-bar"]')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('Sala E2E')

  // La pestaña Posiciones muestra a los dos miembros.
  await expect(page.locator('text=Ana')).toBeVisible()
  await expect(page.locator('text=Beto')).toBeVisible()

  // Cambiar a Comparar: se renderiza la tabla de comparación (selector de dimensión).
  await page.locator('.rtabs button', { hasText: /Comparar|Compare/ }).click()
  await expect(page.locator('.cmp .dims')).toBeVisible()

  // Partidos: comparación partido a partido (tabla con la columna Oficial).
  await page.locator('[data-testid="rtab-matches"]').click()
  await expect(page.locator('.mm')).toBeVisible()
})

test('el botón Resultados de la barra de Salas lleva a simular puntajes', async ({ page }) => {
  await seedRoom(page)
  await page.click('[data-testid="sb-tab-rooms"]')

  // El botón de Resultados existe en la barra de Salas.
  const resultsBtn = page.locator('[data-testid="sb-room-results"]')
  await expect(resultsBtn).toBeVisible()
  await resultsBtn.click()

  // Cambia a la sección de pronósticos, en la pestaña Resultados (para simular).
  await expect(page.locator('[data-testid="zone-resultados"]')).toBeVisible()
})
