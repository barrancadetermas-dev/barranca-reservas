// ═══════════════════════════════════════════════════
// river-notifications.js — Nivel del Río Uruguay
// Estación: Concepción del Uruguay (la más cercana a Colón).
//
// APIs (en orden de preferencia):
//  1. INA REST JSON (más liviana y directa)
//  2. INA WFS GeoServer (más robusta pero más lenta)
//
// El localStorage cooldown se puede forzar desde la consola:
//   localStorage.removeItem('mila_river_notif_lastrun'); checkRiverLevel();
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY      = 'mila_river_notif_lastrun';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas

// Nombres alternativos para la estación del INA
const STATION_NAMES = [
  'Concepcion del Uruguay',
  'Concepción del Uruguay',
  'CONCEPCION DEL URUGUAY',
  'Concepcion',
];

// ── API 1: INA REST (más directa) ──────────────────────────────────────────
// Endpoint público, no requiere clave.
// Devuelve JSON con array de estaciones y sus últimas lecturas.
const INA_REST_URL = 'https://alerta.ina.gob.ar/a/series/?tipo=puntual&nombre=Concepcion%20del%20Uruguay&fuentes_id=1';

// ── API 2: INA WFS (fallback) ───────────────────────────────────────────────
const INA_WFS_URL  = 'https://alerta.ina.gob.ar/geoserver/wfs'
  + '?service=WFS&version=1.0.0&request=GetFeature'
  + '&typeName=alerta5:ultimas_alturas'
  + '&outputFormat=application/json'
  + "&CQL_FILTER=nombre%20ILIKE%20'%25Concepcion%20del%20Uruguay%25'";

// ── Umbral de alerta manual (metros) cuando la API no lo informa ───────────
// Concepción del Uruguay: alerta amarilla ≈ 5.50 m, naranja ≈ 7.00 m, roja ≈ 9.00 m
const FALLBACK_ALERT_M = 5.50;

// ────────────────────────────────────────────────────────────────────────────

async function tryInaRest() {
  const res  = await fetch(INA_REST_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`INA REST HTTP ${res.status}`);
  const data = await res.json();

  // Estructura esperada: array de series con .estacion y .ultima_obs
  const series = Array.isArray(data) ? data : (data?.series ?? data?.data ?? []);
  if (!series.length) {
    console.warn('[Río REST] respuesta vacía:', data);
    return null;
  }

  // Buscar la estación por nombre
  let found = null;
  for (const s of series) {
    const nombre = s?.nombre ?? s?.estacion?.nombre ?? s?.estacion ?? '';
    if (STATION_NAMES.some(n => nombre.toLowerCase().includes(n.toLowerCase().split(' ')[0]))) {
      found = s;
      break;
    }
  }
  if (!found) found = series[0]; // fallback: primera de la lista

  // Extraer nivel — múltiples nombres de campo posibles
  const obs   = found?.ultima_obs ?? found?.last_obs ?? found?.obs ?? found;
  const nivel = obs?.valor ?? obs?.altura ?? obs?.value ?? obs?.nivel ?? null;
  const alerta = obs?.nivel_alerta ?? found?.nivel_alerta ?? null;
  const nombre = found?.nombre ?? found?.estacion?.nombre ?? STATION_NAMES[0];

  return { nivel, alerta, nombre, fuente: 'REST' };
}

async function tryInaWfs() {
  const res  = await fetch(INA_WFS_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`INA WFS HTTP ${res.status}`);
  const data = await res.json();
  const feat  = data?.features?.[0]?.properties;
  if (!feat) {
    console.warn('[Río WFS] sin features:', data);
    return null;
  }
  const nivel  = feat.valor  ?? feat.altura ?? feat.value  ?? null;
  const alerta = feat.nivel_alerta ?? feat.alerta ?? null;
  const nombre = feat.nombre ?? STATION_NAMES[0];
  return { nivel, alerta, nombre, fuente: 'WFS' };
}

export async function checkRiverLevel(force = false) {
  const now     = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (!force && now - lastRun < CHECK_INTERVAL_MS) return;

  let result = null;
  try {
    result = await tryInaRest();
    console.info('[Río] API REST OK:', result);
  } catch (errRest) {
    console.warn('[Río] REST falló, intentando WFS:', errRest?.message);
    try {
      result = await tryInaWfs();
      console.info('[Río] API WFS OK:', result);
    } catch (errWfs) {
      console.warn('[Río] WFS también falló:', errWfs?.message);
    }
  }

  if (!result) {
    console.warn('[Río] ambas APIs fallaron — sin notificación de nivel.');
    return;
  }

  const { nivel, alerta, nombre, fuente } = result;

  if (nivel == null) {
    console.warn('[Río] se obtuvo respuesta pero sin dato de nivel. Estructura recibida:', result);
    return;
  }

  const umbral   = alerta ?? FALLBACK_ALERT_M;
  const enAlerta = nivel >= umbral;

  addNotification({
    type:     'river_level',
    category: 'rio',
    icon:     enAlerta ? '🌊' : '💧',
    color:    enAlerta ? '#EF4444' : '#0EA5E9',
    title:    enAlerta
      ? '⚠️ Río Uruguay por encima del nivel de alerta'
      : 'Nivel del Río Uruguay',
    message:  `${nombre}: ${nivel.toFixed ? nivel.toFixed(2) : nivel} m`
      + (umbral != null ? ` (alerta: ${typeof umbral === 'number' ? umbral.toFixed(2) : umbral} m)` : '')
      + ` · Fuente: INA ${fuente}`,
    data: { nivel, alerta: umbral, nombre, fuente },
  });

  localStorage.setItem(LASTRUN_KEY, String(now));
}

let _riverInitialized = false;
export function initRiverNotifications() {
  if (_riverInitialized) return;
  _riverInitialized = true;
  // Primer check inmediato (respeta el cooldown salvo que force=true)
  checkRiverLevel();
  setInterval(() => checkRiverLevel(), CHECK_INTERVAL_MS);
}

// Exponer en window para diagnóstico desde consola:
// window._checkRio() → fuerza check ignorando cooldown
// window._checkRio(false) → respeta cooldown
if (typeof window !== 'undefined') {
  window._checkRio = (force = true) => checkRiverLevel(force);
}
