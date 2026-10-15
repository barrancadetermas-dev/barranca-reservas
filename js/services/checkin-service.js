// ══════════════════════════════════════════════════════════════
// checkin-service.js — UNA sola lógica de check-in y de estado de estadía
//
// Antes el check-in estaba escrito 3 veces (Dashboard, lista de reservas y
// ficha) con reglas distintas: el Dashboard no miraba el error de la
// respuesta (mostraba "✅ Check-in" aunque la base lo rechazara), no
// controlaba permisos ni clics repetidos y no dejaba registro de auditoría.
//
// Reglas (iguales en todas las pantallas):
//  • Solo escribe `checked_in_at`. No toca pagos, saldo ni crea reservas.
//  • Es IDEMPOTENTE: la base solo lo registra si todavía no tenía check-in
//    (UPDATE … WHERE checked_in_at IS NULL). Un doble clic, un reintento o
//    dos personas a la vez no generan dos registros ni dos eventos.
//  • Se puede registrar con saldo pendiente (el estado de alojamiento es
//    independiente del estado de pago).
//  • No aplica a reservas canceladas ni a bloqueos.
// ══════════════════════════════════════════════════════════════

import { showToast } from '../supabase-config.js';
import { can, isDemo } from '../auth/permissions.js';
import { logAction } from './audit-service.js';
import { Bus, EVENTS } from './event-bus.js';

/**
 * Estado de ALOJAMIENTO de una reserva (independiente del estado de pago).
 *  upcoming         → todavía no llega la fecha de entrada
 *  pending_checkin  → ya es/pasó la fecha de entrada, sin check-in registrado, y la estadía sigue
 *  in_house         → check-in registrado y sin check-out (alojada)
 *  checked_out      → check-out registrado
 *  finished         → pasó la fecha de salida sin check-in registrado
 *  cancelled | blocked
 * @param {object} b      reserva (status, is_blocked, check_in, check_out, checked_in_at, checked_out_at)
 * @param {string} today  'YYYY-MM-DD'
 */
export function stayStatus(b, today) {
  if (!b) return 'upcoming';
  if (b.status === 'cancelled') return 'cancelled';
  if (b.status === 'blocked' || b.is_blocked) return 'blocked';
  if (b.checked_out_at) return 'checked_out';
  if (b.checked_in_at)  return 'in_house';
  if (b.check_in > today) return 'upcoming';
  if (b.check_out > today) return 'pending_checkin';
  return 'finished';
}

export const STAY_STATUS_LABELS = {
  upcoming: 'Próxima', pending_checkin: 'Ingreso pendiente', in_house: 'Alojada',
  checked_out: 'Salió', finished: 'Finalizada', cancelled: 'Cancelada', blocked: 'Bloqueo',
};

const inFlight = new Set();

/**
 * Registra el check-in de una reserva.
 * @param {object} db  cliente supabase
 * @param {string} bookingId
 * @param {{guestName?:string, unitName?:string, quiet?:boolean}} [o]
 * @returns {Promise<{ok:boolean, changed?:boolean, already?:boolean, busy?:boolean, checkedInAt?:string, error?:string}>}
 *   ok+changed → se registró ahora · ok+already → ya estaba registrado (no se duplica nada)
 */
export async function registerCheckIn(db, bookingId, { guestName = '', unitName = '', quiet = false } = {}) {
  if (!bookingId) return { ok: false, error: 'Falta la reserva' };
  if (inFlight.has(bookingId)) return { ok: false, busy: true };           // clic repetido: se ignora
  if (!can('checkInOut'))  { showToast('🔒 Sin permiso para registrar check-in', 'warning'); return { ok: false, error: 'permiso' }; }
  if (isDemo())            { showToast('🎭 No disponible en modo demo', 'warning');         return { ok: false, error: 'demo' }; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showToast('📵 Sin conexión — necesitás internet para registrar el check-in', 'warning');
    return { ok: false, error: 'offline' };
  }

  inFlight.add(bookingId);
  try {
    const now = new Date().toISOString();
    const { data, error } = await db.from('bookings')
      .update({ checked_in_at: now })
      .eq('id', bookingId)
      .is('checked_in_at', null)                     // idempotencia atómica en la base
      .not('status', 'in', '(cancelled,blocked)')
      .select('id, checked_in_at');
    if (error) throw error;

    if (data?.length) {                              // ← se registró AHORA
      logAction('CHECKIN', 'booking', bookingId, `Check-in registrado${guestName ? ' — ' + guestName : ''}`)?.catch?.(() => {});
      Bus.emit(EVENTS.CHECKIN_DONE, { bookingId, guestName, unitName });
      document.dispatchEvent(new CustomEvent('booking:changed'));
      globalThis.Sound?.checkIn?.();
      if (!quiet) showToast(`✅ Check-in registrado${guestName ? ': ' + guestName : ''}`, 'success');
      return { ok: true, changed: true, checkedInAt: now };
    }

    // Ninguna fila cambió: averiguar por qué (ya registrado, cancelada, sin permisos…)
    const { data: b } = await db.from('bookings')
      .select('status, checked_in_at').eq('id', bookingId).maybeSingle();
    if (b?.checked_in_at) {
      if (!quiet) showToast('ℹ️ Esa reserva ya tenía el check-in registrado', 'info');
      document.dispatchEvent(new CustomEvent('booking:changed'));     // refrescar pantallas desactualizadas
      return { ok: true, changed: false, already: true, checkedInAt: b.checked_in_at };
    }
    if (b?.status === 'cancelled') throw new Error('La reserva está cancelada: no se puede registrar el check-in.');
    if (b?.status === 'blocked')   throw new Error('Un bloqueo no admite check-in.');
    throw new Error('No se pudo registrar el check-in — revisá los permisos o que la reserva exista.');
  } catch (err) {
    console.error('[MILA] check-in error:', err);
    const msg = err?.message ?? String(err);
    showToast(`❌ ${msg}`, 'error', 6000);
    return { ok: false, error: msg };
  } finally {
    inFlight.delete(bookingId);
  }
}
