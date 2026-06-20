// ═══════════════════════════════════════════════════
// weekly-summary — Resumen semanal MILA
// Cron: 0 8 * * 1 (cada lunes 8am)
// Requiere: RESEND_API_KEY, MILA_FROM_EMAIL
// ═══════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_KEY  = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPA_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SUPA_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FROM_EMAIL  = Deno.env.get('MILA_FROM_EMAIL') ?? 'noreply@milasistema.com';

const fmt    = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtDate= (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'2-digit',month:'short'});
const gName  = (b: any) => b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : '—';

serve(async (req) => {
  const db    = createClient(SUPA_URL, SUPA_KEY);
  const now   = new Date();
  const today = now.toISOString().split('T')[0];
  const mon   = new Date(now); mon.setDate(now.getDate() - 7);
  const sun   = new Date(now); sun.setDate(now.getDate() + 6);
  const monS  = mon.toISOString().split('T')[0];
  const sunS  = sun.toISOString().split('T')[0];

  const { data: hotels } = await db.from('hotels').select('id,name');
  if (!hotels?.length) return new Response('no hotels', { status: 404 });

  for (const h of hotels) {
    const [{ data: bk }, { data: arr }, { data: dep }, { data: up }, { data: admins }] = await Promise.all([
      db.from('bookings').select('total_amount,total_paid,balance')
        .eq('hotel_id',h.id).not('status','in','(cancelled,blocked)').gte('check_in',monS).lt('check_in',today),
      db.from('bookings').select('check_in,guests!bookings_guest_id_fkey(first_name,last_name),booking_units(units(name))')
        .eq('hotel_id',h.id).not('status','in','(cancelled,blocked)').gte('check_in',today).lte('check_in',sunS).order('check_in'),
      db.from('bookings').select('check_out,guests!bookings_guest_id_fkey(first_name,last_name)')
        .eq('hotel_id',h.id).not('status','in','(cancelled,blocked)').gte('check_out',today).lte('check_out',sunS).order('check_out'),
      db.from('bookings').select('check_in,balance,guests!bookings_guest_id_fkey(first_name,last_name)')
        .eq('hotel_id',h.id).eq('status','partial').gte('check_in',today).lte('check_in',sunS).gt('balance',0),
      db.from('hotel_users').select('users(email)').eq('hotel_id',h.id).in('role',['admin','owner']),
    ]);

    const emails = (admins ?? []).map((a:any) => a.users?.email).filter(Boolean);
    if (!emails.length) continue;

    const rev     = (bk??[]).reduce((s:number,b:any) => s+(b.total_amount??0), 0);
    const col     = (bk??[]).reduce((s:number,b:any) => s+(b.total_paid??0), 0);
    const pend    = (bk??[]).reduce((s:number,b:any) => s+(b.balance??0), 0);

    const trArr   = (arr??[]).map((b:any) => `<tr><td>${fmtDate(b.check_in)}</td><td>${gName(b)}</td><td>${(b.booking_units??[]).map((u:any)=>u.units?.name).join(', ')}</td></tr>`).join('') || '<tr><td colspan="3" style="color:#94a3b8">Sin llegadas</td></tr>';
    const trDep   = (dep??[]).map((b:any) => `<tr><td>${fmtDate(b.check_out)}</td><td>${gName(b)}</td></tr>`).join('') || '<tr><td colspan="2" style="color:#94a3b8">Sin salidas</td></tr>';
    const trUp    = (up??[]).map((b:any)  => `<tr><td>${fmtDate(b.check_in)}</td><td>${gName(b)}</td><td style="color:#f97316;font-weight:700">${fmt(b.balance)}</td></tr>`).join('');

    const html = `<html><body style="font-family:sans-serif;background:#f8fafc;padding:20px">
<div style="max-width:560px;margin:0 auto">
<div style="background:#6366f1;border-radius:12px;padding:20px 24px;margin-bottom:16px">
  <h1 style="color:#fff;margin:0;font-size:1.2rem">📊 Resumen semanal</h1>
  <p style="color:#c7d2fe;margin:4px 0 0;font-size:.85rem">${h.name}</p>
</div>
<div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:12px">
  <p style="font-size:.75rem;color:#64748b;margin:0 0 12px;text-transform:uppercase;font-weight:600">Semana anterior · ${fmtDate(monS)} al ${fmtDate(today)}</p>
  <div style="display:flex;gap:12px">
    <div style="flex:1;background:#f1f5f9;border-radius:8px;padding:12px;text-align:center"><div style="font-size:1.3rem;font-weight:800">${fmt(rev)}</div><div style="font-size:.7rem;color:#64748b">Facturado</div></div>
    <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:12px;text-align:center"><div style="font-size:1.3rem;font-weight:800;color:#16a34a">${fmt(col)}</div><div style="font-size:.7rem;color:#64748b">Cobrado</div></div>
    <div style="flex:1;background:#fff7ed;border-radius:8px;padding:12px;text-align:center"><div style="font-size:1.3rem;font-weight:800;color:#f97316">${fmt(pend)}</div><div style="font-size:.7rem;color:#64748b">Pendiente</div></div>
  </div>
</div>
<div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:12px">
  <p style="font-size:.75rem;color:#64748b;margin:0 0 10px;text-transform:uppercase;font-weight:600">✅ Llegadas · ${fmtDate(today)} al ${fmtDate(sunS)}</p>
  <table style="width:100%;border-collapse:collapse;font-size:.83rem"><tr style="background:#f1f5f9"><th style="padding:6px;text-align:left">Fecha</th><th style="padding:6px;text-align:left">Huésped</th><th style="padding:6px;text-align:left">Unidad</th></tr>${trArr}</table>
</div>
<div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:12px">
  <p style="font-size:.75rem;color:#64748b;margin:0 0 10px;text-transform:uppercase;font-weight:600">👋 Salidas</p>
  <table style="width:100%;border-collapse:collapse;font-size:.83rem"><tr style="background:#f1f5f9"><th style="padding:6px;text-align:left">Fecha</th><th style="padding:6px;text-align:left">Huésped</th></tr>${trDep}</table>
</div>
${trUp ? `<div style="background:#fff;border-left:4px solid #f97316;border-radius:12px;padding:20px;margin-bottom:12px">
  <p style="font-size:.75rem;color:#f97316;margin:0 0 10px;font-weight:700;text-transform:uppercase">💰 Saldos pendientes próximos</p>
  <table style="width:100%;border-collapse:collapse;font-size:.83rem"><tr style="background:#f1f5f9"><th style="padding:6px;text-align:left">Check-in</th><th style="padding:6px;text-align:left">Huésped</th><th style="padding:6px;text-align:left">Saldo</th></tr>${trUp}</table>
</div>` : ''}
<p style="text-align:center;color:#cbd5e1;font-size:.72rem">MILA · resumen automático semanal</p>
</div></body></html>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL, to: emails,
        subject: `📊 Resumen semanal MILA — ${h.name} — ${fmtDate(today)}`, html,
      }),
    });
  }

  return new Response(JSON.stringify({ ok: true, hotels: hotels.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
