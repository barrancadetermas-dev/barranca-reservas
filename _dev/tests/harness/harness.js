// Arnés de pruebas de integración del formulario de reservas (Playwright + Vite dev).
// Monta el HTML real del modal con un Supabase SIMULADO que registra cada llamada.
import { BookingForm } from '/js/components/booking-form.js';
import { AppContext } from '/js/supabase-config.js';

window.__calls = [];
window.__data  = {};   // 'tabla' o 'tabla:op' -> respuesta
function builder(table) {
  const rec = { table, op: 'select', args: [], filters: [] };
  const q = new Proxy({}, { get(_, prop) {
    if (prop === 'then') {
      const key = `${table}:${rec.op}`;
      let data = window.__data[key] ?? window.__data[table] ?? [];
      if (typeof data === 'function') data = data(rec);
      window.__calls.push({ ...rec, key });
      const single = rec.filters.includes('single');
      const out = { data: single ? (Array.isArray(data) ? data[0] ?? null : data) : data, error: window.__errors?.[key] ?? null };
      return (res, rej) => Promise.resolve(out).then(res, rej);
    }
    return (...args) => {
      if (['select','insert','update','upsert','delete'].includes(prop)) { if (prop !== 'select' || rec.op === 'select') rec.op = prop; rec.args.push([prop, ...args]); }
      else rec.filters.push(prop === 'single' || prop === 'maybeSingle' ? 'single' : `${prop}(${args.map(a => JSON.stringify(a)).join(',')})`);
      return q;
    };
  } });
  return q;
}
const fakeDb = { from: builder, functions: { invoke: async () => ({}) }, auth: {} };

const units = [
  { id: 'D2', name: 'Departamento 2', color: '#ef4444', sort_order: 2, max_guests: 4 },
  { id: 'D3', name: 'Departamento 3', color: '#22c55e', sort_order: 3, max_guests: 4 },
  { id: 'D5', name: 'Departamento 5', color: '#3b82f6', sort_order: 5, max_guests: 6 },
  { id: 'D6', name: 'Departamento 6', color: '#eab308', sort_order: 6, max_guests: 2 },
];
AppContext.units = units; AppContext.hotelId = 'H1'; AppContext.config = { checkin_time: '14:00', checkout_time: '10:00' };
window.form = new BookingForm(fakeDb, { hotelId: 'H1', units, IS_DEMO: false });
window.__ready = true;
