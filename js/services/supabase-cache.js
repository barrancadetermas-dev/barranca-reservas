// ═══════════════════════════════════════════════════
// supabase-cache.js — Cache en memoria para queries
// TTL configurable · Invalidación por tabla
// Reduce queries al navegar atrás/adelante en el calendario
// ═══════════════════════════════════════════════════

class SupabaseCache {
  constructor(defaultTtlMs = 30_000) {
    this._store      = new Map();
    this._defaultTtl = defaultTtlMs;
    this._hits       = 0;
    this._misses     = 0;
  }

  _key(table, params) {
    return `${table}::${JSON.stringify(params)}`;
  }

  /** Leer del cache. null si no existe o expiró. */
  get(table, params) {
    const key   = this._key(table, params);
    const entry = this._store.get(key);
    if (!entry) { this._misses++; return null; }
    if (Date.now() - entry.ts > entry.ttl) {
      this._store.delete(key);
      this._misses++;
      return null;
    }
    this._hits++;
    return entry.data;
  }

  /** Guardar en cache con TTL opcional. */
  set(table, params, data, ttlMs) {
    const key = this._key(table, params);
    this._store.set(key, {
      data,
      ts:  Date.now(),
      ttl: ttlMs ?? this._defaultTtl,
    });
  }

  /** Invalidar todas las entradas de una tabla. */
  invalidate(...tables) {
    tables.forEach(table => {
      for (const key of this._store.keys()) {
        if (key.startsWith(`${table}::`)) this._store.delete(key);
      }
    });
  }

  /** Vaciar todo el cache (logout, cambio de hotel). */
  clear() {
    this._store.clear();
    this._hits   = 0;
    this._misses = 0;
  }

  get stats() {
    const total = this._hits + this._misses;
    return {
      hits:     this._hits,
      misses:   this._misses,
      hitRate:  total ? Math.round((this._hits / total) * 100) + '%' : '—',
      size:     this._store.size,
    };
  }
}

/** Instancia global compartida */
export const cache = new SupabaseCache(30_000);

/**
 * Helper: ejecuta una query Supabase con cache automático.
 *
 * @example
 * const bookings = await cachedQuery(
 *   supabase,
 *   'bookings',
 *   { month: '2025-06' },
 *   () => supabase.from('bookings').select(...).eq(...).lte(...)
 * );
 */
export async function cachedQuery(supabase, table, params, queryFn, ttlMs) {
  const cached = cache.get(table, params);
  if (cached !== null) return cached;

  const { data, error } = await queryFn();
  if (error) throw error;
  cache.set(table, params, data ?? [], ttlMs);
  return data ?? [];
}
