// ══════════════════════════════════════════════════════════════
// db-compat.js — Compatibilidad con bases que aún no tienen una migración
// ══════════════════════════════════════════════════════════════

/**
 * Ejecuta una consulta pidiendo columnas OPCIONALES (ej. guests.gender).
 * Si la base todavía no las tiene (migración sin aplicar), reintenta con las
 * columnas base: la pantalla sigue funcionando en vez de quedar en blanco.
 * @param {(select:string)=>Promise<{data:any,error:any}>} run
 */
export async function queryWithOptionalColumns(run, fullSelect, baseSelect) {
  const res = await run(fullSelect);
  if (res?.error && /column|schema cache|gender/i.test(res.error.message ?? '')) {
    console.warn('[MILA] Columna opcional ausente, reintentando sin ella:', res.error.message);
    return run(baseSelect);
  }
  return res;
}

let _segmentProbe = null;
/**
 * ¿La base ya tiene las columnas de tramo de booking_units (migration_booking_segments.sql)?
 * Se consulta UNA vez y se recuerda. Devuelve el texto a agregar dentro de
 * `booking_units(unit_id, ...${SEG})`: ', segment_check_in, segment_check_out' o ''.
 * Un error de red NO se recuerda (se vuelve a probar en la próxima consulta).
 * @param {object} db cliente supabase
 * @returns {Promise<string>}
 */
export function segmentColumns(db) {
  _segmentProbe ??= Promise.resolve(db.from('booking_units').select('segment_check_in').limit(1))
    .then(r => {
      if (!r?.error) return ', segment_check_in, segment_check_out';
      if (/column|schema cache/i.test(r.error.message ?? '')) return '';
      _segmentProbe = null; return '';          // otro error (permisos, red): reintentar luego
    })
    .catch(() => { _segmentProbe = null; return ''; });
  return _segmentProbe;
}

const _colProbes = new Map();
/**
 * ¿Existe la columna `table.column`? Se consulta una vez y se recuerda
 * (un error de red no se recuerda). Devuelve el texto a sumar a un select.
 * @returns {Promise<string>} `, column` o ''
 */
export function optionalColumn(db, table, column) {
  const key = `${table}.${column}`;
  if (!_colProbes.has(key)) {
    _colProbes.set(key, Promise.resolve(db.from(table).select(column).limit(1))
      .then(r => {
        if (!r?.error) return `, ${column}`;
        if (/column|schema cache/i.test(r.error.message ?? '')) return '';
        _colProbes.delete(key); return '';
      })
      .catch(() => { _colProbes.delete(key); return ''; }));
  }
  return _colProbes.get(key);
}
/** `, gender` si la base ya tiene guests.gender, o ''. */
export const genderColumn = (db) => optionalColumn(db, 'guests', 'gender');
