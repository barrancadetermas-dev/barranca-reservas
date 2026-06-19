// ══════════════════════════════════════════════════
// dollar-api.js v3.0 — Cotización del Dólar (AR)
// 3 fuentes: dolarapi.com · Ámbito · bluelytics
// Promedio entre fuentes disponibles
// Auto-refresh configurable
// ══════════════════════════════════════════════════

let _cache     = null;
let _cacheTs   = 0;
let _refreshId = null;

const CACHE_TTL      = 5 * 60 * 1000;  // 5 minutos
const TIMEOUT_MS     = 6000;
const REFRESH_EVERY  = 5 * 60 * 1000;  // auto-refresh cada 5 min

// ── Tipos de dólar que nos importan ──────────────
// oficial / blue (paralelo)

/**
 * Fetcha de las 3 fuentes en paralelo y promedia.
 * Si alguna falla la ignora silenciosamente.
 */
export async function fetchDollarRates() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;

  const [r1, r2, r3] = await Promise.allSettled([
    _fetchDolarAPI(),
    _fetchAmbito(),
    _fetchBluelytics(),
  ]);

  const results = [r1, r2, r3]
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (!results.length) return _cache ?? null;

  // Promediar valores de fuentes disponibles
  const avg = (vals) => {
    const valid = vals.filter(v => v > 0);
    if (!valid.length) return null;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  };

  const oficialBuys  = results.map(r => r.oficial?.buy).filter(Boolean);
  const oficialSells = results.map(r => r.oficial?.sell).filter(Boolean);
  const blueBuys     = results.map(r => r.blue?.buy).filter(Boolean);
  const blueSells    = results.map(r => r.blue?.sell).filter(Boolean);

  const rates = {
    oficial: {
      buy:  avg(oficialBuys),
      sell: avg(oficialSells),
    },
    blue: {
      buy:  avg(blueBuys),
      sell: avg(blueSells),
    },
    sources: results.map(r => r.source),
    updatedAt: new Date().toISOString(),
    rawSources: results,
  };

  _cache   = rates;
  _cacheTs = Date.now();
  return rates;
}

// ── Fuente 1: dolarapi.com ────────────────────────
async function _fetchDolarAPI() {
  try {
    const [of, bl] = await Promise.all([
      _get('https://dolarapi.com/v1/dolares/oficial'),
      _get('https://dolarapi.com/v1/dolares/blue'),
    ]);
    return {
      oficial: { buy: of.compra, sell: of.venta },
      blue:    bl ? { buy: bl.compra, sell: bl.venta } : null,
      source:  'dolarapi',
    };
  } catch { return null; }
}

// ── Fuente 2: Ámbito Financiero ───────────────────
async function _fetchAmbito() {
  try {
    const [of, bl] = await Promise.all([
      _get('https://mercados.ambito.com/dolar/oficial/variacion'),
      _get('https://mercados.ambito.com/dolar/informal/variacion'),
    ]);
    return {
      oficial: {
        buy:  parseFloat(of?.compra?.replace(',','.')),
        sell: parseFloat(of?.venta?.replace(',','.')),
      },
      blue: {
        buy:  parseFloat(bl?.compra?.replace(',','.')),
        sell: parseFloat(bl?.venta?.replace(',','.')),
      },
      source: 'ambito',
    };
  } catch { return null; }
}

// ── Fuente 3: bluelytics.com.ar ───────────────────
async function _fetchBluelytics() {
  try {
    const data = await _get('https://api.bluelytics.com.ar/v2/latest');
    return {
      oficial: {
        buy:  data.oficial?.value_buy,
        sell: data.oficial?.value_sell,
      },
      blue: {
        buy:  data.blue?.value_buy,
        sell: data.blue?.value_sell,
      },
      source: 'bluelytics',
    };
  } catch { return null; }
}

// ── Helper fetch con timeout ──────────────────────
async function _get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Auto-refresh ──────────────────────────────────
export function startDollarAutoRefresh(onUpdate) {
  if (_refreshId) clearInterval(_refreshId);
  _refreshId = setInterval(async () => {
    _cacheTs = 0; // forzar re-fetch
    const rates = await fetchDollarRates();
    if (rates && onUpdate) onUpdate(rates);
  }, REFRESH_EVERY);
  return _refreshId;
}

export function stopDollarAutoRefresh() {
  if (_refreshId) { clearInterval(_refreshId); _refreshId = null; }
}

export function clearDollarCache() {
  _cache   = null;
  _cacheTs = 0;
}

export function getCachedOfficialSell() {
  return _cache?.oficial?.sell ?? null;
}

/** Formatea para mostrar en el badge */
export function formatDollarBadge(rates) {
  if (!rates?.oficial?.sell) return '—';
  const sell = rates.oficial.sell;
  const blue = rates.blue?.sell;
  if (blue && blue !== sell) {
    return `OF $${sell.toLocaleString('es-AR')} · BL $${blue.toLocaleString('es-AR')}`;
  }
  return `$${sell.toLocaleString('es-AR')}`;
}
