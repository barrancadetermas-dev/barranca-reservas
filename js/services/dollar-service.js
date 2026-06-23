/**
 * MILA PMS — Dollar Service
 * Servicio centralizado de cotización del dólar oficial.
 *
 * Fuentes (en orden de prioridad):
 *   1. DolarApi.com   → BNA oficial
 *   2. ArgentinaDatos → BCR / BCRA
 *   3. Ámbito         → dólar oficial de mercado
 *
 * Exporta: dollarService (singleton)
 * Uso:
 *   import { dollarService } from './services/dollar-service.js';
 *   const rate = await dollarService.getRate();
 *   // rate.buy   → promedio compra
 *   // rate.sell  → promedio venta
 *   // rate.official → VALOR OFICIAL USADO POR CALCULADORA (promedio compra)
 */

const CACHE_KEY    = 'mila_dollar_v2';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

// ─── Definición de fuentes ────────────────────────────────────────────────────
const SOURCES = [
  {
    id: 'dolarapi',
    label: 'DolarApi (BNA)',
    url: 'https://dolarapi.com/v1/dolares/oficial',
    /** @param {object} data */
    parse(data) {
      if (!data?.compra || !data?.venta) throw new Error('Respuesta inesperada');
      return { buy: Number(data.compra), sell: Number(data.venta) };
    },
  },
  {
    id: 'argentinadatos',
    label: 'ArgentinaDatos',
    url: 'https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial',
    parse(data) {
      const arr   = Array.isArray(data) ? data : [data];
      const last  = arr[arr.length - 1];
      if (!last?.compra || !last?.venta) throw new Error('Respuesta inesperada');
      return { buy: Number(last.compra), sell: Number(last.venta) };
    },
  },
  {
    id: 'ambito',
    label: 'Ámbito',
    url: 'https://mercados.ambito.com//dolar/oficial/variacion',
    parse(data) {
      const buy  = parseFloat(String(data?.compra  || '').replace(',', '.'));
      const sell = parseFloat(String(data?.venta   || '').replace(',', '.'));
      if (isNaN(buy) || isNaN(sell)) throw new Error('Respuesta inesperada');
      return { buy, sell };
    },
  },
];

// ─── Clase DollarService ──────────────────────────────────────────────────────
class DollarService {
  constructor() {
    /** @type {Set<Function>} */
    this._listeners  = new Set();
    this._inFlight   = null; // Promise activa (evita dobles fetches simultáneos)
    this._lastResult = null; // Resultado en memoria para acceso síncrono
  }

  // ── API pública ─────────────────────────────────────────────────────────────

  /**
   * Retorna la cotización actual.
   * Usa caché de sessionStorage (30 min).
   * @returns {Promise<DollarRate>}
   */
  async getRate() {
    const cached = this._readCache();
    if (cached) {
      this._lastResult = cached;
      return cached;
    }
    // Evitar múltiples fetches paralelos
    if (!this._inFlight) {
      this._inFlight = this._fetchAll().finally(() => { this._inFlight = null; });
    }
    const result = await this._inFlight;
    this._lastResult = result;
    return result;
  }

  /**
   * Valor oficial usado por la calculadora: promedio compra.
   * @returns {Promise<number>}
   */
  async getOfficialRate() {
    const rate = await this.getRate();
    return rate.official;
  }

  /**
   * Último resultado conocido sin esperar (puede ser null al inicio).
   * @returns {DollarRate|null}
   */
  getCachedRate() {
    return this._lastResult ?? this._readCache();
  }

  /**
   * Fuerza actualización ignorando caché.
   * @returns {Promise<DollarRate>}
   */
  async refresh() {
    this._clearCache();
    return this.getRate();
  }

  /**
   * Suscribe un listener que se llama cada vez que hay nueva cotización.
   * @param {function(DollarRate): void} fn
   * @returns {function} unsuscribe
   */
  subscribe(fn) {
    this._listeners.add(fn);
    // Si ya hay resultado, notificar inmediatamente
    const cached = this.getCachedRate();
    if (cached) setTimeout(() => fn(cached), 0);
    return () => this._listeners.delete(fn);
  }

  // ── Internos ─────────────────────────────────────────────────────────────────

  async _fetchAll() {
    const successes = [];
    const errors    = [];

    await Promise.allSettled(
      SOURCES.map(async (src) => {
        try {
          const res = await fetch(src.url, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json   = await res.json();
          const parsed = src.parse(json);
          successes.push({ ...parsed, source: src.label });
        } catch (err) {
          const msg = `[DollarService] ${src.label}: ${err.message}`;
          console.warn(msg);
          errors.push({ source: src.label, error: err.message });
        }
      })
    );

    if (successes.length === 0) {
      const fallback = this._readCacheExpired();
      if (fallback) {
        console.warn('[DollarService] Todas las fuentes fallaron. Usando caché vencida.');
        return { ...fallback, stale: true };
      }
      throw new Error('No se pudo obtener la cotización del dólar. Revisá tu conexión.');
    }

    const avg  = (key) => successes.reduce((s, r) => s + r[key], 0) / successes.length;
    const buy  = Math.round(avg('buy')  * 100) / 100;
    const sell = Math.round(avg('sell') * 100) / 100;

    /** @type {DollarRate} */
    const rate = {
      buy,
      sell,
      official:   buy,        // Promedio compra = cotización oficial del sistema
      sources:    successes.map((s) => s.source),
      failedSources: errors,
      updatedAt:  new Date().toISOString(),
      stale:      false,
    };

    this._writeCache(rate);
    this._notify(rate);
    return rate;
  }

  _notify(rate) {
    this._listeners.forEach((fn) => {
      try { fn(rate); } catch (e) { console.error('[DollarService] listener error', e); }
    });
  }

  _readCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) return null;
      return data;
    } catch { return null; }
  }

  /** Lee caché aunque esté vencida (fallback de emergencia) */
  _readCacheExpired() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw).data;
    } catch { return null; }
  }

  _writeCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch {}
  }

  _clearCache() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch {}
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const dollarService = new DollarService();

/**
 * @typedef {Object} DollarRate
 * @property {number}   buy           Promedio compra (todas las fuentes)
 * @property {number}   sell          Promedio venta
 * @property {number}   official      Valor oficial usado por el sistema (= buy)
 * @property {string[]} sources       Nombres de fuentes exitosas
 * @property {Array}    failedSources Fuentes que fallaron
 * @property {string}   updatedAt     ISO timestamp de la última actualización
 * @property {boolean}  stale         true si se usó caché vencida como fallback
 */
