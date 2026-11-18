import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The boot notice in index.html explains a failed boot, which only ever happens
 * in dev (someone opening the template from disk). It is stripped from
 * production builds so the precached HTML carries no dead markup.
 */
function stripBootNotice() {
  return {
    name: 'strip-boot-notice',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(/\s*<!--BOOT_NOTICE-->[\s\S]*?<!--\/BOOT_NOTICE-->/g, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    stripBootNotice(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Konkur Progress Lab',
        short_name: 'Konkur Lab',
        description:
          'Offline-first personal exam tracker: raw net scores and a fixed difficulty-adjusted personal index.',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Recharts and Dexie dominate the bundle. Splitting them keeps the app
        // shell small enough that the first paint does not wait on charts.
        manualChunks: {
          charts: ['recharts'],
          storage: ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
    // Rendering 95 question groups through testing-library is genuinely slow
    // on CI machines; 5s defaulted too low and flaked half the UI suite.
    testTimeout: 20000,
  },
});