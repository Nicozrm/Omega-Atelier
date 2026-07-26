import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// Base path. Vercel/local serve at root ('/'); the GitHub Pages workflow sets
// GITHUB_PAGES_BASE to "/<repo>/" so assets and the SPA resolve under the
// project-site sub-path. Keeps both hosting targets working from one config.
const base = process.env.GITHUB_PAGES_BASE || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'OMEGA Atelier 2.0',
        short_name: 'OMEGA',
        description: 'Smart-Home Atelier — interaktive Grundriss- und 3D-Planung mit 30+ Ökosystemen',
        lang: 'de',
        theme_color: '#070810',
        background_color: '#070810',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        // start_url/scope resolve under the deploy base so the installed app
        // launches inside its own scope on GitHub Pages (project sub-path).
        start_url: base,
        scope: base,
        categories: ['productivity', 'lifestyle', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // PWA resilience: navigations are ALWAYS served from the precached app
        // shell (correct sub-path!), so a broken/misconfigured server response
        // can never be rendered or cached as the app. New SW versions activate
        // immediately and drop stale precaches.
        navigateFallback: `${base}index.html`,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router': ['react-router-dom'],
          'state': ['zustand'],
          'supabase': ['@supabase/supabase-js'],
          'three': ['three', '@react-three/fiber', '@react-three/drei'],
          // NOTE: lucide-react is intentionally NOT a manual chunk.
          // We rely on per-import tree-shaking (`import { X } from 'lucide-react'`)
          // which kills ~94% of the library. Forcing it into one chunk would
          // bring the whole thing back.
        },
      },
    },
  },
})
