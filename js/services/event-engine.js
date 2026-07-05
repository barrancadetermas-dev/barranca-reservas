// ═══════════════════════════════════════════════════
// event-engine.js — Motor de Eventos centralizado
//
// Ninguna pantalla (Reservas, Calendario, Formulario, etc.)
// sabe que esto existe ni lo llama. Este motor escucha los
// cambios reales en la base de datos (Supabase Realtime) y
// arma la notificación correspondiente solo. Las pantallas
// siguen haciendo exactamente lo mismo que hacían antes —
// guardar, editar, borrar — sin ningún cambio en su lógica.
//
// Si el día de mañana se agrega una pantalla nueva que
// también crea/edita reservas o pagos, las notificaciones
// para esa pantalla nueva funcionan automáticamente, sin
// tocar ni una línea de este archivo ni de la pantalla nueva.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';
import { AppContext } from '../supabase-config.js';

let _supabase = null;
let _channel  = null;
const _guestNameCache = new Map(); // guest_id -> "Nombre Apellido" (evita re-consultar siempre el mismo huésped)

function _unitName(unitId) {
  const u = AppContext.units?.find(x => String(x.id) === String(unitId));
  return u?.name ?? 'una unidad';
}

function _fmtDMY(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
}

async function _guestName(guestId) {
  if (!guestId) return 'Huésped';
  if (_guestNameCache.has(guestId)) return _guestNameCache.get(guestId);
  try {
    const { data } = await _supabase.from('guests').select('first_name, last_name').eq('id', guestId).single();
    const name = data ? `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() : 'Huésped';
    _guestNameCache.set(guestId, name);
    return name;
  } catch { return 'Huésped'; }
}

// ── Interpretar un cambio en "bookings" ──
async function _handleBookingChange(payload) {
  const { eventType, new: row, old: oldRow } = payload;

  // DELETE físico de la fila (poco común — normalmente se cancela con
  // status, no se borra — pero si pasa, avisamos igual)
  if (eventType === 'DELETE') {
    const unitId = oldRow?.id; // no siempre viene booking_units en el payload de bookings
    const guest = await _guestName(oldRow?.guest_id);
    addNotification({
      type: 'booking_deleted', category: 'reservas', icon: '🗑️', color: '#EF4444',
      title: '❌ Reserva eliminada',
      message: `${guest}\n📅 ${_fmtDMY(oldRow?.check_in)} → ${_fmtDMY(oldRow?.check_out)}`,
      data: { bookingId: oldRow?.id },
    });
    return;
  }

  if (eventType === 'INSERT') {
    if (row.status === 'blocked') {
      addNotification({
        type: 'block_created', category: 'sistema', icon: '🚫', color: '#F59E0B',
        title: '🚫 Bloqueo creado',
        message: `📅 ${_fmtDMY(row.check_in)} → ${_fmtDMY(row.check_out)}`,
        data: { bookingId: row.id },
      });
      return;
    }
    const guest = await _guestName(row.guest_id);
    addNotification({
      type: 'booking_created', category: 'reservas', icon: '🏠', color: '#3B82F6',
      title: '🏠 Nueva reserva registrada',
      message: `👤 ${guest}\n📅 ${_fmtDMY(row.check_in)} → ${_fmtDMY(row.check_out)}\n👥 ${row.pax ?? '—'} huésped${row.pax !== 1 ? 'es' : ''}\n💲 Total: $${Math.round(row.total_amount ?? 0).toLocaleString('es-AR')}`,
      data: { bookingId: row.id },
    });
    return;
  }

  if (eventType === 'UPDATE') {
    const guest = await _guestName(row.guest_id);

    // Bloqueo borrado (pasó a cancelado desde 'blocked')
    if (oldRow?.status === 'blocked' && row.status === 'cancelled') {
      addNotification({
        type: 'block_removed', category: 'sistema', icon: '🗑️', color: '#94A3B8',
        title: '🗑 Bloqueo eliminado',
        message: `📅 ${_fmtDMY(row.check_in)} → ${_fmtDMY(row.check_out)}`,
        data: { bookingId: row.id },
      });
      return;
    }

    // Cancelación real (No vino / Reprogramar) — se trata como "eliminada"
    // porque para el usuario, esa reserva dejó de existir como tal.
    if (oldRow?.status !== 'cancelled' && row.status === 'cancelled') {
      addNotification({
        type: 'booking_cancelled', category: 'reservas', icon: '❌', color: '#EF4444',
        title: '❌ Reserva eliminada',
        message: `${_unitName(row.booking_units?.[0]?.unit_id)}\n${guest}\n📅 ${_fmtDMY(row.check_in)} → ${_fmtDMY(row.check_out)}`,
        data: { bookingId: row.id },
      });
      return;
    }

    // Check-in
    if (!oldRow?.checked_in_at && row.checked_in_at) {
      addNotification({
        type: 'checkin', category: 'reservas', icon: '🚪', color: '#22C55E',
        title: '🚪 Check-in realizado',
        message: `${guest}\n📅 ${_fmtDMY(row.check_in)}`,
        data: { bookingId: row.id },
      });
      return;
    }

    // Check-out — también implica "depto liberado"
    if (!oldRow?.checked_out_at && row.checked_out_at) {
      addNotification({
        type: 'checkout', category: 'reservas', icon: '🔑', color: '#3B82F6',
        title: '🔑 Check-out realizado',
        message: `${guest}\n📅 ${_fmtDMY(row.check_out)}`,
        data: { bookingId: row.id },
      });
      addNotification({
        type: 'unit_freed', category: 'sistema', icon: '🧹', color: '#10B981',
        title: '🧹 Departamento liberado',
        message: `${_unitName(row.booking_units?.[0]?.unit_id)} — listo para el próximo huésped`,
        data: { bookingId: row.id },
      });
      return;
    }

    // Cambio de fechas — "disponibilidad" cambió para esa unidad
    if (oldRow?.check_in !== row.check_in || oldRow?.check_out !== row.check_out) {
      addNotification({
        type: 'availability_change', category: 'sistema', icon: '📅', color: '#8B5CF6',
        title: '📅 Cambio de disponibilidad',
        message: `${guest}\n${_fmtDMY(oldRow?.check_in)}→${_fmtDMY(oldRow?.check_out)} pasó a ${_fmtDMY(row.check_in)}→${_fmtDMY(row.check_out)}`,
        data: { bookingId: row.id },
      });
      return;
    }

    // Cualquier otro cambio de la reserva — edición genérica
    addNotification({
      type: 'booking_edited', category: 'reservas', icon: '✏️', color: '#F59E0B',
      title: '✏️ Reserva editada',
      message: `${guest} — ${_unitName(row.booking_units?.[0]?.unit_id)}`,
      data: { bookingId: row.id },
    });
  }
}

// ── Interpretar un cambio en "payments" ──
async function _handlePaymentChange(payload) {
  const { eventType, new: row } = payload;
  if (eventType !== 'INSERT' && eventType !== 'UPDATE') return;

  const methodLabels = {
    cash: 'Efectivo', transfer: 'Transferencia', mercadopago: 'MercadoPago',
    naranjax: 'Naranja X', uala: 'Ualá', credit_card: 'Tarjeta de Crédito',
    debit_card: 'Tarjeta de Débito', credit_note: 'Nota de Crédito',
  };
  const methodLabel = methodLabels[row.method] ?? row.method;
  const amount = Math.round(row.amount_ars ?? row.amount ?? 0);

  let guestName = 'Huésped';
  try {
    const { data: booking } = await _supabase.from('bookings').select('guest_id').eq('id', row.booking_id).single();
    if (booking?.guest_id) guestName = await _guestName(booking.guest_id);
  } catch { /* no crítico — se muestra "Huésped" genérico */ }

  if (eventType === 'INSERT') {
    addNotification({
      type: 'payment_registered', category: 'reservas', icon: '💲', color: '#22C55E',
      title: '💲 Pago registrado',
      message: `Reserva de ${guestName}\nImporte: $${amount.toLocaleString('es-AR')}\nMétodo: ${methodLabel}`,
      data: { bookingId: row.booking_id },
    });
  } else {
    addNotification({
      type: 'payment_updated', category: 'reservas', icon: '💰', color: '#F59E0B',
      title: '💰 Pago actualizado',
      message: `Reserva de ${guestName}\nImporte: $${amount.toLocaleString('es-AR')}\nMétodo: ${methodLabel}`,
      data: { bookingId: row.booking_id },
    });
  }
}

/**
 * Inicia el motor — llamar UNA vez al arrancar la app, después de que
 * AppContext.hotelId ya esté disponible. A partir de acá, todo lo que
 * pase en "bookings" y "payments" para este hotel genera notificaciones
 * solo, sin que ninguna pantalla tenga que llamar nada.
 */
export function initEventEngine(supabase, hotelId) {
  if (_channel) return; // ya está corriendo, no duplicar la suscripción
  _supabase = supabase;

  _channel = supabase
    .channel(`mila-event-engine-${hotelId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'bookings', filter: `hotel_id=eq.${hotelId}` },
      (payload) => { _handleBookingChange(payload).catch(err => console.warn('[EventEngine] booking:', err?.message ?? err)); }
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'payments', filter: `hotel_id=eq.${hotelId}` },
      (payload) => { _handlePaymentChange(payload).catch(err => console.warn('[EventEngine] payment:', err?.message ?? err)); }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('[EventEngine] no se pudo conectar a Realtime — las notificaciones automáticas no van a funcionar hasta que se resuelva.');
    });
}

export function stopEventEngine() {
  if (_channel) { _supabase?.removeChannel(_channel); _channel = null; }
}
