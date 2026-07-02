// ═══════════════════════════════════════════════════
// js/services/audit-service.js
// Registra acciones en la tabla audit_log.
// Extraído de app.js para evitar import circular:
//   app.js → booking-form.js → app.js (CIRCULAR)
// Ahora: booking-form.js → audit-service.js ✓
// ═══════════════════════════════════════════════════

import { supabase, AppContext } from '../supabase-config.js';
import { isDemo } from '../auth/permissions.js';

/**
 * Registra una acción en el audit log.
 * No hace nada en modo demo ni si falta hotelId.
 *
 * @param {string} action      - 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL' | 'CHECKIN' | etc.
 * @param {string} entityType  - 'booking' | 'payment' | 'guest' | 'expense' | etc.
 * @param {string|null} entityId - UUID de la entidad afectada
 * @param {string} summary     - Texto legible del cambio
 * @param {object|null} changes - { before: {}, after: {} } (opcional)
 */
export async function logAction(action, entityType, entityId, summary, changes = null) {
  if (!AppContext.hotelId || isDemo()) return;
  try {
    const row = {
      hotel_id:    AppContext.hotelId,
      user_id:     AppContext.user?.id    ?? null,
      user_email:  AppContext.user?.email ?? null,
      role:        AppContext.role        ?? 'staff',
      action,
      entity_type: entityType,
      entity_id:   entityId              ?? null,
      summary,           // columna preferida
      description: summary, // alias — por si el schema usa description
      changes:     changes ? JSON.parse(JSON.stringify(changes)) : null,
    };
    const { error } = await supabase.from('audit_log').insert(row);
    if (error) throw error;
  } catch (err) {
    // Si falla por columna no existente, reintentar sin la columna problemática
    if (err?.message?.includes('description') || err?.message?.includes('summary')) {
      try {
        const { error: err2 } = await supabase.from('audit_log').insert({
          hotel_id:   AppContext.hotelId,
          user_id:    AppContext.user?.id    ?? null,
          user_email: AppContext.user?.email ?? null,
          role:       AppContext.role        ?? 'staff',
          action, entity_type: entityType, entity_id: entityId ?? null,
        });
        if (err2) console.warn('[Audit] insert falló (reintento):', err2.message);
      } catch (e2) { console.warn('[Audit] insert falló (reintento):', e2.message); }
    } else {
      // Log visible en consola para poder diagnosticar (ej: RLS "admin_only"
      // bloqueando el insert si el usuario logueado no tiene role='admin'
      // en hotel_users). Nunca rompe el flujo principal — solo se avisa.
      console.warn('[Audit] insert falló:', err?.message ?? err);
    }
  }
}
