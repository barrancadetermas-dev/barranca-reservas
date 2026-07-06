// ═══════════════════════════════════════════════════
// sports-notifications.js — Resumen de Selección Argentina
// y River Plate, + avisos casi en vivo de goles.
//
// Usa TheSportsDB (thesportsdb.com) con la clave de prueba
// pública "123" — no requiere que crees ninguna cuenta ni
// clave propia, es la misma que cualquiera puede usar.
//
// 2 mecanismos separados:
//  1. checkSportsSummary() — resumen (último resultado +
//     próximo partido), cada 4 horas. Categoría "deportes".
//  2. Si alguno de los 2 equipos juega HOY, se activa un
//     seguimiento más seguido (cada ~3 min) para detectar
//     cambios de marcador y avisar apenas se note un gol.
//     Categoría separada "deportes_vivo", para que se pueda
//     silenciar aparte del resumen diario.
//
// Aviso honesto: la capa gratuita de esta fuente NO tiene
// marcador en vivo segundo a segundo (eso es pago en
// cualquier proveedor) — lo que hacemos es revisar seguido
// mientras hay un partido en curso, así que un gol se nota
// con unos minutos de demora, no al instante. Es el mejor
// resultado posible sin pagar nada.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';
import { Bus, EVENTS } from './event-bus.js';

const SUMMARY_INTERVAL_MS = 4 * 60 * 60 * 1000;  // 4 horas
const LIVE_POLL_MS         = 3 * 60 * 1000;       // 3 minutos, solo si hay partido hoy
const LASTRUN_KEY  = 'mila_sports_notif_lastrun';
const LIVE_SCORE_KEY = 'mila_sports_live_scores'; // último marcador visto por evento, para detectar cambios

const API_KEY = '123'; // clave de prueba pública de TheSportsDB — no es nuestra, es compartida

const TEAMS = [
  { id: '134509', name: 'Selección Argentina (Fútbol)', icon: '🇦🇷', confetti: ['#75AADB', '#FFFFFF'] },
  { id: '135171', name: 'River Plate',                  icon: '🔴⚪', confetti: ['#DC2626', '#FFFFFF'] },
  { id: '136736', name: 'Selección Argentina (Básquet)', icon: '🏀', confetti: ['#75AADB', '#FFFFFF'] },
];

let _liveTimer = null;

async function _fetchLastNext(team) {
  const [lastRes, nextRes] = await Promise.all([
    fetch(`https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventslast.php?id=${team.id}`),
    fetch(`https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsnext.php?id=${team.id}`),
  ]);
  const lastData = lastRes.ok ? await lastRes.json() : null;
  const nextData = nextRes.ok ? await nextRes.json() : null;
  return { last: lastData?.results?.[0] ?? null, next: nextData?.events?.[0] ?? null };
}

function _loadLiveScores() {
  try { return JSON.parse(localStorage.getItem(LIVE_SCORE_KEY)) ?? {}; } catch { return {}; }
}
function _saveLiveScores(obj) {
  try { localStorage.setItem(LIVE_SCORE_KEY, JSON.stringify(obj)); } catch {}
}

// ── Resumen cada 4 horas (último resultado + próximo partido) ──
const LAST_SEEN_KEY = 'mila_sports_last_seen'; // por equipo: último partido (jugado + próximo) ya avisado

