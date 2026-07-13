// vite.config.js
import { defineConfig } from 'vite';
import { writeFileSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Plugin: después del build, inyecta la lista de assets en sw.js
function swPrecachePlugin() {
  return {
    name: 'sw-precache',
    closeBundle() {
      try {
        const distAssets = resolve(__dirname, 'dist/assets');
        const swSrc      = resolve(__dirname, 'public/sw.js');
        const swDist     = resolve(__dirname, 'dist/sw.js');

        const assets = readdirSync(distAssets)
          .filter(f => f.endsWith('.js') || f.endsWith('.css'))
          .map(f => `/assets/${f}`);

        const precacheList = [
          '/', '/index.html', '/manifest.json',
          '/icon-192.png', '/icon-512.png',
          ...assets,
        ];

        let swContent = readFileSync(swSrc, 'utf-8');
        swContent = swContent.replace(
          /const STATIC_ASSETS = \[[\s\S]*?\];/,
          `const STATIC_ASSETS = ${JSON.stringify(precacheList, null, 2)};`
        );
        writeFileSync(swDist, swContent, 'utf-8');
        console.log(`[sw-precache] ✓ ${precacheList.length} assets pre-cacheados`);
      } catch (err) {
        console.warn('[sw-precache] error:', err.message);
      }
    }
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [swPrecachePlugin()],

  build: {
    outDir:    'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main:    'index.html',
        landing: 'landing.html',
        setup:   'setup.html',
        guia:    'guia.html',
      },
      output: {
        // Code splitting manual: separa los módulos más pesados en chunks lazy
        manualChunks(id) {
          if (id.includes('js/components/calendar'))       return 'chunk-calendar';
          if (id.includes('js/components/statistics'))     return 'chunk-statistics';
          if (id.includes('js/components/booking-form'))   return 'chunk-booking-form';
          if (id.includes('js/components/booking-list'))   return 'chunk-booking-list';
          if (id.includes('js/components/guests'))         return 'chunk-guests';
          if (id.includes('js/services/export-service'))   return 'chunk-export';
          if (id.includes('js/modules/mila-assistant'))    return 'chunk-mila';
          if (id.includes('js/modules/encargada-share'))   return 'chunk-encargada';
          if (id.includes('node_modules/@supabase'))        return 'vendor-supabase';
        },
      },
    },
  },

  server: { port: 3000, open: true },
  preview: { port: 4173 },
});
