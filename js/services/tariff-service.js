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

// ── Construye la estructura final lista para pintar la tabla ──
// Devuelve { months: [{year,month,label}], customCols: [...], rows: [{unit, cells:[...]}]}
export function buildTariffGrid({ units, rates, customCols, months }) {
  const rateMap = new Map(); // unitId|year|month -> rate row
  rates.forEach(r => rateMap.set(`${r.unit_id}|${r.year}|${r.month}`, r));

  const monthCols = months.map(m => ({
    key: `m-${m.year}-${m.month}`,
    label: MONTH_NAMES[m.month - 1],
    year: m.year, month: m.month,
  }));

  const rows = (units ?? []).map(u => {
    const cells = monthCols.map(mc => {
      const r = rateMap.get(`${u.id}|${mc.year}|${mc.month}`);
      return {
        price: r?.price_per_night ?? null,
        promoActive: !!r?.promo_active,
        promoPay:    r?.promo_pay  ?? null,
        promoFree:   r?.promo_free ?? null,
      };
    });
    const customCells = (customCols ?? []).map(c => {
      const p = (c.tariff_custom_prices ?? []).find(x => x.unit_id === u.id);
      return { price: p?.price ?? null, nights: p?.nights ?? null, note: p?.note ?? null };
    });
    return { unit: u, cells, customCells };
  });

  return { monthCols, customCols: customCols ?? [], rows };
}
