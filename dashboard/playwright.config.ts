import { defineConfig } from '@playwright/test'

// The smoke-render (#16): the production bundle (`npm run build` first), served by `vite preview`, on the
// Command Post API playing its mock feed, opened in a headless Chromium. Both servers are started here, on
// ports of their own, so it runs next to a dev server.
const API_PORT = Number(process.env.SMOKE_API_PORT ?? 8099)
const WEB_PORT = Number(process.env.SMOKE_WEB_PORT ?? 4199)
const API_URL = `http://127.0.0.1:${API_PORT}`
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`

export default defineConfig({
  testDir: 'smoke',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB_URL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      // A Chromium already on the machine, rather than the one `playwright install chromium` downloads.
      executablePath: process.env.SMOKE_BROWSER || undefined,
      // WebGL without a GPU, as on a CI runner: the Twin is rendered in software.
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: [
    {
      // Straight from its sources, without backend/.env: the scripted scenario, no broker, no login, nothing kept.
      command: 'npx tsx src/main.ts',
      cwd: '../backend',
      env: {
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        OPERATOR_AUTH: 'off',
        MOCK_FEED: 'true',
        HISTORY_FILE: ':memory:',
      },
      url: `${API_URL}/health`,
      reuseExistingServer: false,
    },
    {
      // The backend's address comes from the configuration, as in dev: nothing in the bundle knows it.
      command: `npx vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      env: { BACKEND_URL: API_URL },
      url: WEB_URL,
      reuseExistingServer: false,
    },
  ],
})
