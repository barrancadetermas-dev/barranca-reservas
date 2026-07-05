// ═══════════════════════════════════════════════════
// holiday-notifications.js — Aviso de feriados próximos
// Corre una vez por día (guardado en localStorage, mismo
// criterio que usamos para el recordatorio automático de
// saldo pendiente). Usa arg-holidays.js, que ya existe y
// ya alimenta el calendario — acá solo se le suma el aviso,
// no se toca ni se duplica la lógica de feriados en sí.
// ═══════════════════════════════════════════════════

import { getHolidaysForYear } from './arg-holidays.js';
import { addNotification } from './notification-center.js';

const LASTRUN_KEY  = 'mila_holiday_notif_lastrun';
const NOTIFIED_KEY = 'mila_holiday_notified_dates';

/**
 * Revisa los próximos `daysAhead` días — si hay un feriado y todavía no
 * se avisó de ESE feriado puntual, genera una notificación. Se puede
 * llamar en cada carga de la app: no vuelve a avisar el mismo feriado ni
 * corre más de una vez por día.
 */
export function checkUpcomingHolidays(daysAhead = 7) {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  if (localStorage.getItem(LASTRUN_KEY) === todayISO) return; // ya se revisó hoy

  let notified = [];
  try { notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '[]'); } catch { notified = []; }

  // Traer feriados de este año Y el siguiente, por si el rango de días
  // a revisar cruza el 31 de diciembre.
  const year = today.getFullYear();
  const holidaysThis = getHolidaysForYear(year);
  const holidaysNext = getHolidaysForYear(year + 1);
  const allHolidays  = new Map([...holidaysThis, ...holidaysNext]);

  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const hol = allHolidays.get(iso);
    if (!hol || notified.includes(iso)) continue;

    addNotification({
      type: 'holiday_upcoming',
      category: 'feriados',
      icon: '📅',
      color: '#F59E0B',
      title: hol.label,
      message: i === 0
        ? 'Es hoy'
        : `En ${i} día${i !== 1 ? 's' : ''} — ${d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long' })}`,
      data: { date: iso },
    });
    notified.push(iso);
  }

  try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified.slice(-50))); } catch {}
  localStorage.setItem(LASTRUN_KEY, todayISO);
}
