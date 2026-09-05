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
export async function fetchOverlappingBookings(db, hotelId, unitId, checkInISO, checkOutISO) {
  const { data, error } = await db.from('bookings')
    .select('id,check_in,check_out,status,guests!bookings_guest_id_fkey(first_name,last_name),booking_units(unit_id)')
    .eq('hotel_id', hotelId)
    .neq('status', 'cancelled')
    .lt('check_in', checkOutISO).gt('check_out', checkInISO)
    .order('check_in', { ascending: true });
  if (error) { console.warn('[Quote] fetchOverlappingBookings:', error.message); return []; }
  return (data ?? []).filter(b => (b.booking_units ?? []).some(bu => bu.unit_id === unitId));
}

export async function deleteQuote(db, id) {
  return db.from('quick_quotes').delete().eq('id', id);
}
