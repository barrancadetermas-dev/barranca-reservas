// ══════════════════════════════════════════════════
// tariff-service.js — Cuadro Tarifario
// Funciones compartidas para Calendario (PC), tab mobile
// y el editor en Configuración.
// ══════════════════════════════════════════════════
import { AppContext, toISODate } from '../supabase-config.js';

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

export function upsertCustomColumn(db, hotelId, payload) {
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

// ── Precio sugerido noche a noche para una unidad en un rango ──────
// Reutiliza EXACTAMENTE la misma fuente que el Cuadro Tarifario:
// 1) Columna personalizada (ej: "Finde largo 21/Nov") si la fecha cae
//    dentro de su rango y tiene precio cargado para esa unidad → prioridad.
// 2) Si no, la tarifa mensual cargada para esa unidad ese mes.
// 3) Si no hay nada cargado, precio null (el usuario lo completa a mano).
// Devuelve un array de { date, price, source, label } — uno por noche
// (check_out NO incluido, como toda noche de hotelería).
export async function getSuggestedNightlyPrices(db, hotelId, unitId, checkInISO, checkOutISO) {
  const months = monthsInRange(checkInISO, checkOutISO);
  const [rates, customCols] = await Promise.all([
    fetchMonthlyRates(db, hotelId, months),
    fetchCustomColumns(db, hotelId, checkInISO, checkOutISO),
  ]);

  const rateMap = new Map();
  rates.forEach(r => { if (r.unit_id === unitId) rateMap.set(`${r.year}|${r.month}`, r); });

  const nights = [];
  let d = new Date(checkInISO + 'T12:00:00');
  const end = new Date(checkOutISO + 'T12:00:00');
  while (d < end) {
    const dateISO = toISODate(d);
    // Buscar columna personalizada vigente para esta fecha/unidad
    const col = customCols.find(c =>
      (c.date_from ?? '0000-01-01') <= dateISO && (c.date_to ?? '9999-12-31') >= dateISO &&
      c.tariff_custom_prices?.some(p => p.unit_id === unitId && p.price != null)
    );
    if (col) {
      const p = col.tariff_custom_prices.find(x => x.unit_id === unitId);
      nights.push({ date: dateISO, price: p.price, source: 'custom', label: col.title });
    } else {
      const r = rateMap.get(`${d.getFullYear()}|${d.getMonth() + 1}`);
      nights.push({ date: dateISO, price: r?.price_per_night ?? null, source: r ? 'monthly' : 'none', label: null });
    }
    d.setDate(d.getDate() + 1);
  }
  return nights;
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

// ── Agrupa filas para el Cuadro Tarifario (solo lectura) ──
// Solo para vistas de solo lectura (calendario PC, mobile). El editor de
// Configuración mantiene una fila por unidad para poder editar cada una.
//
// Reglas de agrupación (en orden de prioridad):
// 1) Unidades con el mismo `unit.rate_group` (no nulo/no vacío) SIEMPRE van
//    juntas en una sola fila, sin importar si el precio coincide o está
//    vacío. Esto evita que el grupo se "rompa" o se mezcle con otros cuando
//    todavía no hay tarifas cargadas (todo $0/—).
// 2) Unidades SIN rate_group asignado solo se agrupan entre sí cuando
//    comparten un precio REAL (no nulo) idéntico en todas las columnas.
//    Si no tienen ningún precio cargado, quedan cada una en su propia fila
//    (nunca se mezclan solo porque ambas están vacías).
export function groupRowsByPrice(rows) {
  const cellsKey = cells => cells.map(c =>
    `${c.type}|${c.price}|${c.promoActive ?? ''}|${c.promoPay ?? ''}|${c.promoFree ?? ''}|${c.nights ?? ''}`
  ).join('§');

  const hasRealPrice = cells => cells.some(c => c.price != null);

  const groups = [];
  const indexByKey = new Map(); // clave -> índice en groups, solo para fallback por precio

  rows.forEach(row => {
    const rg = row.unit?.rate_group?.trim();

    if (rg) {
      // Agrupación manual fija: todas las unidades con el mismo rate_group
      // van juntas, independientemente del precio.
      const key = `rg|${rg}`;
      if (indexByKey.has(key)) {
        groups[indexByKey.get(key)].units.push(row.unit);
      } else {
        indexByKey.set(key, groups.length);
        groups.push({ units: [row.unit], cells: row.cells });
      }
      return;
    }

    // Sin rate_group: solo agrupar por precio si hay al menos un precio real.
    if (hasRealPrice(row.cells)) {
      const key = `price|${cellsKey(row.cells)}`;
      if (indexByKey.has(key)) {
        groups[indexByKey.get(key)].units.push(row.unit);
        return;
      }
      indexByKey.set(key, groups.length);
      groups.push({ units: [row.unit], cells: row.cells });
      return;
    }

    // Sin rate_group y sin ningún precio cargado: fila propia, nunca se
    // mezcla con otra unidad solo porque ambas están vacías.
    groups.push({ units: [row.unit], cells: row.cells });
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
