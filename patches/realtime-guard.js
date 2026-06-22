/**
 * MILA PMS — patches/realtime-guard.js
 *
 * PROBLEMA: Maximum call stack size exceeded
 * CAUSA:    Suscripción Realtime creada DENTRO de load() →
 *           cada evento DB llama load() → que crea otra suscripción →
 *           que dispara de nuevo → loop infinito.
 *
 * SOLUCIÓN: Canal único + debounce 300ms + flag de inicialización.
 */

// ── Canal único de Realtime ──────────────────────────────────────

/**
 * Configura Realtime UNA sola vez, fuera del load().
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Function} onChangeCallback  - qué hacer cuando cambia algo
 * @returns {Function} cleanup — llamar al desmontar
 */
export function setupRealtimeOnce(supabase, onChangeCallback) {
  const CHANNEL = 'mila-realtime-v1';

  // Eliminar canal previo si existe (evita duplicados)
  supabase.getChannels().forEach(ch => {
    if (ch.topic === CHANNEL) {
      supabase.removeChannel(ch);
    }
  });

  // Debounce: ignorar eventos duplicados en 300ms
  let timer = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChangeCallback();
    }, 300);
  };

  const channel = supabase
    .channel(CHANNEL)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' },  debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' },  debounced)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, debounced)
    .subscribe(status => {
      if (status === 'SUBSCRIBED') console.log('✅ Realtime conectado');
      if (status === 'CHANNEL_ERROR') console.error('❌ Realtime error');
    });

  return () => supabase.removeChannel(channel); // cleanup
}

// ── Guard de inicialización única ────────────────────────────────

/**
 * Reemplaza el patrón problemático de DOMContentLoaded.
 *
 * ANTES (problemático):
 *   document.addEventListener('DOMContentLoaded', () => bookingList.load())
 *   // + dentro de load() → supabase.channel().subscribe()
 *
 * DESPUÉS:
 *   initOnce(async () => {
 *     await bookingList.load();
 *     setupRealtimeOnce(supabase, () => bookingList.load());
 *   });
 */
export function initOnce(fn) {
  let done = false;
  document.addEventListener('DOMContentLoaded', async () => {
    if (done) return;
    done = true;
    try {
      await fn();
    } catch (err) {
      console.error('initOnce error:', err);
    }
  });
}

// ── EJEMPLO DE USO ───────────────────────────────────────────────
/*
import { setupRealtimeOnce, initOnce } from './patches/realtime-guard.js';

initOnce(async () => {
  // 1. Cargar datos una vez
  await bookingList.load();
  await reminderWidget.load();

  // 2. Realtime una sola vez, fuera del load()
  const cleanup = setupRealtimeOnce(supabase, async () => {
    await bookingList.load();
    await reminderWidget.load();
  });

  // 3. Cleanup si navegás a otra página (SPA)
  window.addEventListener('beforeunload', cleanup);
});
*/
