// ═══════════════════════════════════════════════════
// whatsapp-service.js v3.1
// Vouchers WhatsApp: huésped + encargada
// ═══════════════════════════════════════════════════

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

  const unitsText = (booking.booking_units ?? [])
    .map(bu => unitLabel(bu.units))
    .join(' / ');

  const totalPaid = payments.reduce((s, p) => s + (p.amount_ars ?? p.amount ?? 0), 0);
  const balance   = (booking.total_amount ?? 0) - totalPaid;

  const fmtDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—';
  const fmt = (n) => `$${Math.round(n ?? 0).toLocaleString('es-AR')}`;

  return [
    `*COMPROBANTE DE RESERVA*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `*DATOS DEL HUÉSPED*`,
    `- Huésped: *${guest?.first_name ?? ''} ${guest?.last_name ?? ''}*`,
    guest?.dni   ? `- DNI: ${guest.dni}`     : null,
    guest?.phone ? `- Tel: ${guest.phone}`   : null,
    `- Depto: *${unitsText || '—'}*`,
    `- Check-in: _${fmtDate(booking.check_in)}_`,
    `- Check-out: _${fmtDate(booking.check_out)}_`,
    `- Noches: *${booking.nights ?? '—'}*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `*DETALLE DE PAGO*`,
    `- Precio por noche: ${fmt(booking.price_per_night)}`,
    `- Total: *${fmt(booking.total_amount)}*`,
    `- Abonado: ${fmt(totalPaid)}`,
    balance > 0 ? `- Saldo: *${fmt(balance)}*` : `- ✅ *Sin saldo pendiente*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `${STATUS_LABELS[booking.status] ?? booking.status}`,
    ``,
    `_Muchas gracias por elegirnos_`,
    `_*${hotelName}*_🏡`,
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
