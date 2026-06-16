// ══════════════════════════════════════════════════
// supabase/functions/weekly-backup/index.ts
// Edge Function — Backup semanal automático
// Genera CSV de todas las reservas y lo envía
// por email al admin del hotel usando Resend.
//
// DEPLOY:
//   supabase functions deploy weekly-backup
//
// SCHEDULE (pg_cron — ejecutar en SQL Editor):
//   select cron.schedule(
//     'weekly-backup',
//     '0 8 * * 1',  -- Cada lunes a las 8:00 UTC
//     $$select net.http_post(
//       url := 'https://<ref>.functions.supabase.co/weekly-backup',
//       headers := '{"Authorization": "Bearer <service_role_key>"}',
//       body := '{}'
//     )$$
//   );
//
// ENV VARS requeridas (supabase secrets set):
//   RESEND_API_KEY   — api key de resend.com (gratis hasta 3000 emails/mes)
//   ADMIN_EMAIL      — email donde llega el backup
//   SUPABASE_URL     — URL del proyecto
//   SUPABASE_SERVICE_ROLE_KEY — clave service role (solo en Edge Functions)
// ══════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY')!;
const ADMIN_EMAIL       = Deno.env.get('ADMIN_EMAIL') ?? 'admin@milasistema.com';
const HOTEL_NAME        = Deno.env.get('HOTEL_NAME')  ?? 'MILA';

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const now      = new Date();
    const year     = now.getFullYear();
    const month    = now.getMonth();

    // ── Rango: últimos 30 días ──────────────────────
    const dateTo    = now.toISOString().slice(0, 10);
    const dateFrom  = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(`
        id, check_in, check_out, nights, status, source,
        price_per_night, total_amount, total_paid, balance, notes,
        created_at,
        guests(first_name, last_name, dni, phone, email),
        booking_units(units(name))
      `)
      .gte('created_at', dateFrom + 'T00:00:00Z')
      .lte('created_at', dateTo   + 'T23:59:59Z')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = (bookings ?? []).map(b => {
      const g     = (b as any).guests ?? {};
      const units = ((b as any).booking_units ?? [])
        .map((bu: any) => bu.units?.name ?? '').join(' + ');
      return [
        (b as any).id,
        `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim(),
        g.dni   ?? '',
        g.phone ?? '',
        g.email ?? '',
        units,
        (b as any).check_in  ?? '',
        (b as any).check_out ?? '',
        (b as any).nights    ?? '',
        (b as any).source    ?? 'direct',
        (b as any).status    ?? '',
        (b as any).price_per_night ?? '',
        (b as any).total_amount    ?? '',
        (b as any).total_paid      ?? '',
        (b as any).balance         ?? '',
        ((b as any).notes ?? '').replace(/\n/g, ' '),
        ((b as any).created_at ?? '').slice(0, 10),
      ];
    });

    const csv     = toCSV(HEADERS, rows);
    const b64     = btoa(unescape(encodeURIComponent('\uFEFF' + csv)));
    const period  = `${dateFrom} al ${dateTo}`;
    const count   = rows.length;
    const total   = rows.reduce((s, r) => s + (parseFloat(String(r[12])) || 0), 0);
    const totalFmt = '$' + Math.round(total).toLocaleString('es-AR');

    // ── Enviar email via Resend ─────────────────────
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'MILA Backup <backup@milasistema.com>',
        to:      [ADMIN_EMAIL],
        subject: `📦 Backup semanal ${HOTEL_NAME} — ${period}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
            <div style="background:#0F172A;border-radius:12px;padding:20px 24px;margin-bottom:20px">
              <h1 style="color:#F8FAFC;font-size:1.2rem;margin:0 0 4px">
                📦 Backup semanal generado
              </h1>
              <p style="color:#94A3B8;font-size:.875rem;margin:0">${HOTEL_NAME}</p>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr>
                <td style="padding:10px;background:#F8FAFC;border-radius:8px 0 0 8px;font-size:.875rem;color:#64748B">Período</td>
                <td style="padding:10px;font-weight:600;font-size:.875rem">${period}</td>
              </tr>
              <tr>
                <td style="padding:10px;background:#F8FAFC;font-size:.875rem;color:#64748B">Reservas exportadas</td>
                <td style="padding:10px;font-weight:600;font-size:.875rem">${count}</td>
              </tr>
              <tr>
                <td style="padding:10px;background:#F8FAFC;border-radius:0 0 0 8px;font-size:.875rem;color:#64748B">Total facturado</td>
                <td style="padding:10px;font-weight:700;font-size:1rem;color:#15803D">${totalFmt}</td>
              </tr>
            </table>
            <p style="font-size:.825rem;color:#64748B;line-height:1.6">
              El archivo CSV adjunto contiene todas las reservas del período. Abrilo en Excel 
              (doble clic) — el formato está optimizado con BOM UTF-8.
            </p>
            <p style="font-size:.75rem;color:#94A3B8;margin-top:20px;border-top:1px solid #E2E8F0;padding-top:12px">
              MILA Sistema Inteligente para Alojamientos · Backup automático semanal
            </p>
          </div>`,
        attachments: [{
          filename: `backup-mila-${dateFrom}.csv`,
          content:  b64,
        }],
      }),
    });

    const emailData = await emailRes.json();

    return new Response(JSON.stringify({
      ok:      emailRes.ok,
      period,
      count,
      total,
      email:   emailData,
    }), {
      status:  emailRes.ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status:  500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ── Helpers ────────────────────────────────────────
const HEADERS = [
  'ID', 'Huésped', 'DNI', 'Teléfono', 'Email', 'Unidades',
  'Check-in', 'Check-out', 'Noches', 'Canal', 'Estado',
  'Precio/noche', 'Total', 'Abonado', 'Saldo', 'Notas', 'Creado',
];

function toCSV(headers: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}
