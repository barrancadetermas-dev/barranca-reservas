// ══════════════════════════════════════════════════
// dollar-api.js v4.0 — Dólar Oficial ARS (MILA)
//
// 3 fuentes de dólar OFICIAL venta únicamente:
//   1. DolarAPI (BNA — Banco Nación Argentina)
//   2. Ámbito Financiero
//   3. ArgentinaDatos (agregador oficial)
//
// Calculadora usa EXCLUSIVAMENTE BNA venta.
// Blue/MEP/CCL/Tarjeta completamente removidos.
// ══════════════════════════════════════════════════

let _cache      = null;
let _cacheTs    = 0;
let _refreshId  = null;
const CACHE_TTL    = 5 * 60 * 1000;   // 5 minutos
const REFRESH_EVERY= 5 * 60 * 1000;   // auto-refresh
const TIMEOUT_MS   = 7000;

// ── Fuente 1: DolarAPI.com → BNA oficial ─────────
async function _fetchBNA() {
  try {
    const d = await _get('https://dolarapi.com/v1/dolares/oficial');
    const sell = parseFloat(d?.venta);
    const buy  = parseFloat(d?.compra);
    if (!sell) return null;
    return { sell, buy, source: 'BNA', label: 'Banco Nación' };
  } catch { return null; }
}

// ── Fuente 2: Ámbito Financiero ───────────────────
async function _fetchAmbito() {
  try {
    const d = await _get('https://mercados.ambito.com/dolar/oficial/variacion');
    const sell = parseFloat(String(d?.venta  ?? '').replace(',', '.'));
    const buy  = parseFloat(String(d?.compra ?? '').replace(',', '.'));
    if (!sell) return null;
    return { sell, buy, source: 'ambito', label: 'Ámbito' };
  } catch { return null; }
}

// ── Fuente 3: ArgentinaDatos (oficial tracker) ────
async function _fetchArgentinaDatos() {
  try {
    const arr = await _get('https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial');
    // Devuelve array, el último es el más reciente
    const last = Array.isArray(arr) ? arr[arr.length - 1] : arr;
    const sell = parseFloat(last?.venta);
    const buy  = parseFloat(last?.compra);
    if (!sell) return null;
    return { sell, buy, source: 'argentinadatos', label: 'Dólar Hoy' };
  } catch { return null; }
}

// ── Fetch principal ───────────────────────────────
export async function fetchDollarRates() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;

  const [r1, r2, r3] = await Promise.allSettled([
    _fetchBNA(),
    _fetchAmbito(),
    _fetchArgentinaDatos(),
  ]);

  const sources = [r1, r2, r3]
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean);

  if (!sources.length) {
    // Sin ninguna fuente: devolver caché aunque esté vencido
    return _cache
      ? { ..._cache, stale: true, staleSince: new Date().toISOString() }
      : null;
  }

  // Promedio de ventas oficiales (solo fuentes que respondieron)
  const sells = sources.map(s => s.sell).filter(v => v > 0);
  const buys  = sources.map(s => s.buy).filter(v => v > 0);
  const avg   = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100 : null;

  // BNA específico para calculadora (primera fuente)
  const bnaSource = sources.find(s => s.source === 'BNA');

  const rates = {
    oficial: {
      sell: avg(sells),
      buy:  avg(buys),
    },
    bna: {
      sell: bnaSource?.sell ?? sells[0] ?? null,
      buy:  bnaSource?.buy  ?? buys[0]  ?? null,
    },
    sources:    sources.map(s => s.source),
    sourceData: sources,   // datos por fuente para el widget
    updatedAt:  new Date().toISOString(),
    stale:      false,
    failedSources: [
      r1.status !== 'fulfilled' || !r1.value ? 'BNA'        : null,
      r2.status !== 'fulfilled' || !r2.value ? 'Ámbito'     : null,
      r3.status !== 'fulfilled' || !r3.value ? 'Dólar Hoy'  : null,
    ].filter(Boolean),
  };

  _cache   = rates;
  _cacheTs = Date.now();
  return rates;
}

// ── BNA sell para calculadora ─────────────────────
export function getBNASell(rates) {
  return rates?.bna?.sell ?? rates?.oficial?.sell ?? null;
}

// ── Auto-refresh ──────────────────────────────────
export function startDollarAutoRefresh(onUpdate) {
  if (_refreshId) clearInterval(_refreshId);
  _refreshId = setInterval(async () => {
    _cacheTs = 0;
    const r = await fetchDollarRates();
    if (r && onUpdate) onUpdate(r);
  }, REFRESH_EVERY);
  return _refreshId;
}
export function stopDollarAutoRefresh() {
  if (_refreshId) { clearInterval(_refreshId); _refreshId = null; }
}
export function clearDollarCache() { _cache = null; _cacheTs = 0; }
export function getCachedOfficialSell() { return _cache?.oficial?.sell ?? null; }
export function getCachedBNASell()      { return _cache?.bna?.sell      ?? null; }

/**
 * Fuente única de verdad para el dólar oficial promedio (compra y venta).
 * Cualquier parte de la app que necesite convertir o mostrar el dólar
 * oficial DEBE usar esta función — nunca leer el badge del DOM ni
 * recalcular el promedio por su cuenta.
 * Devuelve { buy, sell } o { buy: null, sell: null } si todavía no hay datos.
 */
export function getOfficialAverageRate() {
  return {
    buy:  _cache?.oficial?.buy  ?? null,
    sell: _cache?.oficial?.sell ?? null,
  };
}

/** Badge compacto para el header */
export function formatDollarBadge(rates) {
  if (!rates?.oficial?.sell) return '—';
  return `$${Math.round(rates.oficial.sell).toLocaleString('es-AR')}`;
}

/** Texto completo "Dólar Oficial Promedio Compra: $X Venta: $Y" para el header */
export function formatDollarHeaderLabel(rates) {
  const buy  = rates?.oficial?.buy;
  const sell = rates?.oficial?.sell;
  if (!buy && !sell) return 'Dólar Oficial Promedio — sin datos';
  const fmt = v => v ? `$${Math.round(v).toLocaleString('es-AR')}` : '—';
  return `Dólar Oficial Promedio Compra: ${fmt(buy)} Venta: ${fmt(sell)}`;
}

// ── Helper fetch con timeout ──────────────────────
async function _get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
