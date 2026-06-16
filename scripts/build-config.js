#!/usr/bin/env node
// scripts/build-config.js
// Se ejecuta en Vercel antes del deploy.
// Lee las variables de entorno y genera js/config.js automáticamente.
// En desarrollo local: editá js/config.js directamente (está en .gitignore).

const fs   = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

// Si no hay variables de entorno (desarrollo local), no generar nada.
// El archivo js/config.js ya existe editado manualmente.
if (!url || !key) {
  console.log('[build-config] Sin variables de entorno — saltando generación (modo desarrollo local).');
  process.exit(0);
}

const content = `// Generado automáticamente por scripts/build-config.js
// NO editar — este archivo es creado durante el build de Vercel
export const SUPABASE_URL      = '${url}';
export const SUPABASE_ANON_KEY = '${key}';
`;

const outPath = path.join(__dirname, '..', 'js', 'config.js');
fs.writeFileSync(outPath, content, 'utf8');
console.log('[build-config] ✅ js/config.js generado desde variables de entorno de Vercel.');
