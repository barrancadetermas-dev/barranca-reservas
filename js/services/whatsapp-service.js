// ═══════════════════════════════════════════════════
// whatsapp-service.js v3.1
// Vouchers WhatsApp: huésped + encargada
// ═══════════════════════════════════════════════════

import { SOURCE_CONFIG } from '../supabase-config.js';

const PAYMENT_METHOD_LABELS = {
  cash:        'Efectivo',
  transfer:    'Transferencia',
  mercadopago: 'MercadoPago',
  naranjax:    'Naranja X',
  uala:        'Ualá',
  credit_card: 'Tarjeta de Crédito',
};

const STATUS_LABELS = {
  pending:   '⏳ Sin seña / Pendiente',
  partial:   '🔶 Con seña / Depósito recibido',
  paid:      '✅ Totalmente pagado',
  cancelled: '❌ Cancelado',
  blocked:   '🔒 Bloqueado',
};

function unitLabel(unit) {
  if (!unit) return '—';
  const num  = unit.sort_order ?? '?';
  const name = unit.name ?? 'Unidad';
  return `#${num} · ${name}`;
}

export function openWhatsAppVoucher(booking, ctx) {
  const text    = generateVoucherText(booking, ctx);
  const phone   = booking.guests?.phone ?? '';
  const cleaned = phone.replace(/\D/g, '');
  const url = cleaned
    ? `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function generateVoucherText(booking, ctx) {
  const hotelName = ctx?.hotel?.name ?? 'Barranca de Termas';
  const guest     = booking.guests;
  const payments  = booking.payments ?? [];
  const source    = booking.source ?? 'direct';
  const srcCfg    = SOURCE_CONFIG[source];

  const unitsText = (booking.booking_units ?? [])
    .map(bu => unitLabel(bu.units))
    .join('\n         ');

  const totalPaid = payments.reduce((s, p) => s + (p.amount_ars ?? p.amount ?? 0), 0);
  const balance   = (booking.total_amount ?? 0) - totalPaid;

  const fmtDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—';
  const fmt = (n) => `$${Math.round(n ?? 0).toLocaleString('es-AR')}`;

  const payLines = payments.map(p => {
    const method = PAYMENT_METHOD_LABELS[p.method] ?? p.method ?? '—';
    const amount = p.currency === 'USD'
      ? `USD ${p.amount} (@ $${p.exchange_rate}) = ${fmt(p.amount_ars)}`
      : fmt(p.amount_ars ?? p.amount);
    return `   • ${method}: ${amount}`;
  }).join('\n');

  return [
    `🏨 *${hotelName}*`,
    `📋 COMPROBANTE DE RESERVA`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `👤 *Huésped:*  ${guest?.first_name ?? ''} ${guest?.last_name ?? ''}`,
    guest?.dni   ? `🪪 *DNI:*      ${guest.dni}`  : null,
    guest?.phone ? `📱 *Tel:*      ${guest.phone}` : null,
    guest?.email ? `✉️ *Email:*    ${guest.email}` : null,
    ``,
    `🛏️ *Departamento:*`,
    `   ${unitsText}`,
    ``,
    `📅 *Check-in:*   ${fmtDate(booking.check_in)}`,
    `📅 *Check-out:*  ${fmtDate(booking.check_out)}`,
    `🌙 *Noches:*     ${booking.nights ?? '—'}`,
    srcCfg && source !== 'direct'
      ? `${srcCfg.emoji ?? '📌'} *Canal:*      ${srcCfg.label}` : null,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 *DETALLE FINANCIERO*`,
    ``,
    `Precio por noche: ${fmt(booking.price_per_night)}`,
    `Subtotal base:    ${fmt((booking.nights ?? 0) * (booking.price_per_night ?? 0))}`,
    (booking.free_nights ?? 0) > 0
      ? `Noches sin cargo (${booking.free_nights}): -${fmt(booking.free_nights * (booking.price_per_night ?? 0))}` : null,
    (booking.discount_pct ?? 0) > 0
      ? `Descuento ${booking.discount_pct}%: -${fmt(((booking.nights ?? 0) * (booking.price_per_night ?? 0)) * booking.discount_pct / 100)}` : null,
    (booking.surcharge_amount ?? 0) > 0
      ? `Recargo fijo: +${fmt(booking.surcharge_amount)}` : null,
    ``,
    `*TOTAL:        ${fmt(booking.total_amount)}*`,
    ``,
    payments.length ? `Pagos registrados:\n${payLines}` : null,
    ``,
    `*Abonado:      ${fmt(totalPaid)}*`,
    balance > 0
      ? `*Saldo:        ${fmt(balance)}*`
      : `*✅ Sin saldo pendiente*`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `📌 *Estado:* ${STATUS_LABELS[booking.status] ?? booking.status}`,
    booking.notes ? `\n💬 *Obs:* ${booking.notes}` : null,
    ``,
    `Muchas gracias por elegirnos 🌿`,
    `_${hotelName}_`,
  ].filter(Boolean).join('\n');
}

export function openManagerTemplate(booking, ctx) {
  const modal    = document.getElementById('overlay-whatsapp');
  const textarea = document.getElementById('wa-template-text');
  if (!modal || !textarea) return;
  textarea.value = generateManagerText(booking, ctx);
  modal.classList.remove('hidden');
  setTimeout(() => { textarea.focus(); textarea.select(); }, 100);
}

export function generateManagerText(booking, ctx) {
  const g        = booking.guests ?? {};
  const apellido = g.last_name  ?? '';
  const nombre   = g.first_name ?? '';
  const fullName = [apellido, nombre].filter(Boolean).join(', ') || '—';

  const units = (booking.booking_units ?? [])
    .map(bu => bu.units?.sort_order ? `#${bu.units.sort_order}` : (bu.units?.name ?? ''))
    .filter(Boolean).join(' / ') || '—';

  const fmt = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  const saldo = booking.balance
    ?? (booking.total_amount ?? 0) - (booking.total_paid ?? 0);
  const saldoFmt = saldo > 0
    ? `$${Math.round(saldo).toLocaleString('es-AR')}`
    : 'Sin saldo pendiente';

  return [
    `*Nueva Reserva* 🧾`,
    ``,
    `- Apellido y Nombre: *${fullName}*`,
    `- Apartamento n°: ${units}`,
    `- Fecha Ingreso: ${fmt(booking.check_in)}`,
    `- Fecha Salida: ${fmt(booking.check_out)}`,
    `- Noches: ${booking.nights ?? '—'}`,
    `- Cant de Pers: ${booking.pax ?? ''}${booking.adults
      ? ` (${booking.adults} adultos${booking.children ? `, ${booking.children} menores` : ''})`
      : ''}`,
    ``,
    `Abonan al ingreso $: ${saldo > 0 ? saldoFmt : '✅ Pagado'}`,
    ``,
    `_Nota_: ${booking.notes ?? ''}`,
  ].join('\n');
}
