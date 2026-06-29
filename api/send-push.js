// api/send-push.js — Vercel Serverless Function
// Recibe datos de reserva y envía push a todos los staff del hotel
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

webpush.setVapidDetails(
  'mailto:barrancadetermas@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { hotel_id, title, body, icon, data } = req.body ?? {};
    if (!hotel_id || !title) return res.status(400).json({ error: 'hotel_id y title requeridos' });

    // Leer suscripciones staff del hotel desde Supabase (con service role)
    const supabase = createClient(
      process.env.SUPABASE_URL     ?? process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY
    );

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key, user_id')
      .eq('hotel_id', hotel_id);

    if (error) throw error;
    if (!subs?.length) return res.status(200).json({ sent: 0, message: 'Sin suscripciones' });

    const payload = JSON.stringify({
      title: title ?? 'MILA',
      body:  body  ?? '',
      icon:  icon  ?? '/icon-192.png',
      badge: '/favicon-32.png',
      data:  data  ?? {},
      tag:   'mila-booking',
    });

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        )
      )
    );

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    // Limpiar suscripciones expiradas (410 Gone)
    const expired = results
      .map((r, i) => r.status === 'rejected' && r.reason?.statusCode === 410 ? subs[i] : null)
      .filter(Boolean);
    if (expired.length > 0) {
      await supabase.from('push_subscriptions')
        .delete()
        .in('endpoint', expired.map(s => s.endpoint));
    }

    return res.status(200).json({ sent, failed });
  } catch (err) {
    console.error('[send-push]', err);
    return res.status(500).json({ error: err.message });
  }
}
