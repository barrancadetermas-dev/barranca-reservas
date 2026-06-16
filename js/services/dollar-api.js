// ═══════════════════════════════════════════════════
// dollar-api.js — Cotización del Dólar Oficial (AR)
// Fuente primaria: dolarapi.com
// Fallback: bluelytics.com.ar
// Caché en memoria: 30 minutos
// ═══════════════════════════════════════════════════

let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

/**
 * Obtiene las cotizaciones del dólar.
 * @returns {{ oficial: {buy, sell}, blue: {buy, sell}, updatedAt: string } | null}
 */
export async function fetchDollarRates() {
  // Devolver caché si está vigente
  if (_cache && (Date.now() - _cacheTs) < CACHE_TTL) {
    return _cache;
  }

  // Intentar fuente primaria
  try {
    const result = await _fetchFromDolarAPI();
    if (result) {
      _cache   = result;
      _cacheTs = Date.now();
      return result;
    }
  } catch (e) {
    console.warn('[dollar-api] Fuente primaria falló, usando fallback:', e.message);
  }

  // Intentar fuente secundaria
  try {
    const result = await _fetchFromBluelytics();
    if (result) {
      _cache   = result;
      _cacheTs = Date.now();
      return result;
    }
  } catch (e) {
    console.warn('[dollar-api] Fuente secundaria también falló:', e.message);
  }

  return null;
}

/**
 * Fuente primaria: dolarapi.com
 */
async function _fetchFromDolarAPI() {
  const [oficialRes, blueRes] = await Promise.all([
    fetch('https://dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(5000) }),
    fetch('https://dolarapi.com/v1/dolares/blue',    { signal: AbortSignal.timeout(5000) }),
  ]);

  if (!oficialRes.ok) throw new Error(`dolarapi oficial HTTP ${oficialRes.status}`);

  const oficial = await oficialRes.json();
  const blue    = blueRes.ok ? await blueRes.json() : null;

  return {
    oficial: {
      buy:  oficial.compra,
      sell: oficial.venta,
    },
    blue: blue ? {
      buy:  blue.compra,
      sell: blue.venta,
    } : null,
    updatedAt: oficial.fechaActualizacion ?? new Date().toISOString(),
    source: 'dolarapi',
  };
}

/**
 * Fuente secundaria: bluelytics
 */
async function _fetchFromBluelytics() {
  const res = await fetch('https://api.bluelytics.com.ar/v2/latest', {
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`bluelytics HTTP ${res.status}`);
  const data = await res.json();

  return {
    oficial: {
      buy:  data.oficial?.value_buy,
      sell: data.oficial?.value_sell,
    },
    blue: {
      buy:  data.blue?.value_buy,
      sell: data.blue?.value_sell,
    },
    updatedAt: data.last_update ?? new Date().toISOString(),
    source: 'bluelytics',
  };
}

/**
 * Limpia el caché (útil para forzar refresh).
 */
export function clearDollarCache() {
  _cache   = null;
  _cacheTs = 0;
}

/**
 * Devuelve la cotización oficial de venta del caché si existe.
 * Útil para mostrar el tipo de cambio en formularios de pago.
 */
export function getCachedOfficialSell() {
  return _cache?.oficial?.sell ?? null;
}
