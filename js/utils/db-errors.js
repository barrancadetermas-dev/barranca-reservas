// ══════════════════════════════════════════════════════════════
// db-errors.js — Errores de Supabase/Postgres en lenguaje claro
//
// Antes se mostraba el texto crudo ("new row for relation ... violates
// check constraint ...") o, en algunos caminos, nada. Esta función
// devuelve SIEMPRE una frase entendible y accionable.
// ══════════════════════════════════════════════════════════════

const SOURCE_LABELS = {
  direct: 'Directa', walkin: 'Espontáneo', booking: 'Booking.com', airbnb: 'Airbnb',
  family: 'Familiar / conocido', company: 'Empresa', referral: 'Referido', despegar: 'Despegar', expedia: 'Expedia',
};

/**
 * @param {any} err  error lanzado (Error, objeto de Supabase, string…)
 * @param {{source?:string}} [ctx]  datos del intento (para nombrar el canal)
 * @returns {string}
 */
export function friendlyDbError(err, ctx = {}) {
  const raw  = String(err?.message ?? err?.details ?? err ?? '').trim();
  const code = String(err?.code ?? '');
  const low  = raw.toLowerCase();

  if (!raw) return 'No se pudo guardar la reserva (error desconocido). Probá de nuevo.';

  if (low.includes('chk_booking_source') || (code === '23514' && low.includes('source'))) {
    const ch = SOURCE_LABELS[ctx.source] ?? ctx.source ?? 'elegido';
    return `La base de datos no admite el canal «${ch}». Hay que ejecutar migration_booking_source_channels.sql en Supabase (SQL Editor).`;
  }
  if (code === '23514' || low.includes('violates check constraint')) {
    const name = raw.match(/check constraint "([^"]+)"/)?.[1];
    return `La base rechazó uno de los valores cargados${name ? ` (regla «${name}»)` : ''}. Revisá los datos del formulario.`;
  }
  if (code === '23503' || low.includes('violates foreign key'))
    return 'Falta un dato relacionado (departamento o huésped inexistente). Recargá la página e intentá de nuevo.';
  if (code === '23502' || low.includes('violates not-null')) {
    const col = raw.match(/column "([^"]+)"/)?.[1];
    return `Falta un dato obligatorio${col ? ` (${col})` : ''}.`;
  }
  if (code === '23505' || low.includes('duplicate key') || low.includes('duplicate'))
    return 'Ya existe un registro con esos datos.';
  if (code === '42501' || low.includes('row-level security') || low.includes('permission denied') || low.includes('policy'))
    return 'Sin permisos para guardar. Verificá tu rol o las políticas RLS en Supabase.';
  if (low.includes('invalid input value for enum payment_method'))
    return 'Ese método de pago no existe todavía en la base: ejecutar migration_payment_method_enum.sql en Supabase.';
  if (low.includes('falta aplicar la migración') || low.includes('no se pudo guardar la cantidad')) return raw;
  if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('load failed'))
    return 'No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.';
  if (low.includes('tardó demasiado') || low.includes('timeout'))
    return 'La operación tardó demasiado. Verificá tu conexión e intentá de nuevo.';
  return raw;
}
