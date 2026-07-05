// ═══════════════════════════════════════════════════
// mila-event-notifications.js — Motor de Eventos → Notificaciones
//
// ÚNICO archivo que conecta el Bus de eventos (event-bus.js)
// con el Centro de Notificaciones (notification-center.js).
// Ninguna pantalla llama addNotification() directamente —
// las pantallas solo emiten Bus.emit(EVENTS.ALGO, {datos})
// como parte de su trabajo normal (guardar, cancelar, etc.),
// y ESTE archivo, corriendo en segundo plano, se entera solo
// y arma la notificación correspondiente.
//
// Se llama una sola vez, al arrancar la app (initMilaEventNotifications).
// ═══════════════════════════════════════════════════

import { Bus, EVENTS } from './event-bus.js';
import { addNotification } from './notification-center.js';
import { formatARS } from '../supabase-config.js';

const fmtDMY = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
};

const METHOD_LABELS = {
  cash: 'Efectivo', transfer: 'Transferencia', mercadopago: 'MercadoPago',
  naranjax: 'Naranja X', uala: 'Ualá', credit_card: 'Tarjeta de Crédito',
  debit_card: 'Tarjeta de Débito', credit_note: 'Nota de Crédito / Voucher',
};

let _initialized = false;

export function initMilaEventNotifications() {
  if (_initialized) return; // evitar suscribirse 2 veces si algo llama esto de nuevo
  _initialized = true;

  Bus.on(EVENTS.BOOKING_CREATED, (d = {}) => {
    addNotification({
      type: 'booking_created', category: 'reservas', icon: '🏠', color: '#3B82F6',
      title: 'Nueva reserva registrada',
      message: `👤 ${d.guestName ?? '—'}\n🏡 ${d.unitNames ?? '—'}\n📅 ${fmtDMY(d.checkIn)} → ${fmtDMY(d.checkOut)}\n👥 ${d.pax ?? '—'} huésped${d.pax !== 1 ? 'es' : ''}\n💲 Total: ${formatARS(d.total ?? 0)}`,
      data: d,
    });
  });

  Bus.on(EVENTS.BOOKING_UPDATED, (d = {}) => {
    addNotification({
      type: 'booking_updated', category: 'reservas', icon: '✏️', color: '#6366F1',
      title: 'Reserva editada',
      message: `👤 ${d.guestName ?? '—'}\n🏡 ${d.unitNames ?? '—'}\n📅 ${fmtDMY(d.checkIn)} → ${fmtDMY(d.checkOut)}`,
      data: d,
    });
  });

  Bus.on(EVENTS.BOOKING_DELETED, (d = {}) => {
    addNotification({
      type: 'booking_deleted', category: 'reservas', icon: '❌', color: '#EF4444',
      title: 'Reserva eliminada',
      message: `${d.unitNames ?? '—'}\n${d.guestName ?? '—'}\n${fmtDMY(d.checkIn)} → ${fmtDMY(d.checkOut)}`,
      data: d,
    });
  });

  Bus.on(EVENTS.GUEST_DELETED, (d = {}) => {
    addNotification({
      type: 'guest_deleted', category: 'reservas', icon: '👤', color: '#6B7280',
      title: 'Huésped eliminado',
      message: d.guestName ?? '—',
      data: d,
    });
  });

  Bus.on(EVENTS.PAYMENT_REGISTERED, (d = {}) => {
    addNotification({
      type: 'payment_registered', category: 'reservas', icon: '💲', color: '#22C55E',
      title: 'Pago registrado',
      message: `Reserva de ${d.guestName ?? '—'}\nImporte: ${formatARS(d.amount ?? 0)}\nMétodo: ${METHOD_LABELS[d.method] ?? d.method ?? '—'}`,
      data: d,
    });
  });

  Bus.on(EVENTS.PAYMENT_UPDATED, (d = {}) => {
    addNotification({
      type: 'payment_updated', category: 'reservas', icon: '💰', color: '#0EA5E9',
      title: 'Pago actualizado',
      message: `Reserva de ${d.guestName ?? '—'}\nImporte: ${formatARS(d.amount ?? 0)}\nMétodo: ${METHOD_LABELS[d.method] ?? d.method ?? '—'}`,
      data: d,
    });
  });

  Bus.on(EVENTS.CHECKIN_DONE, (d = {}) => {
    addNotification({
      type: 'checkin_done', category: 'reservas', icon: '🚪', color: '#22C55E',
      title: 'Check-in realizado',
      message: d.unitName ? `${d.guestName ?? '—'} — ${d.unitName}` : (d.guestName ?? '—'),
      data: d,
    });
  });

  Bus.on(EVENTS.CHECKOUT_DONE, (d = {}) => {
    addNotification({
      type: 'checkout_done', category: 'reservas', icon: '🔑', color: '#0EA5E9',
      title: 'Check-out realizado',
      message: d.unitName ? `${d.guestName ?? '—'} — ${d.unitName}` : (d.guestName ?? '—'),
      data: d,
    });
  });

  Bus.on(EVENTS.UNIT_FREED, (d = {}) => {
    addNotification({
      type: 'unit_freed', category: 'reservas', icon: '🧹', color: '#A855F7',
      title: 'Departamento liberado',
      message: `${d.unitName ?? '—'} quedó libre${d.guestName ? ` (se fue ${d.guestName})` : ''}`,
      data: d,
    });
  });

  Bus.on(EVENTS.BLOCK_CREATED, (d = {}) => {
    addNotification({
      type: 'block_created', category: 'reservas', icon: '🚫', color: '#F59E0B',
      title: 'Bloqueo creado',
      message: `${d.unitName ?? '—'}\n${fmtDMY(d.checkIn)} → ${fmtDMY(d.checkOut)}${d.reason ? `\n${d.reason}` : ''}`,
      data: d,
    });
  });

  Bus.on(EVENTS.BLOCK_DELETED, (d = {}) => {
    addNotification({
      type: 'block_deleted', category: 'reservas', icon: '🗑', color: '#6B7280',
      title: 'Bloqueo eliminado',
      message: `${d.unitName ?? '—'}\n${fmtDMY(d.checkIn)} → ${fmtDMY(d.checkOut)}`,
      data: d,
    });
  });

  Bus.on(EVENTS.AVAILABILITY_CHANGED, (d = {}) => {
    addNotification({
      type: 'availability_changed', category: 'reservas', icon: '📅', color: '#14B8A6',
      title: 'Cambio de disponibilidad',
      message: `${d.unitName ?? '—'} — ${fmtDMY(d.checkIn)} → ${fmtDMY(d.checkOut)}`,
      data: d,
    });
  });
}
