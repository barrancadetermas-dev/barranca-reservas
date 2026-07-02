// ══════════════════════════════════════════════════
// mila-data.js — "Preguntale a MILA"
// Capa de datos: reutiliza EXACTAMENTE la misma forma de
// consultas que ya usan dashboard.js / statistics.js /
// booking-form.js / booking-list.js / calendar.js /
// tariff-service.js. No se crean tablas, columnas ni
// cálculos nuevos — solo se re-exponen para el panel.
// ══════════════════════════════════════════════════
import { supabase, AppContext } from '../../supabase-config.js';
import { fetchMonthlyRates, fetchCustomColumns, monthsInRange, buildTariffGrid } from '../../services/tariff-service.js';

const guestSel = `guests!bookings_guest_id_fkey(first_name,last_name)`;
const unitsSel = `booking_units(unit_id, units(name))`;

function guestName(b) {
  const g = b.guests;
  return g ? `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() || '—' : '—';
}
function unitNames(b) {
  return (b.booking_units ?? []).map(bu => bu.units?.name).filter(Boolean).join(', ') || '—';
}

// 1) Check-ins / Check-outs en una fecha — misma forma que Dashboard._fetchKPIs()
export async function fetchCheckInsOuts(dateISO) {
  const hotelId = AppContext.hotelId;
  const base = (col) => supabase.from('bookings')
    .select(`id, check_in, check_out, status, ${guestSel}, ${unitsSel}`)
    .eq('hotel_id', hotelId)
    .eq(col, dateISO)
    .neq('status', 'cancelled')
    .neq('status', 'blocked');

  const [{ data: checkins }, { data: checkouts }] = await Promise.all([base('check_in'), base('check_out')]);
  return {
    checkins:  (checkins  ?? []).map(b => ({ id: b.id, guest: guestName(b), unit: unitNames(b), status: b.status })),
    checkouts: (checkouts ?? []).map(b => ({ id: b.id, guest: guestName(b), unit: unitNames(b), status: b.status })),
  };
}

// 2) Reservas activas en una fecha — misma forma que la query "activeBookings" del Dashboard
export async function fetchReservasByDate(dateISO) {
  const hotelId = AppContext.hotelId;
  const { data } = await supabase.from('bookings')
    .select(`id, check_in, check_out, status, total_amount, total_paid, ${guestSel}, ${unitsSel}`)
    .eq('hotel_id', hotelId)
    .neq('status', 'cancelled')
    .neq('status', 'blocked')
    .lte('check_in', dateISO)
    .gt('check_out', dateISO);

  return (data ?? []).map(b => ({
    id: b.id, checkIn: b.check_in, checkOut: b.check_out, guest: guestName(b),
    unit: unitNames(b), status: b.status,
    balance: Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0)),
  }));
}

// 3) Disponibilidad — misma validación de superposición que booking-form.js (_validar solapamiento)
// Además: si una unidad no está libre en todo el rango pedido, calcula el sub-rango
// contiguo más largo que sí está libre dentro de ese rango, para poder sugerirlo
// (ej: pediste 5 noches, la unidad tiene 3 libres de esas 5 — se informa, no se oculta).
export async function fetchDisponibilidad(checkIn, checkOut) {
  const units = (AppContext.units ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const unitIds = units.map(u => u.id);
  if (!unitIds.length) return [];

  const { data: conflicts } = await supabase.from('booking_units')
    .select('unit_id, bookings!inner(id, status, check_in, check_out)')
    .in('unit_id', unitIds)
    .not('bookings.status', 'in', '(cancelled,blocked)')
    .lt('bookings.check_in', checkOut)
    .gt('bookings.check_out', checkIn);

  const byUnit = new Map();
  (conflicts ?? []).forEach(c => {
    const arr = byUnit.get(c.unit_id) ?? [];
    arr.push({ from: c.bookings.check_in, to: c.bookings.check_out });
    byUnit.set(c.unit_id, arr);
  });

  const dayMs   = 86400000;
  const toDate  = s => new Date(s + 'T00:00:00');
  const nights  = (a, b) => Math.round((toDate(b) - toDate(a)) / dayMs);
  const totalNights = nights(checkIn, checkOut);

  return units.map(u => {
    const busy = (byUnit.get(u.id) ?? []).slice().sort((a, b) => a.from.localeCompare(b.from));
    if (!busy.length) return { id: u.id, name: u.name, available: true, partial: null };

    // Recorrer las reservas ocupadas ordenadas y juntar los huecos libres
    // dentro del rango pedido.
    let cursor = checkIn;
    const freeRanges = [];
    for (const b of busy) {
      if (b.from > cursor) freeRanges.push({ from: cursor, to: b.from < checkOut ? b.from : checkOut });
      if (b.to > cursor) cursor = b.to;
      if (cursor >= checkOut) break;
    }
    if (cursor < checkOut) freeRanges.push({ from: cursor, to: checkOut });

    const valid = freeRanges.filter(r => r.from < r.to);
    if (!valid.length) return { id: u.id, name: u.name, available: false, partial: null };

    // Sub-rango contiguo más largo dentro de lo pedido
    let best = valid[0];
    for (const r of valid) if (nights(r.from, r.to) > nights(best.from, best.to)) best = r;

    const fullyAvailable = best.from === checkIn && best.to === checkOut;
    return {
      id: u.id,
      name: u.name,
      available: fullyAvailable,
      partial: fullyAvailable ? null : {
        from: best.from,
        to:   best.to,
        nights:    nights(best.from, best.to),
        ofNights:  totalNights,
      },
    };
  });
}

// 4) Facturación en un período — misma forma que el cálculo de "revenue del mes" del Dashboard / Estadísticas
export async function fetchFacturacion(desde, hasta) {
  const hotelId = AppContext.hotelId;
  const { data } = await supabase.from('bookings')
    .select('total_amount, total_paid, status, check_in')
    .eq('hotel_id', hotelId)
    .not('status', 'in', '(cancelled,blocked)')
    .gte('check_in', desde)
    .lte('check_in', hasta);

  const rows = data ?? [];
  const total = rows.reduce((s, b) => s + (b.total_amount ?? 0), 0);
  const cobrado = rows.reduce((s, b) => s + (b.total_paid ?? 0), 0);
  const count = rows.length;
  return { total, cobrado, count, promedio: count ? total / count : 0 };
}

// 5) Ocupación en un período — mismo criterio de solapamiento que Statistics.loadOccupancy()
export async function fetchOcupacion(desde, hasta) {
  const hotelId = AppContext.hotelId;
  const units = AppContext.units ?? [];
  const { data } = await supabase.from('bookings')
    .select('check_in, check_out, status, booking_units(unit_id)')
    .eq('hotel_id', hotelId)
    .neq('status', 'cancelled')
    .lte('check_in', hasta)
    .gt('check_out', desde);

  const from = new Date(desde + 'T00:00:00');
  const to   = new Date(hasta + 'T00:00:00');
  const totalDays = Math.max(1, Math.round((to - from) / 86400000) + 1);
  const totalUnitNights = (units.length || 1) * totalDays;

  let occupiedNights = 0;
  (data ?? []).forEach(b => {
    const ci = new Date(Math.max(new Date(b.check_in + 'T00:00:00'), from));
    const coRaw = new Date(b.check_out + 'T00:00:00');
    const limit = new Date(to.getTime() + 86400000);
    const co = coRaw < limit ? coRaw : limit;
    const nights = Math.max(0, Math.round((co - ci) / 86400000));
    occupiedNights += nights * Math.max(1, (b.booking_units ?? []).length);
  });

  const pct = totalUnitNights ? Math.min(100, Math.round((occupiedNights / totalUnitNights) * 100)) : 0;
  return { pct, occupiedNights, totalUnitNights, totalDays };
}

// 6) Precios por departamento y rango — reutiliza tariff-service.js (Cuadro Tarifario) tal cual
export async function fetchPrecios(unitId, checkIn, checkOut) {
  const hotelId = AppContext.hotelId;
  const months = monthsInRange(checkIn, checkOut);
  const [rates, customCols] = await Promise.all([
    fetchMonthlyRates(supabase, hotelId, months),
    fetchCustomColumns(supabase, hotelId, checkIn, checkOut),
  ]);
  const unit = (AppContext.units ?? []).find(u => u.id === unitId);
  if (!unit) return null;

  const { columns, rows } = buildTariffGrid({ units: [unit], rates, customCols, months });
  const cells = rows[0]?.cells ?? [];

  let total = 0, missing = false;
  let d = new Date(checkIn + 'T12:00:00');
  const end = new Date(checkOut + 'T12:00:00');
  while (d < end) {
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const colIdx = columns.findIndex(c => c.type === 'month' && c.year === y && c.month === m);
    const price = colIdx >= 0 ? cells[colIdx]?.price : null;
    if (price == null) missing = true; else total += price;
    d.setDate(d.getDate() + 1);
  }
  const nights = Math.max(0, Math.round((end - new Date(checkIn + 'T12:00:00')) / 86400000));
  return { unitName: unit.name, nights, total, missing };
}

// 7) Pagos pendientes — mismo criterio (total_amount - total_paid > 0) que la tarjeta del Dashboard
export async function fetchPagosPendientes() {
  const hotelId = AppContext.hotelId;
  const { data } = await supabase.from('bookings')
    .select(`id, check_in, check_out, total_amount, total_paid, status, ${guestSel}, ${unitsSel}`)
    .eq('hotel_id', hotelId)
    .not('status', 'in', '(cancelled,blocked)')
    .order('check_out', { ascending: true });

  return (data ?? [])
    .map(b => ({
      id: b.id, checkIn: b.check_in, checkOut: b.check_out, guest: guestName(b), unit: unitNames(b),
      balance: Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0)),
    }))
    .filter(b => b.balance > 0);
}

// 7b) Notas de crédito abiertas — mismo tag 🔄NC:<monto>:<fecha ISO> que
// usan booking-list.js / booking-form.js / guests.js para reprogramaciones
// sin fecha nueva todavía.
export async function fetchNotasCreditoAbiertas() {
  const hotelId = AppContext.hotelId;
  const { data } = await supabase.from('bookings')
    .select(`id, check_in, check_out, notes, ${guestSel}`)
    .eq('hotel_id', hotelId)
    .eq('status', 'cancelled')
    .like('notes', '%🔄NC:%');

  return (data ?? [])
    .filter(b => !b.notes?.includes('✅NCUSED') && !b.notes?.includes('❌NCVOID'))
    .map(b => {
      const m = b.notes.match(/🔄NC:(\d+):(\d{4}-\d{2}-\d{2})/);
      if (!m) return null;
      const ageDays = Math.round((Date.now() - new Date(m[2] + 'T00:00:00')) / 86400000);
      return {
        id: b.id, guest: guestName(b), amount: parseInt(m[1], 10),
        dateApplied: m[2], ageDays, stale: ageDays >= 90,
        originalDates: `${b.check_in} → ${b.check_out}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.ageDays - a.ageDays);
}

