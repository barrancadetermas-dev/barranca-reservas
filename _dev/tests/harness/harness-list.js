// Arnés de la lista de reservas (cobro, check-in tardío, símbolos). Base simulada configurable por tabla/op.
import { BookingList } from '/js/components/booking-list.js';
import { AppContext } from '/js/supabase-config.js';

window.__calls = []; window.__data = {}; window.__errors = {};
function builder(table) {
  const rec = { table, op: 'select', args: [], filters: [] };
  const q = new Proxy({}, { get(_, prop) {
    if (prop === 'then') {
      const key = `${table}:${rec.op}`; let data = window.__data[key] ?? window.__data[table] ?? [];
      if (typeof data === 'function') data = data(rec);
      window.__calls.push({ ...rec, key });
      const single = rec.filters.includes('single');
      const out = { data: single ? (Array.isArray(data) ? data[0] ?? null : data) : data, error: window.__errors?.[key] ?? null };
      return (res, rej) => Promise.resolve(out).then(res, rej);
    }
    return (...args) => {
      if (['insert', 'update', 'upsert', 'delete'].includes(prop)) { rec.op = prop; rec.args.push([prop, ...args]); }
      else if (prop === 'select') { rec.args.push([prop, ...args]); }
      else rec.filters.push(prop === 'single' || prop === 'maybeSingle' ? 'single' : `${prop}(${args.map(a => JSON.stringify(a)).join(',')})`);
      return q;
    };
  } });
  return q;
}
const fakeDb = { from: builder, functions: { invoke: async () => ({}) }, auth: {}, rpc: async () => ({ data: null, error: null }) };
const units = [{ id: 'D2', name: 'Departamento 2', color: '#ef4444', sort_order: 2 }];
AppContext.units = units; AppContext.hotelId = 'H1'; AppContext.config = {}; AppContext.role = 'admin';
window.list = new BookingList(fakeDb, { hotelId: 'H1', units }, { open() {}, openDetail() {} });
window.__ready = true;
