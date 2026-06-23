import fs from 'fs';

// 1. index.html — overlay-calculator necesita 'hidden'
let h = fs.readFileSync('index.html', 'utf8');
if (!h.includes('calc-overlay hidden')) {
  h = h.replace('class="calc-overlay"', 'class="calc-overlay hidden"');
  fs.writeFileSync('index.html', h, 'utf8');
  console.log('✅ index.html - hidden agregado');
} else { console.log('⏩ index.html ok'); }

// 2. booking-form.js — quitar booking_units del select (causa 404)
let b = fs.readFileSync('js/components/booking-form.js', 'utf8');
let ch = false;
const fixes = [
  ["'price_per_night, check_in, check_out, booking_units(unit_id)'",
   "'price_per_night, check_in, check_out'"],
  ["'price_per_night, check_in, booking_units(unit_id)'",
   "'price_per_night, check_in'"],
];
for (const [a, b2] of fixes) {
  if (b.includes(a)) { b = b.split(a).join(b2); ch = true; }
}
// Quitar .filter(b => booking_units...)
b = b.replace(/\.filter\(b\s*=>\s*\(b\.booking_units[^)]+\)\.some[^)]+\)\)/g, '');
if (ch) {
  fs.writeFileSync('js/components/booking-form.js', b, 'utf8');
  console.log('✅ booking-form.js - booking_units removido del select');
} else { console.log('⏩ booking-form.js ok'); }

// 3. app.js — comentar _loadAndApplyAvatar hasta que SQL esté aplicado
let a = fs.readFileSync('js/app.js', 'utf8');
if (a.includes('_loadAndApplyAvatar(supabase, user.id);') &&
    !a.includes('// _loadAndApplyAvatar')) {
  a = a.replace(
    '_loadAndApplyAvatar(supabase, user.id);',
    '// _loadAndApplyAvatar(supabase, user.id); // activar tras SQL avatar'
  );
  fs.writeFileSync('js/app.js', a, 'utf8');
  console.log('✅ app.js - avatar comentado temporalmente');
} else { console.log('⏩ app.js ok'); }
