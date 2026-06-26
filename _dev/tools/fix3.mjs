import fs from 'fs';

// 1. overlay-calculator: forzar display:none con style inline
//    (la clase .hidden no funciona porque .calc-overlay tiene mayor especificidad CSS)
let h = fs.readFileSync('index.html', 'utf8');
h = h
  .replace(
    'id="overlay-calculator" class="calc-overlay hidden"',
    'id="overlay-calculator" class="calc-overlay" style="display:none"'
  )
  .replace(
    'id="overlay-calculator" class="calc-overlay"',
    'id="overlay-calculator" class="calc-overlay" style="display:none"'
  );
fs.writeFileSync('index.html', h, 'utf8');
console.log('✅ index.html - overlay display:none forzado');

// 2. booking-form.js: reemplazar .like() en columna date (causa 404)
//    por filtro de rango correcto
let b = fs.readFileSync('js/components/booking-form.js', 'utf8');

// Quitar el filtro .like() problemático y usar fecha del año actual
b = b.replace(
  /\.like\('check_in',\s*`%-\$\{monthPad\}-%`\)/g,
  `.gte('check_in', \`\${now.getFullYear()}-\${monthPad}-01\`)\n        .lte('check_in', \`\${now.getFullYear()}-\${monthPad}-31\`)`
);

// También el fallback sin filtro de mes
b = b.replace(
  /\.like\('check_in',[\s\S]*?\)\n.*?\.limit\(50\)/,
  `.order('check_in', { ascending: false })\n          .limit(50)`
);

fs.writeFileSync('js/components/booking-form.js', b, 'utf8');
console.log('✅ booking-form.js - .like() reemplazado por rango de fechas');

// 3. Verificar que setupCalculator en app.js abre/cierra con style
let a = fs.readFileSync('js/app.js', 'utf8');
// Asegurar que al abrir el overlay use style.display en vez de classList
if (a.includes("overlay.classList.remove('hidden')")) {
  a = a.replace(
    /overlay\.classList\.remove\('hidden'\)/g,
    "overlay.style.display = 'flex'"
  ).replace(
    /overlay\.classList\.add\('hidden'\)/g,
    "overlay.style.display = 'none'"
  );
  fs.writeFileSync('js/app.js', a, 'utf8');
  console.log('✅ app.js - overlay usa style.display');
} else {
  console.log('⏩ app.js - overlay ya usa style.display');
}

console.log('\nEjecutar: npm run build');
