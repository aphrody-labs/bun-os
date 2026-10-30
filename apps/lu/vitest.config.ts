import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { ABSENT_PACKAGES } from './src/dev/absent-packages'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The same replacements as in vite.config.ts: what is tested is what is built.
  resolve: { alias: ABSENT_PACKAGES },
  test: {
    globals: true,
    // The product build has LU Cloud off (src/api/cloud/config.ts). The cloud client code is
    // still shipped and tested against these fixture hosts, which are never contacted.
    env: {
      VITE_LU_CLOUD_URL: 'https://lu-labs.ai',
      VITE_LU_SUPABASE_URL: 'https://lrrhheztdytyfpizvuup.supabase.co',
      VITE_LU_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    environment: 'node',
    // Clears the composer's draft shelf between tests (src/test-setup.ts).
    setupFiles: ['src/test-setup.ts'],
    // dev-server/ kam mit ZB-7 dazu: der Dev-Server lag bis dahin in
    // vite.config.ts und war damit fuer vitest unsichtbar. Die Tests dort
    // haengen die ECHTEN Handler an einen echten node:http-Server.
    // .tsx kam mit den Sampling-Reglern dazu: Komponententests brauchen JSX,
    // und ohne die Endung war die Datei fuer vitest unsichtbar.
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'dev-server/**/__tests__/**/*.test.ts',
    ],
  },
})
