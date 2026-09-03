import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Vitest configuration.
 *
 * - jsdom environment so component/store/DOM-adjacent tests work.
 * - Path alias `@` mirrors vite.config.ts.
 * - Coverage via v8; focuses on the pure domain logic in src/lib and the store.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // The ONVIF bridge is a Node service outside the Vite bundle, but its
    // rules (RTSP never guessed, credentials never returned, PTZ without
    // capability discovery) are exactly the ones worth pinning down.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tools/**/*.{test,spec}.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/store/**'],
      exclude: ['src/lib/textures.ts', 'src/lib/canvasGlyphs.ts', 'src/lib/supabase.ts'],
    },
  },
})
