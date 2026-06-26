// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  // Raíz del proyecto: index.html está en la raíz
  root: '.',

  // Carpeta de assets estáticos (sw.js, manifest.json, íconos)
  publicDir: 'public',

  build: {
    outDir:    'dist',
    emptyOutDir: true,
    // Sourcemaps para facilitar debugging en producción
    sourcemap: false,
    rollupOptions: {
      input: {
        main:  'index.html',
        setup: 'setup.html',
      },
    },
  },

  server: {
    port: 3000,
    open: true,
  },

  preview: {
    port: 4173,
  },
});
