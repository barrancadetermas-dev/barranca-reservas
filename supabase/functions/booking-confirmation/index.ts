// ═══════════════════════════════════════════════════
// booking-confirmation/index.ts
// Envía email de confirmación al huésped y al admin
// Invocar con: supabase.functions.invoke('booking-confirmation', { body: { bookingId } })
// ═══════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPA_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('MILA_FROM_EMAIL') ?? 'noreply@milasistema.com';

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {
  weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
});

serve(async (req) => {
  try {
    const { bookingId } = await req.json();
    if (!bookingId) return new Response('Missing bookingId', { status: 400 });

    const db = createClient(SUPA_URL, SUPA_KEY);

    // Fetch reserva completa
    const { data: booking, error } = await db
      .from('bookings')
      .select(`
        id, check_in, check_out, nights, total_amount, total_paid, balance,
        status, source, price_per_night, notes,
        guests!bookings_guest_id_fkey(first_name, last_name, email, phone),
        booking_units(units(name, sort_order, color)),
        hotel:hotel_id(name, id)
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) return new Response('Booking not found', { status: 404 });

    const g        = booking.guests ?? {};
    const guestName= `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim();
    const units    = (booking.booking_units ?? []).map((bu: any) => bu.units?.name).filter(Boolean).join(', ');
    const hotelName= (booking.hotel as any)?.name ?? 'Barranca de Termas';
    const nights   = booking.nights ?? 0;
    const total    = booking.total_amount ?? 0;
    const paid     = booking.total_paid ?? 0;
    const balance  = booking.balance ?? (total - paid);
    const statusLabel: Record<string,string> = { pending:'Sin seña', partial:'Con seña', paid:'Saldado' };
    const status   = statusLabel[booking.status] ?? booking.status;

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f8fafc;margin:0;padding:24px}
  .wrap{max-width:540px;margin:0 auto}
  .header{background:#6366f1;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:1.3rem}
  .header p{color:#c7d2fe;margin:6px 0 0;font-size:.85rem}
  .body{background:#fff;padding:28px 32px;border-radius:0 0 16px 16px}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:.88rem}
  .row:last-child{border-bottom:none}
  .lbl{color:#64748b}
  .val{font-weight:600;color:#0f172a}
  .total-box{background:#f0fdf4;border-radius:10px;padding:14px 18px;margin:18px 0}
  .bal-box{background:#fff7ed;border-radius:10px;padding:14px 18px;margin:10px 0}
  .foot{text-align:center;color:#94a3b8;font-size:.72rem;margin-top:20px}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>✅ Reserva confirmada</h1>
    <p>${hotelName}</p>
  </div>
  <div class="body">
    <p style="font-size:.95rem;margin:0 0 20px">Hola <strong>${guestName}</strong>, tu reserva fue registrada correctamente.</p>
    <div class="row"><span class="lbl">Departamento</span><span class="val">${units}</span></div>
    <div class="row"><span class="lbl">Check-in</span><span class="val">${fmtDate(booking.check_in)}</span></div>
    <div class="row"><span class="lbl">Check-out</span><span class="val">${fmtDate(booking.check_out)}</span></div>
    <div class="row"><span class="lbl">Duración</span><span class="val">${nights} noche${nights!==1?'s':''}</span></div>
    <div class="row"><span class="lbl">Estado de pago</span><span class="val">${status}</span></div>
    <div class="total-box">
      <div style="font-size:.72rem;color:#64748b;margin-bottom:4px;text-transform:uppercase;font-weight:600">Total</div>
      <div style="font-size:1.4rem;font-weight:800;color:#0f172a">${fmt(total)}</div>
    </div>
    ${balance > 0 ? `<div class="bal-box">
      <div style="font-size:.72rem;color:#f97316;margin-bottom:4px;font-weight:600">SALDO PENDIENTE</div>
      <div style="font-size:1.1rem;font-weight:700;color:#f97316">${fmt(balance)}</div>
    </div>` : ''}
    ${booking.notes ? `<div style="background:#f8fafc;border-radius:8px;padding:12px 16px;font-size:.83rem;color:#475569;margin-top:12px">
      <strong>Notas:</strong> ${booking.notes}
    </div>` : ''}
    <p style="font-size:.78rem;color:#64748b;margin:20px 0 0;border-top:1px solid #f1f5f9;padding-top:14px">
      Para consultas, respondé este email o contactanos directamente.<br>
      Código de reserva: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.82rem">${String(bookingId).slice(0,8).toUpperCase()}</code>
    </p>
  </div>
  <div class="foot">${hotelName} · Sistema MILA</div>
</div></body></html>`;

    const results: any[] = [];

    // Email al huésped
    if (g.email) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [g.email],
          subject: `✅ Reserva confirmada — ${hotelName} (${booking.check_in})`,
          html,
        }),
      });
      results.push({ to: 'guest', ok: r.ok, status: r.status });
    }

    // Email al admin del hotel
    const { data: admins } = await db
      .from('hotel_users')
      .select('users(email)')
      .eq('hotel_id', (booking.hotel as any)?.id)
      .in('role', ['admin','owner']);

    const adminEmails = (admins ?? []).map((a: any) => a.users?.email).filter(Boolean);
    if (adminEmails.length) {
      const adminHtml = html.replace('Hola <strong>'+guestName+'</strong>, tu reserva fue registrada correctamente.',
        `<strong>Nueva reserva registrada</strong> para <strong>${guestName}</strong>.${g.phone ? ` Tel: ${g.phone}` : ''}`);
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL, to: adminEmails,
          subject: `📋 Nueva reserva: ${guestName} — ${booking.check_in}`,
          html: adminHtml,
        }),
      });
      results.push({ to: 'admin', ok: r.ok, status: r.status });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
