// js/services/push-service.js
// Aislado para evitar importaciones circulares (app.js ↔ booking-form.js)
import { AppContext } from '../supabase-config.js';

export async function sendPushToStaff({ title, body, data = {} }) {
  try {
    const hotelId = AppContext?.hotelId;
    if (!hotelId) return;
    await fetch('/api/send-push', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ hotel_id: hotelId, title, body, data }),
    });
  } catch (err) {
    console.warn('[Push] envío fallido:', err.message);
  }
}
