// ═══════════════════════════════════════════════════
// f1-notifications.js — Seguimiento de Franco Colapinto
// (Alpine, #43) en la Fórmula 1.
//
// 2 fuentes gratis, sin clave ni registro:
//  - Jolpica-F1 (api.jolpi.ca) — sucesor de la vieja
//    Ergast API. Resultados de carrera y próximo Gran
//    Premio. Categoría "f1".
//  - OpenF1 (api.openf1.org) — datos de sesión en vivo
//    (posición en pista). Solo se consulta si hay una
//    sesión de F1 corriendo ahora mismo. Categoría "f1_vivo".
//
// Mismo criterio que el resto: resumen cada 4 horas,
// pero si hay sesión en vivo (clasificación o carrera),
// se pasa a revisar cada ~2 minutos mientras dura.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const SUMMARY_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas
const LIVE_POLL_MS        = 2 * 60 * 1000;       // 2 minutos, solo si hay sesión en vivo
const SESSION_CHECK_MS    = 5 * 60 * 1000;        // cada 5 min revisa si arrancó/terminó una sesión

const LASTRUN_KEY    = 'mila_f1_notif_lastrun';
const LAST_RACE_KEY  = 'mila_f1_last_race_seen';
const LAST_POS_KEY   = 'mila_f1_last_position';

const DRIVER_NUMBER = 43; // Franco Colapinto

let _liveTimer = null;
let _sessionCheckTimer = null;

// ── Resumen cada 4 horas: último resultado + próxima carrera ──
export async function checkF1Summary() {
  const now = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (now - lastRun < SUMMARY_INTERVAL_MS) return;

  try {
    const [resultsRes, scheduleRes] = await Promise.all([
      fetch('https://api.jolpi.ca/ergast/f1/current/drivers/colapinto/results.json?limit=1&sort=desc'),
      fetch('https://api.jolpi.ca/ergast/f1/current.json'),
    ]);
    if (!resultsRes.ok) throw new Error(`HTTP ${resultsRes.status}`);

    const resultsData = await resultsRes.json();
    const race = resultsData?.MRData?.RaceTable?.Races?.[0];
    const result = race?.Results?.[0];

    const lines = [];
    if (race && result) {
      // Evitar re-avisar el mismo resultado una y otra vez cada 4 horas
      const raceKey = `${race.season}-${race.round}`;
      const lastSeen = localStorage.getItem(LAST_RACE_KEY);
      if (raceKey !== lastSeen) {
        lines.push(`Último: ${result.positionText}° en el GP de ${race.raceName} — ${result.points} pts`);
        localStorage.setItem(LAST_RACE_KEY, raceKey);
      }
    }

    if (scheduleRes.ok) {
      const scheduleData = await scheduleRes.json();
      const races = scheduleData?.MRData?.RaceTable?.Races ?? [];
      const todayISO = new Date().toISOString().slice(0, 10);
      const next = races.find(r => r.date >= todayISO);
      if (next) {
        const d = new Date(next.date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
        lines.push(`Próxima carrera: ${next.raceName} — ${d}`);
      }
    }

    if (lines.length) {
      addNotification({
        type: 'f1_summary', category: 'f1', icon: '🏎️', color: '#0090FF',
        title: 'Franco Colapinto — F1',
        message: lines.join('\n'),
        data: { season: race?.season, round: race?.round },
      });
    }
    localStorage.setItem(LASTRUN_KEY, String(now));
  } catch (err) {
    console.warn('[F1] no se pudo obtener el resumen:', err?.message ?? err);
  }
}

// ── ¿Hay una sesión de F1 corriendo ahora mismo? ──
async function _getLiveSession() {
  try {
    const res = await fetch('https://api.openf1.org/v1/sessions?session_key=latest');
    if (!res.ok) return null;
    const data = await res.json();
    const session = data?.[0];
    if (!session) return null;
    const now = new Date();
    const start = new Date(session.date_start);
    const end   = new Date(session.date_end);
    return (now >= start && now <= end) ? session : null;
  } catch {
    return null;
  }
}

// ── Posición de Colapinto durante la sesión en vivo ──
async function _pollLivePosition() {
  try {
    const res = await fetch(`https://api.openf1.org/v1/position?session_key=latest&driver_number=${DRIVER_NUMBER}`);
    if (!res.ok) return;
    const data = await res.json();
    const latest = data?.[data.length - 1];
    if (!latest) return;

    const prevPos = localStorage.getItem(LAST_POS_KEY);
    const newPos  = String(latest.position);
    if (prevPos !== null && prevPos !== newPos) {
      addNotification({
        type: 'f1_live', category: 'f1_vivo', icon: '🏎️', color: '#0090FF',
        title: 'Colapinto en pista',
        message: `Ahora va ${newPos}° (antes ${prevPos}°)`,
        data: { position: newPos },
      });
    }
    localStorage.setItem(LAST_POS_KEY, newPos);
  } catch (err) {
    console.warn('[F1] error revisando posición en vivo:', err?.message ?? err);
  }
}

async function _checkSessionAndToggleLivePolling() {
  const session = await _getLiveSession();
  if (session && !_liveTimer) {
    // Arrancó una sesión — prender el sondeo de posición cada 2 min
    _pollLivePosition();
    _liveTimer = setInterval(_pollLivePosition, LIVE_POLL_MS);
  } else if (!session && _liveTimer) {
    // Terminó la sesión — apagar el sondeo, no tiene sentido seguir pidiendo
    clearInterval(_liveTimer);
    _liveTimer = null;
    localStorage.removeItem(LAST_POS_KEY);
  }
}

/**
 * Llamar una vez al iniciar la app. Arranca el resumen de 4 horas y
 * además revisa cada 5 minutos si hay una sesión de F1 en curso — si la
 * hay, prende el seguimiento de posición cada 2 minutos automáticamente
 * mientras dure, y lo apaga solo cuando termina.
 */
export function initF1Notifications() {
  checkF1Summary();
  setInterval(checkF1Summary, SUMMARY_INTERVAL_MS);

  if (_sessionCheckTimer) return; // ya está corriendo
  _checkSessionAndToggleLivePolling();
  _sessionCheckTimer = setInterval(_checkSessionAndToggleLivePolling, SESSION_CHECK_MS);
}
