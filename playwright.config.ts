import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'

// Los e2e corren su PROPIO dev server en un puerto dedicado con la nube
// DESACTIVADA (VITE_DISABLE_CLOUD=1) para no escribir en el store de producción.
// El server de desarrollo del usuario (5173, con nube activa) queda intacto.
const PORT = Number(process.env.E2E_PORT) || 5180
const BASE = process.env.E2E_BASE || `https://localhost:${PORT}`

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    // El dev server usa HTTPS autofirmado (basic-ssl); ignoramos el cert.
    baseURL: BASE,
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    ignoreHTTPSErrors: true,
    env: { VITE_DISABLE_CLOUD: '1' },
    timeout: 120000,
  },
})
