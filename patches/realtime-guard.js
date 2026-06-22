/**
 * MILA PMS — patches/realtime-guard.js
 *
 * PROBLEMA: Maximum call stack size exceeded
 * CAUSA: La suscripción Realtime de Supabase dispara un evento →
 *        el handler llama a load() → load() vuelve a suscribirse →
 *        la nueva suscripción dispara de nuevo → loop infinito.
 *
 * SOLUCIÓN: Canal único + flag de carga + debounce.
 *
 * CÓMO USAR:
 * Buscá en tu código donde hacés supabase.channel(...).on(...).subscribe()
 * dentro de la clase BookingList (o similar) y reemplazá con el patrón de abajo.
 */

/**
 * Reemplaza el patrón de suscripción problemático.
 * Buscá en tu BookingList algo como:
 *
 *   supabase.channel('bookings').on('postgres_changes', ..., () => this.load()).subscribe()
 *
 * Y reemplazalo con:
 */

// ── PATRÓN CORRECTO ───────────────────────────────────────────────

export function setupBookingRealtime(supabase, onChangeCallback) {
  // 1. Canal con nombre fijo (no crear uno nuevo en cada load)
  const CHANNEL_NAME = 'mila-bookings-realtime';

  // 2. Eliminar canal previo si existe (evita duplicados al re-llamar)
  supabase.getChannels().forEach(ch => {
    if (ch.topic === CHANNEL_NAME) supabase.removeChannel(ch);
  });

  // 3. Flag de debounce para no ejecutar múltiples recargas simultáneas
  let reloadTimeout = null;
  const debouncedReload = () => {
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
      reloadTimeout = null;
      onChangeCallback();
    }, 300); // 300ms de debounce
  };

  // 4. Suscribirse UNA sola vez
  const channel = supabase
    .channel(CHANNEL_NAME)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'bookings' },
      debouncedReload
    )
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'payments' },
      debouncedReload
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime: suscripción activa');
      }
      if (status === 'CHANNEL_ERROR') {
        console.error('❌ Realtime: error en canal');
      }
    });

  // 5. Retornar función de cleanup (llamar al desmontar/navegar)
  return () => supabase.removeChannel(channel);
}

// ── GUARD DE CARGA (para el DOMContentLoaded) ───────────────────

/**
 * Si el problema está en el DOMContentLoaded que se dispara múltiples veces,
 * reemplazar la inicialización con este patrón:
 */
export function initBookingListSafe(loadFn) {
  let initialized = false;

  document.addEventListener('DOMContentLoaded', async () => {
    if (initialized) return; // ← Corta el loop
    initialized = true;
    await loadFn();
  });
}

// ── EJEMPLO DE USO COMPLETO ──────────────────────────────────────
/*
import { setupBookingRealtime, initBookingListSafe } from './patches/realtime-guard.js';

// En tu BookingList o donde inicializás la lista:
initBookingListSafe(async () => {
  await bookingList.load();

  // Configurar realtime UNA sola vez, fuera del load()
  setupBookingRealtime(supabase, async () => {
    await bookingList.load();
  });
});
*/
