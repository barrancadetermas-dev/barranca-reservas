// ═══════════════════════════════════════════════════
// reservas-notifications.js — Avisos proactivos sobre
// reservas propias de MILA (no dependen de ninguna API
// externa, son datos de tu propia base).
//
// Por ahora: "llegada de mañana sin seña" — un chequeo
// una vez al día que te avisa si alguien que llega mañana
// todavía no pagó nada, para que tengas margen de llamarlo
// antes de que aparezca.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY = 'mila_reservas_notif_lastrun';

export async function checkTomorrowArrivalsWithoutDeposit(supabase, hotelId) {
  if (!supabase || !hotelId) return;
  const todayISO = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(LASTRUN_KEY) === todayISO) return; // ya se revisó hoy

  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('bookings')
      .select('id, total_paid, guests!bookings_guest_id_fkey(first_name, last_name), booking_units(units(name))')
      .eq('hotel_id', hotelId)
      .eq('check_in', tomorrowISO)
      .not('status', 'in', '(cancelled,blocked)')
      .eq('total_paid', 0);

    if (error) throw error;

    (data ?? []).forEach(b => {
      const guestName = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : 'Huésped';
      const unitNames = (b.booking_units ?? []).map(bu => bu.units?.name).filter(Boolean).join(', ') || '—';
      addNotification({
        type: 'arrival_no_deposit', category: 'reservas', icon: '⚠️', color: '#F59E0B',
        title: 'Llega mañana sin seña',
        message: `${guestName} — ${unitNames}\nTodavía no registra ningún pago.`,
        data: { bookingId: b.id },
      });
    });

    localStorage.setItem(LASTRUN_KEY, todayISO);
  } catch (err) {
    console.warn('[Reservas] no se pudo revisar llegadas de mañana:', err?.message ?? err);
  }
}
