// ═══════════════════════════════════════════════════
// permissions.js — Sistema de permisos por rol
// Roles: admin | staff | demo
// Uso: import { can, isDemo } from '../auth/permissions.js'
// ═══════════════════════════════════════════════════

import { AppContext } from '../supabase-config.js';

// ── Tabla de permisos por rol ──────────────────────
export const ROLE_PERMISSIONS = {

  // 👑 Admin — Control total
  admin: {
    createBooking:        true,
    editBooking:          true,
    deleteBooking:        true,
    cancelBooking:        true,
    duplicateBooking:     true,
    checkInOut:           true,
    addPayment:           true,
    editPayment:          true,
    deletePayment:        true,
    viewRevenue:          true,
    viewBalanceOnly:      true,
    viewStats:            true,
    viewCommissions:      true,
    viewPL:               true,
    exportData:           true,
    manageExpenses:       true,
    manageReminders:      true,
    viewReminders:        true,
    markBadExperience:    true,
    viewGuestCRM:         true,
    manageUsers:          true,
    viewAuditLog:         true,
    manageSeasonPricing:  true,
    manageUnitNotes:      true,
    viewCalendarReadOnly: true,
    viewOperationsReadOnly: true,
    viewDashboardOps:     true,
  },

  // 👷 Staff (Encargada) — Solo vista operativa, sin datos financieros
  staff: {
    createBooking:        false,
    editBooking:          false,
    deleteBooking:        false,
    cancelBooking:        false,
    duplicateBooking:     false,
    checkInOut:           false,
    addPayment:           false,
    editPayment:          false,
    deletePayment:        false,
    viewRevenue:          false,   // sin totales ni señas
    viewBalanceOnly:      true,    // solo "monto al ingreso" (balance)
    viewStats:            false,
    viewCommissions:      false,
    viewPL:               false,
    exportData:           false,
    manageExpenses:       false,
    manageReminders:      false,   // solo ver, no crear
    viewReminders:        true,
    markBadExperience:    false,
    viewGuestCRM:         false,
    manageUsers:          false,
    viewAuditLog:         false,
    manageSeasonPricing:  false,
    manageUnitNotes:      false,
    viewCalendarReadOnly: true,    // calendario solo lectura
    viewOperationsReadOnly: true,  // operaciones solo vista
    viewDashboardOps:     true,    // ingresos/salidas/recambios/alojados
  },

  // 🎭 Demo — Navegación libre, nada se guarda
  demo: {
    createBooking:        true,    // simula
    editBooking:          true,    // simula
    deleteBooking:        false,
    cancelBooking:        false,
    duplicateBooking:     false,
    checkInOut:           false,
    addPayment:           true,    // simula
    editPayment:          false,
    deletePayment:        false,
    viewRevenue:          true,    // datos fake
    viewStats:            true,    // datos fake
    viewCommissions:      true,    // datos fake
    viewPL:               true,    // datos fake
    exportData:           false,
    manageExpenses:       false,
    manageReminders:      false,
    markBadExperience:    false,
    viewGuestCRM:         true,    // datos fake
    manageUsers:          false,
    viewAuditLog:         false,
    manageSeasonPricing:  false,
    manageUnitNotes:      false,
    IS_DEMO:              true,
  },
};

// ── API pública ────────────────────────────────────

/** ¿El rol actual tiene el permiso solicitado? */
export function can(permission) {
  const role = AppContext?.role === 'owner' ? 'admin' : (AppContext?.role ?? 'staff');
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

/** ¿Está en modo demo? */
export function isDemo() {
  return AppContext?.role === 'demo' || AppContext?.IS_DEMO === true;
}

/** Ejecuta fn solo si tiene permiso, sino muestra toast */
export async function requirePermission(permission, fn, { silent = false } = {}) {
  if (can(permission)) return fn();
  if (!silent) {
    const { showToast } = await import('../supabase-config.js').catch(() => ({ showToast: () => {} }));
    const role = AppContext?.role ?? 'staff';
    const msg  = role === 'demo'
      ? '🎭 Modo demo — Esta acción no está disponible en la demo'
      : '🔒 Sin permiso para esta acción';
    document.dispatchEvent(new CustomEvent('show:toast', { detail: { msg, type: 'warning' } }));
  }
  return null;
}

/** Label legible del rol */
export function getRoleLabel(role) {
  return { admin: '👑 Administrador', owner: '👑 Administrador', staff: '👷 Staff', demo: '🎭 Demo' }[role] ?? role;
}

/** Botón condicionado a permiso — devuelve '' si no tiene permiso */
export function btn(permission, html) {
  return can(permission) ? html : '';
}