// 7c) Limpieza y mantenimiento pendiente — mismo criterio que
// notification-service.js (status !== 'completed' / 'resolved')
export async function fetchPendingOps() {
  const hotelId = AppContext.hotelId;
  const today = new Date().toISOString().slice(0, 10);
  const unitName = (id) => AppContext.units?.find(u => u.id === id)?.name ?? 'Unidad';

  const [{ data: cleanings }, { data: maint }] = await Promise.all([
    supabase.from('cleaning_tasks')
      .select('id, scheduled_date, status, notes, unit_id')
      .eq('hotel_id', hotelId)
      .neq('status', 'completed')
      .order('scheduled_date', { ascending: true }),
    supabase.from('maintenance_issues')
      .select('id, title, priority, status, created_at, unit_id')
      .eq('hotel_id', hotelId)
      .neq('status', 'resolved')
      .order('created_at', { ascending: false }),
  ]);

  return {
    cleaning: (cleanings ?? []).map(t => ({
      id: t.id, unit: unitName(t.unit_id), date: t.scheduled_date,
      overdue: t.scheduled_date < today, notes: t.notes,
    })),
    maintenance: (maint ?? []).map(m => ({
      id: m.id, unit: unitName(m.unit_id), title: m.title, urgent: m.priority === 'urgent',
    })),
  };
}

