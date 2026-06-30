// ══════════════════════════════════════════════════
// tariff-service.js — Cuadro Tarifario
// Funciones compartidas para Calendario (PC), tab mobile
// y el editor en Configuración.
// ══════════════════════════════════════════════════
import { AppContext } from '../supabase-config.js';

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
export { MONTH_NAMES };

// ── Tarifas mensuales por unidad ──────────────────
// months: array de { year, month } (month = 1-12)
export async function fetchMonthlyRates(db, hotelId, months) {
  if (!months.length) return [];
  const ors = months.map(m => `and(year.eq.${m.year},month.eq.${m.month})`).join(',');
  const { data, error } = await db.from('unit_monthly_rates')
    .select('*')
    .eq('hotel_id', hotelId)
    .or(ors);
  if (error) { console.warn('[Tariff] fetchMonthlyRates:', error.message); return []; }
  return data ?? [];
}

export async function upsertMonthlyRate(db, hotelId, unitId, year, month, fields) {
  return db.from('unit_monthly_rates').upsert({
    hotel_id: hotelId, unit_id: unitId, year, month, ...fields,
  }, { onConflict: 'hotel_id,unit_id,year,month' });
}

// ── Columnas personalizadas (ej: "Finde 17/Ago") ──
export async function fetchCustomColumns(db, hotelId, rangeFrom, rangeTo) {
  const { data, error } = await db.from('tariff_custom_columns')
    .select('*, tariff_custom_prices(*)')
    .eq('hotel_id', hotelId)
    .eq('active', true)
    .order('position', { ascending: true });
  if (error) { console.warn('[Tariff] fetchCustomColumns:', error.message); return []; }
  // Filtrar: visible si no tiene fechas, o si su rango se solapa con la ventana visible
  return (data ?? []).filter(c => {
    if (!c.date_from && !c.date_to) return true;
    if (!rangeFrom || !rangeTo) return true;
    const cf = c.date_from ?? '0000-01-01';
    const ct = c.date_to   ?? '9999-12-31';
    return cf <= rangeTo && ct >= rangeFrom;
  });
}

export async function upsertCustomColumn(db, hotelId, payload) {
  return db.from('tariff_custom_columns').upsert({ hotel_id: hotelId, ...payload });
}
export async function deleteCustomColumn(db, id) {
  return db.from('tariff_custom_columns').delete().eq('id', id);
}
export async function upsertCustomPrice(db, customColumnId, unitId, fields) {
  return db.from('tariff_custom_prices').upsert({
    custom_column_id: customColumnId, unit_id: unitId, ...fields,
  }, { onConflict: 'custom_column_id,unit_id' });
}

// ── Helper: meses distintos cubiertos por un rango de fechas (YYYY-MM-DD) ──
export function monthsInRange(fromISO, toISO) {
  const out = [];
  const seen = new Set();
  let d = new Date(fromISO + 'T12:00:00');
  const end = new Date(toISO + 'T12:00:00');
  while (d <= end) {
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const key = `${y}-${m}`;
    if (!seen.has(key)) { seen.add(key); out.push({ year: y, month: m }); }
    d.setMonth(d.getMonth() + 1, 1);
  }
  return out;
}

// ── Agrupa filas con precio IDÉNTICO en todas las columnas ──
// Solo para vistas de solo lectura (calendario PC, mobile). El editor de
// Configuración mantiene una fila por unidad para poder editar cada una.
// #2 y #3 con el mismo precio en todos los meses → una sola fila "#2 | #3"
export function groupRowsByPrice(rows) {
  const cellsKey = cells => cells.map(c =>
    `${c.type}|${c.price}|${c.promoActive ?? ''}|${c.promoPay ?? ''}|${c.promoFree ?? ''}|${c.nights ?? ''}`
  ).join('§');

  const groups = [];
  const indexByKey = new Map();
  rows.forEach(row => {
    const key = cellsKey(row.cells);
    if (indexByKey.has(key)) {
      groups[indexByKey.get(key)].units.push(row.unit);
    } else {
      indexByKey.set(key, groups.length);
      groups.push({ units: [row.unit], cells: row.cells });
    }
  });
  // Ordenar cada grupo por número de unidad, y los grupos entre sí por el primer número
  groups.forEach(g => g.units.sort((a,b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
  groups.sort((a,b) => (a.units[0]?.sort_order ?? 0) - (b.units[0]?.sort_order ?? 0));
  return groups;
}
// Devuelve { columns: [{type:'month'|'custom', ...}], rows: [{unit, cells:[...]}] }
// Las columnas de mes y las personalizadas se intercalan en orden cronológico:
// si "Finde 17/Ago" cae dentro de agosto, queda Agosto | Finde 17/Ago | Septiembre.
export function buildTariffGrid({ units, rates, customCols, months }) {
  const rateMap = new Map(); // unitId|year|month -> rate row
  rates.forEach(r => rateMap.set(`${r.unit_id}|${r.year}|${r.month}`, r));

  const monthColumns = months.map(m => ({
    type: 'month',
    key: `m-${m.year}-${m.month}`,
    label: MONTH_NAMES[m.month - 1],
    year: m.year, month: m.month,
    sortKey: `${m.year}-${String(m.month).padStart(2,'0')}-01`,
  }));

  const customColumns = (customCols ?? []).map(c => ({
    type: 'custom',
    key: `c-${c.id}`,
    id: c.id,
    label: c.title,
    note: c.note,
    prices: c.tariff_custom_prices ?? [],
    // Sin fechas → al final de todo (no tiene posición cronológica real)
    sortKey: c.date_from ?? '9999-99-99',
  }));

  const columns = [...monthColumns, ...customColumns].sort((a,b) => a.sortKey.localeCompare(b.sortKey));

  const rows = (units ?? []).map(u => {
    const cells = columns.map(col => {
      if (col.type === 'month') {
        const r = rateMap.get(`${u.id}|${col.year}|${col.month}`);
        return {
          type: 'month',
          price: r?.price_per_night ?? null,
          promoActive: !!r?.promo_active,
          promoPay:    r?.promo_pay  ?? null,
          promoFree:   r?.promo_free ?? null,
        };
      }
      const p = col.prices.find(x => x.unit_id === u.id);
      return { type: 'custom', price: p?.price ?? null, nights: p?.nights ?? null, note: p?.note ?? null };
    });
    return { unit: u, cells };
  });

  return { columns, rows };
}
