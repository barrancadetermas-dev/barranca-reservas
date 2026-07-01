// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',

  build: {
    outDir:    'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { main: 'index.html' },
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