// 8) Bloqueos en una fecha — mismo criterio (status='blocked' / is_blocked) que calendar.js
export async function fetchBloqueos(dateISO) {
  const hotelId = AppContext.hotelId;
  const { data } = await supabase.from('bookings')
    .select(`id, check_in, check_out, block_reason, ${unitsSel}`)
    .eq('hotel_id', hotelId)
    .eq('status', 'blocked')
    .lte('check_in', dateISO)
    .gt('check_out', dateISO);

  return (data ?? []).map(b => ({ id: b.id, checkIn: b.check_in, checkOut: b.check_out, unit: unitNames(b), reason: b.block_reason || 'Sin motivo' }));
}

// 9) Búsqueda de huésped por nombre — misma forma que el autocompletado del buscador rápido (app.js)
// 9) Búsqueda de huésped por nombre — MISMO criterio que el Buscador de Huéspedes (guests.js):
// se busca en la tabla `guests` directamente (no como filtro embebido sobre bookings, que
// PostgREST no resuelve de forma confiable) con el mismo .or() sobre nombre/apellido/teléfono/email/DNI.
export async function fetchGuestSearch(query) {
  const hotelId = AppContext.hotelId;
  const q = query.trim();
  if (q.length < 2) return [];

  const { data: guests } = await supabase.from('guests')
    .select(`id, first_name, last_name, bookings!bookings_guest_id_fkey(id, check_in, check_out, status, total_amount, total_paid, ${unitsSel})`)
    .eq('hotel_id', hotelId)
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,dni.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(15);

  const rows = [];
  (guests ?? []).forEach(g => {
    const name = `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() || '—';
    (g.bookings ?? [])
      .filter(b => b.status !== 'cancelled' && b.status !== 'blocked')
      .sort((a, b) => b.check_in.localeCompare(a.check_in))
      .forEach(b => {
        rows.push({
          id: b.id, checkIn: b.check_in, checkOut: b.check_out, guest: name, unit: unitNames(b),
          status: b.status, balance: Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0)),
        });
      });
  });
  return rows.slice(0, 10);
}

// 10) Tendencia de ocupación de los próximos N días — mismo criterio de solapamiento que fetchOcupacion(),
// pero acumulado por día para alimentar el mini-gráfico del Resumen del día.
export async function fetchOccupancyTrend(days = 7) {
  const hotelId = AppContext.hotelId;
  const units = AppContext.units ?? [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startISO = localDateISOFromDate(today);
  const endISO = localDateISOFromDate(new Date(today.getTime() + (days - 1) * 86400000));

  const { data } = await supabase.from('bookings')
    .select('check_in, check_out, status, booking_units(unit_id)')
    .eq('hotel_id', hotelId)
    .neq('status', 'cancelled')
    .lte('check_in', endISO)
    .gt('check_out', startISO);

  const bookings = data ?? [];
  const totalUnits = units.length || 1;
  const out = [];
  for (let i = 0; i < days; i++) {
    const dayDate = new Date(today.getTime() + i * 86400000);
    const dayISO = localDateISOFromDate(dayDate);
    const occupiedUnitIds = new Set();
    bookings.forEach(b => {
      if (b.check_in <= dayISO && b.check_out > dayISO) {
        (b.booking_units ?? []).forEach(bu => occupiedUnitIds.add(bu.unit_id));
      }
    });
    out.push({ date: dayISO, pct: Math.min(100, Math.round((occupiedUnitIds.size / totalUnits) * 100)) });
  }
  return out;
}
function localDateISOFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 11) Gastos de un mes — misma tabla/criterio que la pestaña "Gastos" de Operaciones
export async function fetchGastosPorMes(monthISO) {
  const hotelId = AppContext.hotelId;
  const [year, month] = monthISO.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last  = new Date(year, month, 0).toISOString().slice(0, 10);

  const { data } = await supabase.from('expenses')
    .select('id, description, category, amount, due_date, paid, paid_at')
    .eq('hotel_id', hotelId)
    .gte('due_date', first)
    .lte('due_date', last)
    .order('description', { ascending: true });

  const items = data ?? [];
  const total = items.reduce((s, e) => s + (e.amount ?? 0), 0);
  const pagado = items.filter(e => e.paid).reduce((s, e) => s + (e.amount ?? 0), 0);
  return { items, total, pagado, count: items.length };
}

// 12) Búsqueda de gastos por concepto/proveedor/categoría — mismo criterio .or() ilike
// que ya usa fetchGuestSearch() para huéspedes, aplicado a la tabla expenses.
// Sólo trae meses actuales y anteriores (no gastos ya cargados a futuro).
export async function fetchGastosBusqueda(query) {
  const hotelId = AppContext.hotelId;
  const q = query.trim();
  if (q.length < 2) return { items: [], total: 0, count: 0 };

  const now = new Date();
  const endOfThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const { data } = await supabase.from('expenses')
    .select('id, description, category, amount, due_date, paid, paid_at')
    .eq('hotel_id', hotelId)
    .or(`description.ilike.%${q}%,category.ilike.%${q}%`)
    .lte('due_date', endOfThisMonth)
    .order('due_date', { ascending: false, nullsFirst: false })
    .limit(60);

  const items = data ?? [];
  const total = items.reduce((s, e) => s + (e.amount ?? 0), 0);
  return { items, total, count: items.length };
}
