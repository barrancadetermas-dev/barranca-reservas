import fs from 'fs';

// Fix 1: overlay-calculator necesita clase 'hidden' para no cubrir la pantalla
let html = fs.readFileSync('index.html', 'utf8');
if (html.includes('class="calc-overlay hidden"')) {
  console.log('⏩ index.html ya tiene hidden');
} else {
  html = html.replace('class="calc-overlay"', 'class="calc-overlay hidden"');
  fs.writeFileSync('index.html', html, 'utf8');
  console.log('✅ index.html - overlay-calculator hidden agregado');
}

// Fix 2: booking-form.js - quitar booking_units del select que da 404
let bf = fs.readFileSync('js/components/booking-form.js', 'utf8');
let changed = false;

// Quitar booking_units del select en _loadPriceHistory
if (bf.includes("'price_per_night, check_in, check_out, booking_units(unit_id)'")) {
  bf = bf.replace(
    "'price_per_night, check_in, check_out, booking_units(unit_id)'",
    "'price_per_night, check_in, check_out'"
  );
  changed = true;
}
if (bf.includes("'price_per_night, check_in, booking_units(unit_id)'")) {
  bf = bf.replace(
    "'price_per_night, check_in, booking_units(unit_id)'",
    "'price_per_night, check_in'"
  );
  changed = true;
}
// Quitar el filtro JS que usa booking_units
if (bf.includes('.filter(b => (b.booking_units ?? []).some(bu => bu.unit_id === unitId))')) {
  bf = bf.replace(
    /\.filter\(b => \(b\.booking_units \?\? \[\]\)\.some\(bu => bu\.unit_id === unitId\)\)\n?/g,
    ''
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync('js/components/booking-form.js', bf, 'utf8');
  console.log('✅ booking-form.js - booking_units select removido');
} else {
  console.log('⏩ booking-form.js sin cambios');
}

// Fix 3: app.js - deshabilitar _loadAndApplyAvatar que da 406
let app = fs.readFileSync('js/app.js', 'utf8');
if (app.includes('_loadAndApplyAvatar(supabase, user.id)') &&
    !app.includes('// _loadAndApplyAvatar')) {
  app = app.replace(
    '_loadAndApplyAvatar(supabase, user.id);',
    '// _loadAndApplyAvatar(supabase, user.id); // pendiente: correr SQL avatar primero'
  );
  fs.writeFileSync('js/app.js', app, 'utf8');
  console.log('✅ app.js - _loadAndApplyAvatar comentado');
} else {
  console.log('⏩ app.js sin cambios');
}

console.log('\nListo. Correr: npm run build');
