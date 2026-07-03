// ═══════════════════════════════════════════════════
// waitlist-service.js — Lista de espera
// Cuando se cancela/reprograma una reserva (evento
// BOOKING_CANCELLED del event-bus), revisa si alguna
// entrada de la lista de espera coincide con las fechas
// que quedaron libres, y si coincide, crea un
// Recordatorio automático para avisarle al huésped.
// ═══════════════════════════════════════════════════

import { Bus, EVENTS } from './event-bus.js';
import { showToast } from '../supabase-config.js';

let _db = null;

/** Se llama una vez al iniciar la app (igual que otros servicios). */
export function initWaitlistService(supabase) {
  _db = supabase;
  Bus.on(EVENTS.BOOKING_CANCELLED, (payload) => {
    _checkAndNotify(payload).catch(err => console.warn('[Waitlist] check error:', err?.message ?? err));
  });
}

// Busca entradas "open" de la lista de espera cuyas fechas se solapen con
// el rango que se liberó, y cuya unidad pedida (o "cualquiera") esté entre
// las que se liberaron.
export async function checkWaitlistMatches(db, hotelId, checkIn, checkOut, freedUnitIds) {
  const { data } = await db.from('waitlist')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('status', 'open')
    .lt('check_in', checkOut)
    .gt('check_out', checkIn);

  const freed = (freedUnitIds ?? []).map(String);
  return (data ?? []).filter(w =>
    !w.unit_ids?.length || w.unit_ids.some(id => freed.includes(String(id)))
  );
}

// Crea un Recordatorio por cada match y marca esas entradas como "notified"
// para no volver a avisar por el mismo hueco dos veces.
export async function notifyWaitlistMatches(db, hotelId, matches) {
  if (!matches?.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const fmtD  = (s) => { const [y,m,d] = s.split('-'); return `${d}/${m}`; };

  const rows = matches.map(w => ({
    hotel_id:       hotelId,
    title:          `🔔 Se liberaron fechas — avisar a ${w.guest_name}`,
    description:    `Pidió ${fmtD(w.check_in)} → ${fmtD(w.check_out)}${w.phone ? ` · Tel: ${w.phone}` : ''} 🔔WAITLIST:${w.id}`,
    scheduled_date: today,
    unit_ids:       w.unit_ids ?? [],
    is_note:        false,
  }));

  await db.from('reminders').insert(rows);
  await db.from('waitlist')
    .update({ status: 'notified', notified_at: new Date().toISOString() })
    .in('id', matches.map(m => m.id));
}

async function _checkAndNotify({ hotelId, checkIn, checkOut, unitIds }) {
  if (!_db || !hotelId || !checkIn || !checkOut) return;
  const matches = await checkWaitlistMatches(_db, hotelId, checkIn, checkOut, unitIds);
  if (!matches.length) return;
  await notifyWaitlistMatches(_db, hotelId, matches);
  showToast(
    matches.length === 1
      ? `🔔 Se liberaron fechas que esperaba ${matches[0].guest_name} — se creó un recordatorio`
      : `🔔 Se liberaron fechas que esperaban ${matches.length} personas en lista de espera — se crearon recordatorios`,
    'info'
  );
  document.dispatchEvent(new CustomEvent('booking:changed')); // refresca badge de recordatorios
}
