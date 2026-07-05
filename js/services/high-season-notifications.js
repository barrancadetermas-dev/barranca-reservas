// ═══════════════════════════════════════════════════
// high-season-notifications.js — "Se acerca la
// temporada alta y todavía está floja de reservas"
//
// Usa las mismas fechas que ya calcula arg-holidays.js
// (no inventa nada nuevo): Vacaciones de Invierno y
// Semana Santa, más un rango fijo de Verano/fin de año.
// Revisa una vez por semana si alguna de esas ventanas
// arranca dentro de los próximos 30 días, y si la
// ocupación para esas fechas todavía está baja, avisa —
// para darte margen de salir a promocionar antes.
// ═══════════════════════════════════════════════════

import { getHolidaysForYear } from './arg-holidays.js';
import { addNotification } from './notification-center.js';

const LASTRUN_KEY   = 'mila_highseason_notif_lastrun';
const NOTIFIED_KEY  = 'mila_highseason_notified';
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 vez por semana
const LOOKAHEAD_DAYS = 30;
const LOW_OCCUPANCY_THRESHOLD = 50; // % — por debajo de esto, se considera "floja"

function _addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Arma las 3 ventanas de temporada alta para un año dado, reusando el
// mismo cálculo que ya pinta el calendario (arg-holidays.js).
function _getHighSeasonWindows(year) {
  const holidays = getHolidaysForYear(year);
  const windows = [];

  // Vacaciones de invierno — ya viene como rango de 14 días con type='vacation'
  const vacDates = [...holidays.entries()].filter(([, v]) => v.type === 'vacation').map(([d]) => d).sort();
  if (vacDates.length) {
    windows.push({ label: 'Vacaciones de Invierno', start: vacDates[0], end: vacDates[vacDates.length - 1] });
  }

  // Semana Santa — Viernes Santo es Pascua-2; la ventana turística típica
  // es de jueves a domingo (Pascua-3 a Pascua)
  const viernesSanto = [...holidays.entries()].find(([, v]) => v.label === 'Viernes Santo')?.[0];
  if (viernesSanto) {
    windows.push({ label: 'Semana Santa', start: _addDays(viernesSanto, -1), end: _addDays(viernesSanto, 2) });
  }

  // Verano / fin de año — rango fijo, no depende de ningún cálculo especial
  windows.push({ label: 'Temporada de Verano', start: `${year}-12-15`, end: `${year + 1}-02-28` });

  return windows;
}

async function _getOccupancyPct(supabase, hotelId, start, end, totalUnits) {
  if (!totalUnits) return null;
  const { data } = await supabase
    .from('bookings')
    .select('check_in, check_out, booking_units(unit_id)')
    .eq('hotel_id', hotelId)
    .not('status', 'in', '(cancelled,blocked)')
    .lt('check_in', end)
    .gt('check_out', start);

  const days = [];
  for (let d = start; d < end; d = _addDays(d, 1)) days.push(d);
  if (!days.length) return null;

  const avgOccupied = days.reduce((sum, day) => {
    const occ = new Set();
    (data ?? []).forEach(b => {
      if (b.check_in <= day && b.check_out > day) (b.booking_units ?? []).forEach(bu => occ.add(bu.unit_id));
    });
    return sum + occ.size;
  }, 0) / days.length;

  return Math.round((avgOccupied / totalUnits) * 100);
}

export async function checkHighSeasonOccupancy(supabase, hotelId, totalUnits) {
  if (!supabase || !hotelId || !totalUnits) return;
  const now = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (now - lastRun < CHECK_INTERVAL_MS) return;

  let notified = [];
  try { notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '[]'); } catch { notified = []; }

  const todayISO = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  const windows = [..._getHighSeasonWindows(year), ..._getHighSeasonWindows(year + 1)];

  for (const w of windows) {
    const daysUntilStart = Math.round((new Date(w.start) - new Date(todayISO)) / 86400000);
    if (daysUntilStart < 0 || daysUntilStart > LOOKAHEAD_DAYS) continue; // fuera de la ventana de aviso
    const dedupKey = `${w.label}-${w.start}`;
    if (notified.includes(dedupKey)) continue; // ya se avisó esta temporada puntual

    try {
      const pct = await _getOccupancyPct(supabase, hotelId, w.start, w.end, totalUnits);
      if (pct != null && pct < LOW_OCCUPANCY_THRESHOLD) {
        addNotification({
          type: 'high_season_low_occupancy', category: 'reservas', icon: '📢', color: '#F59E0B',
          title: `${w.label} se acerca — ocupación floja`,
          message: `Faltan ${daysUntilStart} día${daysUntilStart !== 1 ? 's' : ''} y todavía tenés ${pct}% de ocupación para esas fechas. Podría ser buen momento para promocionar.`,
          data: { window: w.label, start: w.start, end: w.end, pct },
        });
      }
      notified.push(dedupKey);
    } catch (err) {
      console.warn(`[Temporada alta] error revisando ${w.label}:`, err?.message ?? err);
    }
  }

  try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified.slice(-30))); } catch {}
  localStorage.setItem(LASTRUN_KEY, String(now));
}
