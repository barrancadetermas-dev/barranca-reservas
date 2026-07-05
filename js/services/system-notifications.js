// ═══════════════════════════════════════════════════
// system-notifications.js — Avisos técnicos de la propia
// app (categoría "sistema" — no se puede silenciar, son
// cosas que conviene saber pase lo que pase).
//
// Por ahora: perder/recuperar conexión a internet. Útil
// para confirmar si algo que hiciste realmente se guardó
// o se quedó esperando a que vuelva la señal.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

let _initialized = false;
let _wasOffline = false;

export function initSystemNotifications() {
  if (_initialized) return;
  _initialized = true;

  window.addEventListener('offline', () => {
    _wasOffline = true;
    addNotification({
      type: 'system_offline', category: 'sistema', icon: '📡', color: '#EF4444',
      title: 'Sin conexión a internet',
      message: 'Los cambios que hagas ahora pueden no guardarse hasta que vuelva la señal.',
    });
  });

  window.addEventListener('online', () => {
    if (!_wasOffline) return; // no avisar "reconectado" si nunca se detectó offline antes
    _wasOffline = false;
    addNotification({
      type: 'system_online', category: 'sistema', icon: '✅', color: '#22C55E',
      title: 'Conexión recuperada',
      message: 'Ya podés seguir trabajando con normalidad.',
    });
  });
}
