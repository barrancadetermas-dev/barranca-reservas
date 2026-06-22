/**
 * MILA PMS — utils/calculos.js
 * Cálculo de saldo pendiente.
 * Nombres de tabla reales: bookings, payments
 */

/**
 * Calcula el saldo pendiente de una reserva.
 * @param {Object} booking  - Objeto booking con propiedad `total_amount` o `total`
 * @param {Array}  payments - Array de pagos del booking
 * @returns {{ total, paid, refunded, balance, isPaid }}
 */
export function calcularSaldo(booking, payments = []) {
  const bid = booking.id;

  const totalPaid = payments
    .filter(p => (!bid || p.booking_id === bid) && p.payment_type !== 'refund')
    .reduce((acc, p) => acc + Number(p.amount ?? 0), 0);

  const totalRefunded = payments
    .filter(p => (!bid || p.booking_id === bid) && p.payment_type === 'refund')
    .reduce((acc, p) => acc + Number(p.amount ?? 0), 0);

  const total   = Number(booking.total_amount ?? booking.total ?? 0);
  const balance = Math.max(0, total - totalPaid + totalRefunded);

  return {
    total,
    paid:      totalPaid,
    refunded:  totalRefunded,
    balance,
    isPaid:    balance <= 0,
    // Aliases en español para compatibilidad con templates existentes
    pagado:    totalPaid,
    saldo:     balance,
    estaAlDia: balance <= 0,
  };
}

/**
 * Formatea número como moneda ARS.
 */
export function formatCurrency(n) {
  return new Intl.NumberFormat('es-AR', {
    style:                 'currency',
    currency:              'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Renderiza el bloque de saldo en el DOM.
 * Busca: #total-display, #pagado-display, #saldo-display, #saldo-badge
 */
export function renderSaldoBlock(booking, payments) {
  const { total, paid, balance, isPaid } = calcularSaldo(booking, payments);

  const setEl = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setEl('total-display',  formatCurrency(total));
  setEl('pagado-display', formatCurrency(paid));
  setEl('saldo-display',  formatCurrency(balance));

  const badge = document.getElementById('saldo-badge');
  if (badge) {
    badge.textContent = isPaid ? 'Al día ✓' : `Pendiente ${formatCurrency(balance)}`;
    badge.className   = isPaid ? 'badge badge--green' : 'badge badge--red';
  }
}

/**
 * Carga booking + payments desde Supabase y renderiza saldo.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} bookingId
 */
export async function loadAndRenderSaldo(supabase, bookingId) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*, payments(*)')
    .eq('id', bookingId)
    .single();

  if (error) {
    console.error('Error cargando booking para saldo:', error);
    return;
  }

  renderSaldoBlock(booking, booking.payments ?? []);
}
