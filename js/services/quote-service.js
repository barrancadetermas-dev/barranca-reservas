// ══════════════════════════════════════════════════
// quote-service.js — Cotización Rápida (calendario)
// CRUD sobre quick_quotes. Ver migration_quick_quotes.sql
// ══════════════════════════════════════════════════

export async function createQuote(db, payload) {
  const { data, error } = await db.from('quick_quotes').insert(payload).select().single();
  if (error) { console.warn('[Quote] createQuote:', error.message); return { data: null, error }; }
  return { data, error: null };
}

export async function updateQuote(db, id, fields) {
  const { data, error } = await db.from('quick_quotes')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) { console.warn('[Quote] updateQuote:', error.message); return { data: null, error }; }
  return { data, error: null };
}

export async function markQuoteConverted(db, id, bookingId) {
  return updateQuote(db, id, { status: 'converted', converted_booking_id: bookingId });
}

// Cotizaciones activas ("draft") que se superponen con un rango — para
// avisar en el panel si ya había una cotización previa sobre esas fechas.
export async function fetchOverlappingQuotes(db, hotelId, unitId, checkInISO, checkOutISO) {
  const { data, error } = await db.from('quick_quotes')
    .select('id,check_in,check_out,total,guest_name,status,created_at')
    .eq('hotel_id', hotelId).eq('unit_id', unitId).eq('status', 'draft')
    .lt('check_in', checkOutISO).gt('check_out', checkInISO)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[Quote] fetchOverlappingQuotes:', error.message); return []; }
  return data ?? [];
}

// Reservas REALES que se superponen con el rango — para no dejar
// cotizar (ni mucho menos convertir) sobre noches ya ocupadas.
// IMPORTANTE: si booking_units tiene segment_check_in/segment_check_out
// (estadía dividida entre 2 unidades), la ocupación de ESA unidad se
// limita a su tramo — no a las fechas completas de la reserva.
export async function fetchOverlappingBookings(db, hotelId, unitId, checkInISO, checkOutISO) {
  const { data, error } = await db.from('bookings')
    .select('id,check_in,check_out,status,guests!bookings_guest_id_fkey(first_name,last_name),booking_units(unit_id,segment_check_in,segment_check_out)')
    .eq('hotel_id', hotelId)
    .neq('status', 'cancelled')
    .lt('check_in', checkOutISO).gt('check_out', checkInISO)
    .order('check_in', { ascending: true });
  if (error) { console.warn('[Quote] fetchOverlappingBookings:', error.message); return []; }
  return (data ?? [])
    .map(b => {
      const bu = (b.booking_units ?? []).find(x => x.unit_id === unitId);
      if (!bu) return null;
      // Tramo real de ESTA unidad dentro de la reserva (o la reserva
      // completa si no está dividida).
      const segIn  = bu.segment_check_in  ?? b.check_in;
      const segOut = bu.segment_check_out ?? b.check_out;
      if (segIn >= checkOutISO || segOut <= checkInISO) return null; // no se superpone realmente
      return { ...b, check_in: segIn, check_out: segOut };
    })
    .filter(Boolean);
}

// Unidades DISPONIBLES para una noche puntual (sin cruzar al chunk de
// mila-assistant — se resuelve acá mismo, con la misma lógica de tramos
// que ya usa fetchOverlappingBookings, para no generar un chunk circular
// entre calendar/booking-form/statistics/mila-assistant).
export async function fetchAvailableUnitsForNight(db, hotelId, units, dateISO, excludeUnitId) {
  const nextDate = (() => {
    const d = new Date(dateISO + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  })();

  const { data, error } = await db.from('bookings')
    .select('booking_units(unit_id,segment_check_in,segment_check_out)')
    .eq('hotel_id', hotelId)
    .neq('status', 'cancelled')
    .lt('check_in', nextDate).gt('check_out', dateISO);
  if (error) { console.warn('[Quote] fetchAvailableUnitsForNight:', error.message); return []; }

  const occupied = new Set();
  (data ?? []).forEach(b => {
    (b.booking_units ?? []).forEach(bu => {
      const segIn  = bu.segment_check_in  ?? dateISO;   // si no hay tramo propio, asumimos que sí cubre (fallback conservador via check general de abajo)
      const segOut = bu.segment_check_out ?? nextDate;
      if (segIn <= dateISO && segOut > dateISO) occupied.add(bu.unit_id);
    });
  });

  return (units ?? [])
    .filter(u => u.id !== excludeUnitId && !occupied.has(u.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export async function deleteQuote(db, id) {
  return db.from('quick_quotes').delete().eq('id', id);
}