export async function checkSportsSummary() {
  const now = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (now - lastRun < SUMMARY_INTERVAL_MS) return; // todavía no pasaron las 4 horas

  let lastSeen = {};
  try { lastSeen = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) ?? '{}'); } catch { lastSeen = {}; }

  let anyAttemptSucceeded = false;
  for (const team of TEAMS) {
    try {
      const { last, next } = await _fetchLastNext(team);
      anyAttemptSucceeded = true;
      // Se arma una "huella" del estado actual (qué partido jugó + cuál
      // es el próximo) — si es IGUAL a la última vez que se avisó este
      // equipo, no se repite la misma info de nuevo, aunque hayan
      // pasado las 4 horas. Solo avisa si de verdad cambió algo.
      const fingerprint = `${last?.idEvent ?? ''}:${last?.intHomeScore ?? ''}-${last?.intAwayScore ?? ''}|${next?.idEvent ?? ''}`;
      if (fingerprint === lastSeen[team.id]) continue; // nada nuevo para este equipo, se saltea

      const lines = [];
      if (last) lines.push(`Último: ${last.strHomeTeam} ${last.intHomeScore ?? '?'} - ${last.intAwayScore ?? '?'} ${last.strAwayTeam}`);
      if (next) {
        const d = next.dateEvent ? new Date(next.dateEvent + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : '';
        lines.push(`Próximo: ${next.strHomeTeam} vs ${next.strAwayTeam}${d ? ` — ${d}` : ''}`);
      }
      if (lines.length) {
        addNotification({
          type: 'sports_summary', category: 'deportes', icon: team.icon, color: '#F59E0B',
          title: team.name, message: lines.join('\n'), data: { teamId: team.id },
        });
        lastSeen[team.id] = fingerprint;
      }
    } catch (err) {
      console.warn(`[Sports] no se pudo obtener el resumen de ${team.name}:`, err?.message ?? err);
    }
  }
  try { localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(lastSeen)); } catch {}
  // Solo se marca "ya revisado" si al menos un equipo respondió de
  // verdad — así, si la fuente estuvo caída, se reintenta en la próxima
  // apertura de la app en vez de esperar 4 horas de más por un fallo.
  if (anyAttemptSucceeded) localStorage.setItem(LASTRUN_KEY, String(now));
}

// Intenta traer quién hizo el gol y en qué minuto — endpoint gratis
// (con límite bajo, por eso solo se llama cuando YA se detectó que hubo
// un gol, no en cada sondeo). Si no hay datos disponibles (pasa seguido
// con partidos amistosos o ligas menos cubiertas), se devuelve null y
// el mensaje sigue funcionando igual, solo sin el nombre del goleador.
async function _fetchLastScorer(eventId) {
  try {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/123/lookuptimeline.php?id=${eventId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const timeline = data?.timeline ?? [];
    const goals = timeline.filter(t => (t.strTimeline ?? t.strEvent ?? '').toLowerCase().includes('goal'));
    const lastGoal = goals[goals.length - 1];
    if (!lastGoal) return null;
    return {
      player: lastGoal.strPlayer ?? null,
      minute: lastGoal.intTime ?? lastGoal.strTime ?? null,
    };
  } catch {
    return null;
  }
}

// ── Seguimiento casi en vivo — solo si alguno juega HOY ──
async function _pollLiveScores() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const scores = _loadLiveScores();

  for (const team of TEAMS) {
    try {
      const { last } = await _fetchLastNext(team);
      if (!last || last.dateEvent !== todayISO) continue; // no juega hoy, nada que revisar

      const key = last.idEvent;
      const newScoreStr = `${last.intHomeScore ?? ''}-${last.intAwayScore ?? ''}`;
      const prevScoreStr = scores[key];

      if (prevScoreStr !== undefined && prevScoreStr !== newScoreStr && last.intHomeScore != null) {
        const scorer = await _fetchLastScorer(key);
        const detail = scorer?.player
          ? ` (${team.icon === '🇦🇷' ? 'Arg' : team.name.slice(0, 3)}= ${scorer.player.toUpperCase()}${scorer.minute ? ` ${scorer.minute}'` : ''})`
          : '';
        addNotification({
          type: 'sports_live', category: 'deportes_vivo', icon: '⚽', color: '#EF4444',
          title: `¡GOOOOOOL!!! ⚽${detail}`,
          message: `${last.strHomeTeam} ${last.intHomeScore} - ${last.intAwayScore} ${last.strAwayTeam}`,
          data: { teamId: team.id, eventId: key },
        });
        Bus.emit(EVENTS.GOAL_SCORED, { team: team.name, colors: team.confetti });
      }
      scores[key] = newScoreStr;
    } catch (err) {
      console.warn(`[Sports] error revisando en vivo (${team.name}):`, err?.message ?? err);
    }
  }
  _saveLiveScores(scores);
}

/**
 * Llamar una vez al iniciar la app. Arranca el resumen de 4 horas y,
 * además, revisa si hay partido HOY — si lo hay, prende el sondeo cada
 * 3 minutos automáticamente mientras dure la sesión abierta.
 */
let _sportsInitialized = false;
export function initSportsNotifications() {
  if (_sportsInitialized) return; // ya está corriendo — evita duplicar el temporizador
  _sportsInitialized = true;
  checkSportsSummary();
  setInterval(checkSportsSummary, SUMMARY_INTERVAL_MS);

  _pollLiveScores(); // primer chequeo ya mismo
  _liveTimer = setInterval(_pollLiveScores, LIVE_POLL_MS);
}
