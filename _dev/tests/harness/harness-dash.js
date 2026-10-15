// Arnés del Dashboard: reserva con cambio de depto + base simulada que filtra como lo haría la consulta real.
import { Dashboard } from '/js/components/dashboard.js';
import { AppContext } from '/js/supabase-config.js';

const units = [
  { id: 'D2', name: 'Departamento 2', color: '#ef4444', sort_order: 2 },
  { id: 'D3', name: 'Departamento 3', color: '#22c55e', sort_order: 3 },
  { id: 'D5', name: 'Departamento 5', color: '#3b82f6', sort_order: 5 },
];
const BOOKING = {
  id: 'b1234', check_in: '2026-01-10', check_out: '2026-01-13', nights: 3, status: 'paid', pax: 2,
  total_amount: 160000, total_paid: 160000, balance: 0, checked_in_at: '2026-01-10T15:00:00Z', source: 'direct',
  guests: { first_name: 'Juan', last_name: 'Pérez', phone: '1', gender: 'nonbinary' },
  booking_units: [
    { unit_id: 'D5', price_per_night: 60000, segment_check_in: '2026-01-12', segment_check_out: '2026-01-13', units: { name: 'Departamento 5', color: '#3b82f6', sort_order: 5 } },
    { unit_id: 'D2', price_per_night: 50000, segment_check_in: '2026-01-10', segment_check_out: '2026-01-12', units: { name: 'Departamento 2', color: '#ef4444', sort_order: 2 } },
  ],
};
window.__calls = [];
window.__booking = BOOKING;
window.__updateRows = null;   // filas que devuelve un UPDATE (null = una fila)
window.__events = [];
document.addEventListener('booking:changed', () => window.__events.push('changed'));
function builder(table) {
  const rec = { table, op: 'select', args: [], filters: [] };
  const q = new Proxy({}, { get(_, prop) {
    if (prop === 'then') {
      window.__calls.push({ ...rec });
      const f = rec.filters.join('|'); let data = [];
      if (rec.op === 'update') { data = window.__updateRows ?? [{ id: BOOKING.id }]; const single0 = rec.filters.includes('single'); const o0 = { data: single0 ? (data[0] ?? null) : data, error: null }; return (res, rej) => Promise.resolve(o0).then(res, rej); }
      if (table === 'booking_units' && f.includes('limit')) data = []; // sonda de columnas de tramo
      else if (table === 'bookings') {
        const m = (re) => (f.match(re) ?? [])[1];
        const eqCi = m(/eq\("check_in","([^"]+)"\)/), eqCo = m(/eq\("check_out","([^"]+)"\)/);
        const lteCi = m(/lte\("check_in","([^"]+)"\)/), gtCo = m(/gt\("check_out","([^"]+)"\)/);
        if (eqCi) data = BOOKING.check_in === eqCi ? [BOOKING] : [];
        else if (eqCo) data = BOOKING.check_out === eqCo ? [BOOKING] : [];
        else if (lteCi && gtCo) data = (BOOKING.check_in <= lteCi && BOOKING.check_out > gtCo) ? [BOOKING] : [];
        else if (/lt\("check_in"/.test(f) && gtCo) data = (BOOKING.check_out > gtCo) ? [BOOKING] : []; // pronóstico de ocupación
      }
      const single = rec.filters.includes('single');
      const out = { data: single ? (data[0] ?? null) : data, error: null };
      return (res, rej) => Promise.resolve(out).then(res, rej);
    }
    return (...args) => {
      if (['insert', 'update', 'upsert', 'delete'].includes(prop)) { rec.op = prop; rec.args.push([prop, ...args]); }
      rec.filters.push(prop === 'single' || prop === 'maybeSingle' ? 'single' : `${prop}(${args.map(a => JSON.stringify(a)).join(',')})`);
      return q;
    };
  } });
  return q;
}
const fakeDb = { from: builder, functions: { invoke: async () => ({}) }, auth: {}, rpc: async () => ({ data: null, error: null }) };
AppContext.units = units; AppContext.hotelId = 'H1'; AppContext.config = {};
window.dash = new Dashboard(fakeDb, { hotelId: 'H1', units }, null);
window.__ready = true;
