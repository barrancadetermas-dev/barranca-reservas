// supabase/functions/daily-reminders/index.ts
// ═══════════════════════════════════════════════════
// Edge Function: Recordatorios automáticos de check-in
// Se ejecuta diariamente a las 08:00 (Argentina GMT-3)
// Envía un email resumen al admin con los ingresos del día siguiente
//
// Configuración en Supabase:
//   Dashboard → Edge Functions → Schedule → "0 11 * * *" (11:00 UTC = 08:00 ARS)
//
// Variables de entorno requeridas (Supabase → Settings → Edge Functions):
//   RESEND_API_KEY   → clave de Resend (resend.com, plan gratuito = 3000 emails/mes)
//   ADMIN_EMAIL      → email del administrador donde llegan los avisos
//   HOTEL_SLUG       → 'barranca-de-termas'
// ═══════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const ADMIN_EMAIL    = Deno.env.get('ADMIN_EMAIL')!;
const HOTEL_SLUG     = Deno.env.get('HOTEL_SLUG') ?? 'barranca-de-termas';

Deno.serve(async (_req) => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];
    const todayISO    = new Date().toISOString().split('T')[0];

    // Obtener hotel
    const { data: hotel } = await supabase
      .from('hotels').select('id, name').eq('slug', HOTEL_SLUG).single();
    if (!hotel) throw new Error(`Hotel ${HOTEL_SLUG} no encontrado`);

    // Check-ins de mañana
    const { data: checkins } = await supabase
      .from('bookings')
      .select(`
        id, check_in, check_out, nights, total_amount, balance, source, status,
        guests(first_name, last_name, phone, dni),
        booking_units(units(name, sort_order))
      `)
      .eq('hotel_id', hotel.id)
      .eq('check_in', tomorrowISO)
      .not('status', 'in', '(cancelled,blocked)')
      .order('check_in');

    // Check-outs de mañana
    const { data: checkouts } = await supabase
      .from('bookings')
      .select(`
        id, check_in, check_out, nights, total_amount, balance,
        guests(first_name, last_name, phone),
        booking_units(units(name, sort_order))
      `)
      .eq('hotel_id', hotel.id)
      .eq('check_out', tomorrowISO)
      .not('status', 'in', '(cancelled,blocked)');

    // Recordatorios pendientes para hoy
    const { data: reminders } = await supabase
      .from('reminders')
      .select('*, units(name, sort_order)')
      .eq('hotel_id', hotel.id)
      .eq('scheduled_date', tomorrowISO)
      .eq('completed', false);

    // Si no hay nada relevante, no enviar email
    if (!checkins?.length && !checkouts?.length && !reminders?.length) {
      return new Response(JSON.stringify({ message: 'Sin eventos mañana. Email no enviado.' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const SOURCE_LABELS: Record<string, string> = {
      direct: '🏠 Directo', booking: '🟦 Booking',
      airbnb: '🟧 Airbnb',  family:  '🟪 Familia',
    };

    const fmt = (n: number) => `$${(n ?? 0).toLocaleString('es-AR')}`;
    const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long',
    });

    const buildBookingRow = (b: any, type: 'ci' | 'co') => {
      const guest = b.guests;
      const units = (b.booking_units ?? [])
        .map((bu: any) => `#${bu.units?.sort_order} ${bu.units?.name}`)
        .join(', ');
      const gName   = guest ? `${guest.first_name} ${guest.last_name}` : 'Sin huésped';
      const balance = b.balance ?? 0;
      const icon    = type === 'ci' ? '✅' : '👋';
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0">${icon} <strong>${gName}</strong></td>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0">${units}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0">${b.nights ?? '?'} noches</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0">${SOURCE_LABELS[b.source ?? 'direct']}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;${balance > 0 ? 'color:#DC2626;font-weight:700' : 'color:#16A34A'}">
            ${balance > 0 ? `⚠️ Saldo: ${fmt(balance)}` : '✓ Saldado'}
          </td>
          ${guest?.phone ? `<td style="padding:10px 12px;border-bottom:1px solid #E2E8F0"><a href="https://wa.me/${guest.phone.replace(/\D/g,'')}">${guest.phone}</a></td>` : '<td></td>'}
        </tr>`;
    };

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F8FAFC;margin:0;padding:20px">
      <div style="max-width:680px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
        
        <!-- Header -->
        <div style="background:#0F172A;padding:24px 32px">
          <h1 style="color:white;margin:0;font-size:1.3rem">🏨 ${hotel.name}</h1>
          <p style="color:#94A3B8;margin:6px 0 0;font-size:.9rem">Resumen del día — ${fmtDate(tomorrowISO)}</p>
        </div>

        <div style="padding:32px">

          ${checkins?.length ? `
          <!-- Check-ins -->
          <h2 style="color:#0F172A;font-size:1rem;margin:0 0 16px;display:flex;align-items:center;gap:8px">
            ✅ Ingresos de mañana (${checkins.length})
          </h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:32px;font-size:.875rem">
            <thead>
              <tr style="background:#F1F5F9">
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Huésped</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Depto.</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Noches</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Canal</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Estado pago</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Teléfono</th>
              </tr>
            </thead>
            <tbody>${checkins.map(b => buildBookingRow(b, 'ci')).join('')}</tbody>
          </table>` : ''}

          ${checkouts?.length ? `
          <!-- Check-outs -->
          <h2 style="color:#0F172A;font-size:1rem;margin:0 0 16px">
            👋 Salidas de mañana (${checkouts.length})
          </h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:32px;font-size:.875rem">
            <thead>
              <tr style="background:#F1F5F9">
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Huésped</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Depto.</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Noches</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Canal</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Saldo</th>
                <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#64748B">Teléfono</th>
              </tr>
            </thead>
            <tbody>${checkouts.map(b => buildBookingRow(b, 'co')).join('')}</tbody>
          </table>` : ''}

          ${reminders?.length ? `
          <!-- Recordatorios -->
          <h2 style="color:#0F172A;font-size:1rem;margin:0 0 16px">🔔 Recordatorios (${reminders.length})</h2>
          <ul style="padding:0;margin:0 0 24px;list-style:none">
            ${reminders.map(r => `
              <li style="padding:10px 16px;background:#FEF3C7;border-left:4px solid #F59E0B;
                border-radius:6px;margin-bottom:8px;font-size:.875rem">
                <strong>${r.title}</strong>
                ${r.units ? ` — #${r.units.sort_order} ${r.units.name}` : ''}
                ${r.description ? `<br><span style="color:#92400E">${r.description}</span>` : ''}
              </li>`).join('')}
          </ul>` : ''}

        </div>

        <!-- Footer -->
        <div style="background:#F8FAFC;padding:16px 32px;border-top:1px solid #E2E8F0">
          <p style="color:#94A3B8;font-size:.78rem;margin:0;text-align:center">
            ${hotel.name} · Enviado automáticamente · ${new Date().toLocaleString('es-AR')}
          </p>
        </div>
      </div>
    </body>
    </html>`;

    // Enviar con Resend
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    `${hotel.name} PMS <noreply@resend.dev>`,
        to:      [ADMIN_EMAIL],
        subject: `📋 Agenda de mañana — ${fmtDate(tomorrowISO)} · ${hotel.name}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend API error: ${err}`);
    }

    const result = await res.json();
    return new Response(JSON.stringify({
      success: true,
      emailId: result.id,
      checkins: checkins?.length ?? 0,
      checkouts: checkouts?.length ?? 0,
      reminders: reminders?.length ?? 0,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[daily-reminders]', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
