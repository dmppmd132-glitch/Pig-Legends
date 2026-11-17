import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * GitHub Pages serves this project from the project-page sub-path
 * https://dmppmd132-glitch.github.io/Pig-Legends/ — so every emitted asset,
 * the manifest, the service worker and all runtime fetch() paths must be
 * resolved relative to BASE_URL. Never hardcode '/' here.
 */
const BASE_URL = '/Pig-Legends/';

export default defineConfig({
  base: BASE_URL,

  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
        'apple-touch-icon.png',
        '.nojekyll',
      ],
      manifest: {
        // Manifest is emitted at ${base}manifest.webmanifest and linked from
        // index.html relative to base, so GitHub Pages sub-path installs work.
        name: 'Pig Legends — ARNO of the Darkwood',
        short_name: 'Pig Legends',
        description:
          'A dark-fantasy action RPG: ride into the Dimwood as ARNO, the last pig knight. Sword, dodge, and hunt the forest wolves. Installable, offline-capable.',
        id: BASE_URL,
        start_url: BASE_URL,
        scope: BASE_URL,
        orientation: 'any',
        display: 'standalone',
        display_override: ['fullscreen', 'standalone', 'minimal-ui'],
        background_color: '#0a0d0b',
        theme_color: '#12181c',
        lang: 'en-US',
        categories: ['games', 'entertainment'],
        shortcuts: [
          {
            name: 'New Hunt',
            short_name: 'Hunt',
            description: 'Start a fresh run in the Dimwood',
            url: `${BASE_URL}?mode=hunt`,
          },
        ],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the whole app shell so the game boots with no network.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,json,glb,gltf,txt,ico}'],
        navigateFallback: `${BASE_URL}index.html`,
        navigateFallbackDenylist: [/^\/Pig-Legends\/assets\/.*\.(?:glb|gltf)$/],
        sourcemap: false,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            // Optional user-supplied GLB models fetched at runtime.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\.(glb|gltf)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pig-legends-models',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname === 'assets.babylonjs.com' || url.hostname === 'cdn.babylonjs.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'pig-legends-cdn',
              expiration: { maxEntries: 48, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Keeps the install/update flow testable with `npm run preview`.
        enabled: false,
      },
    }),
  ],

  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    cssCodeSplit: true,
    modulePreload: { polyfill: true },
    chunkSizeWarningLimit: 2400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@babylonjs')) return 'babylon';
            if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            return 'vendor';
          }
          if (id.includes('/src/game/')) return 'game';
          return undefined;
        },
      },
    },
  },

  server: {
    host: true,
    port: 5173,
    strictPort: true,
    headers: {
      // Babylon needs cross-origin isolation-free defaults kept simple; this
      // only matters for local dev where dev servers strip .nojekyll handling.
      'Cache-Control': 'no-cache',
    },
  },

  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },

  optimizeDeps: {
    include: ['@babylonjs/core', '@babylonjs/loaders'],
  },
});
