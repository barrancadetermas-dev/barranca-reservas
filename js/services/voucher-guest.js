// ══════════════════════════════════════════════════════════════
// voucher-guest.js — Voucher/comprobante de reserva para el huésped
// (botón "Voucher" de cada reserva en la lista). El diseño vive en
// voucher-template.js: acá solo se traduce la reserva de la base al
// formato de la plantilla.
// ══════════════════════════════════════════════════════════════

import { AppContext, showToast } from '../supabase-config.js';
import {
  openVoucherWindow, buildMoneyLines, paxLabel, mapPayments, CHANNEL_LABELS,
} from './voucher-template.js';
import { getSegments, isSplit } from './stay-segments.js';

/**
 * Abre el voucher listo para imprimir / guardar como PDF.
 * @param {object} booking — reserva con guests, booking_units, payments
 * @param {object} hotel   — { name, address, phone, email }
 */
export function openGuestVoucher(booking, hotel = {}) {
  const g       = booking.guests ?? {};
  // Cambio de departamento: tramos en orden cronológico (una sola reserva)
  const split   = isSplit(booking);
  const segs    = split ? getSegments(booking).map(s => ({
    unitName: s.unit?.name ?? '—', from: s.from, to: s.to, nights: s.nights, pricePerNight: s.pricePerNight,
  })) : [];
  const units   = (split ? segs.map(s => s.unitName) : (booking.booking_units ?? []).map(bu => bu.units?.name ?? '—'));
  const total   = Number(booking.total_amount) || 0;
  const paid    = Number(booking.total_paid)   || 0;
  const cfg     = AppContext?.config ?? {};
  const { lines } = buildMoneyLines(booking, segs);

  const win = openVoucherWindow({
    hotel,
    reservationCode: booking.id ? String(booking.id).slice(0, 8).toUpperCase() : null,
    guest: {
      fullName: [g.last_name, g.first_name].filter(Boolean).join(', ') || 'Huésped',
      dni: g.dni, phone: g.phone, email: g.email,
    },
    stay: {
      checkIn: booking.check_in, checkOut: booking.check_out, nights: booking.nights,
      checkInTime: cfg.checkin_time, checkOutTime: cfg.checkout_time,
      units: units.join(split ? ' → ' : ' / '),
      segments: segs,
      paxLabel: paxLabel(booking),
      channel: CHANNEL_LABELS[booking.source] ?? booking.source ?? 'Directo',
    },
    money: {
      lines, total, paid,
      balance: Math.max(0, total - paid),
      payments: mapPayments(booking.payments),
    },
    notes: booking.notes,
  });
  if (!win) showToast('Permití ventanas emergentes para descargar el voucher', 'warning');
  return win;
}
