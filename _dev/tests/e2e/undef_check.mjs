// Detecta identificadores usados pero no importados/declarados (el build de Vite no los marca).
// Uso: node _dev/tests/e2e/undef_check.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const checks = {
  'js/components/booking-form.js': ['promoLabel','paymentPercents','pctOf','fmtPctPay','resolveGuestCounts','friendlyDbError','stayStatus','genderSymbolHTML','specialChipsHTML','getSegments','isSplit','findConflicts','SplitStayEditor','queryWithOptionalColumns','escapeHtml'],
  'js/components/booking-list.js': ['guestCountsText','promoLabel','paymentProgressText','registerCheckIn','genderSymbolHTML','specialChipsHTML','escapeHtml','localToday','segmentColumns','alojado'],
  'js/components/calendar.js': ['guestCountsText','promoLabel','specialsForStay','specialChipsHTML','escapeHtml','genderSymbolHTML','overlapsRange','rowsOnNight','occupiesNight','segmentColumns'],
  'js/components/dashboard.js': ['registerCheckIn','genderColumn','genderSymbolHTML','escapeHtml','rowsOnNight','rowsAtArrival','rowsAtDeparture','segmentColumns'],
  'js/services/arg-holidays.js': ['holidaysForYear'],
  'js/services/special-dates.js': ['dayNum','addDays'],
  'js/services/checkin-service.js': ['showToast','can','isDemo','logAction','Bus','EVENTS'],
  'js/app.js': ['registerCheckIn','rowsAtArrival','segmentColumns','getSegments'],
};
let bad = 0;
for (const [f, names] of Object.entries(checks)) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const body = src.replace(/^\s*import[^;]*;/gm, '');
  for (const n of names) {
    const used = new RegExp('\\b' + n + '\\b').test(body);
    const declared = new RegExp('(import[^;]*\\b' + n + '\\b[^;]*from|function\\s+' + n + '\\b|const\\s+' + n + '\\b|class\\s+' + n + '\\b|\\bas\\s+' + n + '\\b)').test(src);
    if (used && !declared) { bad++; console.log('❌ SIN IMPORTAR:', f, n); }
  }
}
console.log(bad ? `${bad} problemas` : '✅ todos los identificadores están importados/declarados');
process.exit(bad ? 1 : 0);
