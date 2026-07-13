// ═══════════════════════════════════════════════════
// river-notifications.js — Nivel del Río Uruguay
// Estación: Concepción del Uruguay (cercana a Colón).
//
// Fuente principal: /api/rio (Vercel serverless, server-side → sin CORS)
// Fallback:         proxies CORS públicos (por si /api/rio falla)
//
// Diagnóstico desde consola: window._checkRio()
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY       = 'mila_river_notif_lastrun';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas

// ── Endpoint propio (same-origin, sin CORS) ─────────────────────────────────
const OWN_PROXY = '/api/rio';

// ── URL INA directa (para proxies externos) ─────────────────────────────────
const INA_WFS_RAW =
  'https://alerta.ina.gob.ar/geoserver/wfs' +
  '?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeName=alerta5:ultimas_alturas' +
  '&outputFormat=application/json' +
  '&count=500';

// ── Proxies CORS públicos (fallback si /api/rio no está disponible) ──────────
const PUBLIC_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

// ── Umbral manual si el INA no lo informa ───────────────────────────────────
const FALLBACK_ALERT_M = 5.50; // m — alerta amarilla Concepción del Uruguay

// ── Palabras clave para identificar la estación ─────────────────────────────
const KEYWORDS = ['concepcion', 'uruguay'];

// ────────────────────────────────────────────────────────────────────────────

async function fetchJSON(url, timeoutMs = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error('respuesta XML (no JSON)');
  return JSON.parse(text);
}

async function getInaData() {
  // 1. Endpoint propio en Vercel (sin CORS, más confiable)
  try {
    const data = await fetchJSON(OWN_PROXY, 10000);
    console.info('[Río] /api/rio OK');
    return data;
  } catch (e) {
    console.warn('[Río] /api/rio falló:', e.message, '— probando proxies públicos…');
  }

  // 2. Proxies públicos (fallback)
  for (const proxyFn of PUBLIC_PROXIES) {
    const proxyUrl = proxyFn(INA_WFS_RAW);
    try {
      const data = await fetchJSON(proxyUrl, 7000);
      console.info('[Río] proxy OK:', proxyUrl.slice(0, 50) + '…');
      return data;
    } catch (e) {
      console.warn('[Río] proxy falló:', proxyUrl.slice(0, 50) + '… —', e.message);
    }
  }

  return null;
}

function findStation(geojson) {
  const features = geojson?.features ?? [];
  if (!features.length) return null;

  const match = features.find(f => {
    const nombre = (f?.properties?.nombre ?? '').toLowerCase();
    return KEYWORDS.every(k => nombre.includes(k));
  });

  if (!match) {
    // Log estaciones disponibles para diagnóstico
    const nombres = features.slice(0, 15).map(f => f?.properties?.nombre).filter(Boolean);
    console.info('[Río] estaciones disponibles:', nombres);
    return features.find(f =>
      (f?.properties?.nombre ?? '').toLowerCase().includes('concepcion')
    ) ?? null;
  }

  return match;
}

export async function checkRiverLevel(force = false) {
  const now     = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (!force && now - lastRun < CHECK_INTERVAL_MS) return;

  console.info('[Río] consultando nivel del río Uruguay…');

  const data = await getInaData();
  if (!data) {
    console.warn('[Río] no se pudo obtener datos — /api/rio y todos los proxies fallaron.');
    return;
  }

  const feat = findStation(data);
  if (!feat) {
    console.warn('[Río] datos obtenidos pero no se encontró la estación Concepción del Uruguay.');
    return;
  }

  const props  = feat.properties ?? {};
  const nivel  = props.valor ?? props.altura ?? props.value ?? props.nivel ?? null;
  const alerta = props.nivel_alerta ?? props.alerta ?? FALLBACK_ALERT_M;
  const nombre = props.nombre ?? 'Concepción del Uruguay';

  if (nivel == null) {
    console.warn('[Río] estación encontrada pero sin dato de nivel. Props:', props);
    return;
  }

  const nivelStr = typeof nivel === 'number' ? nivel.toFixed(2) : nivel;
  const alertaStr = typeof alerta === 'number' ? alerta.toFixed(2) : alerta;
  console.info(`[Río] ✓ ${nombre}: ${nivelStr} m (alerta: ${alertaStr} m)`);

  const enAlerta = nivel >= alerta;

  addNotification({
    type:     'river_level',
    category: 'rio',
    icon:     enAlerta ? '🌊' : '💧',
    color:    enAlerta ? '#EF4444' : '#0EA5E9',
    title:    enAlerta
      ? '⚠️ Río Uruguay por encima del nivel de alerta'
      : 'Nivel del Río Uruguay',
    message:  `${nombre}: ${nivelStr} m (alerta: ${alertaStr} m)`,
    data:     { nivel, alerta, nombre },
  });

  localStorage.setItem(LASTRUN_KEY, String(now));
}

let _initialized = false;
export function initRiverNotifications() {
  if (_initialized) return;
  _initialized = true;
  checkRiverLevel();
  setInterval(() => checkRiverLevel(), CHECK_INTERVAL_MS);
}

// Diagnóstico desde consola:
//   _checkRio()       → fuerza check inmediato
//   _checkRio(false)  → respeta cooldown de 4 horas
if (typeof window !== 'undefined') {
  window._checkRio = (force = true) => checkRiverLevel(force);
}
