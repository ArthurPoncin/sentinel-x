import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { loadEnv, searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'

const contract = fileURLToPath(new URL('../backend/src/contract.ts', import.meta.url))

export default defineConfig(({ mode }) => {
  // Where the Command Post API runs: the mock on this machine by default, the Pi for the real thing.
  const { BACKEND_URL = 'http://127.0.0.1:8080' } = loadEnv(mode, process.cwd(), '')
  // Same origin as in production behind the reverse proxy: the app always talks to its own /ws and /api.
  const proxy = {
    '/ws': { target: BACKEND_URL, ws: true },
    '/api': { target: BACKEND_URL },
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@sentinel-x/contract': contract,
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      // The contract's zod resolves to ours: one zod in the bundle, no install needed in backend/.
      dedupe: ['zod'],
    },
    server: {
      proxy,
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), contract] },
    },
    preview: { proxy },
    test: {
      include: ['src/**/*.test.ts'],
    },
  }
})
