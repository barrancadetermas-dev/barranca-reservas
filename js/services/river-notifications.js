// ═══════════════════════════════════════════════════
// river-notifications.js — Nivel del Río Uruguay
// Estación: Concepción del Uruguay (cercana a Colón).
//
// Problema conocido: las APIs del INA bloquean CORS desde
// el browser. Solución: se usa un proxy CORS público.
//
// Proxy primario:  corsproxy.io
// Proxy fallback:  allorigins.win
//
// Desde consola: window._checkRio() para forzar check.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY       = 'mila_river_notif_lastrun';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas

// ── URLs INA (sin proxy) ────────────────────────────────────────────────────
const INA_WFS_RAW =
  'https://alerta.ina.gob.ar/geoserver/wfs' +
  '?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeName=alerta5:ultimas_alturas' +
  '&outputFormat=application/json' +
  '&count=500';

// ── Proxies CORS (en orden de preferencia) ──────────────────────────────────
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

// ── Umbral de alerta manual si la API no lo informa ────────────────────────
// Concepción del Uruguay: alerta amarilla ≈ 5.50 m
const FALLBACK_ALERT_M = 5.50;

// ── Nombres para buscar la estación ────────────────────────────────────────
const KEYWORDS = ['concepcion', 'uruguay'];

// ────────────────────────────────────────────────────────────────────────────

async function fetchWithProxy(rawUrl) {
  for (const proxyFn of PROXIES) {
    const proxyUrl = proxyFn(rawUrl);
    try {
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) {
        console.warn(`[Río] proxy → HTTP ${res.status}:`, proxyUrl.slice(0, 55) + '…');
        continue;
      }
      const text = await res.text();
      if (text.trimStart().startsWith('<')) {
        console.warn('[Río] respuesta XML (error WFS), próximo proxy…');
        continue;
      }
      const data = JSON.parse(text);
      console.info('[Río] proxy OK:', proxyUrl.slice(0, 55) + '…');
      return data;
    } catch (err) {
      console.warn(`[Río] proxy falló (${err?.message?.slice(0,40)}):`, proxyUrl.slice(0, 55) + '…');
    }
  }
  return null;
}

// ── Buscar la estación Concepción del Uruguay en el GeoJSON ─────────────────
function findStation(geojson) {
  const features = geojson?.features ?? [];
  if (!features.length) return null;

  // Buscar por nombre
  const match = features.find(f => {
    const nombre = (f?.properties?.nombre ?? '').toLowerCase();
    return KEYWORDS.every(k => nombre.includes(k));
  });

  // Si no hay match exacto, loguear las estaciones disponibles para diagnóstico
  if (!match) {
    const nombres = features.slice(0, 20).map(f => f?.properties?.nombre).filter(Boolean);
    console.info('[Río] estaciones disponibles (primeras 20):', nombres);
    // Intentar con solo "concepcion"
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

  const data = await fetchWithProxy(INA_WFS_RAW);

  if (!data) {
    console.warn('[Río] ambos proxies fallaron — sin datos de nivel.');
    return;
  }

  const feat = findStation(data);
  if (!feat) {
    console.warn('[Río] no se encontró la estación Concepción del Uruguay en la respuesta.');
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

  console.info(`[Río] ✓ ${nombre}: ${nivel} m (alerta: ${alerta} m)`);

  const enAlerta = nivel >= alerta;

  addNotification({
    type:     'river_level',
    category: 'rio',
    icon:     enAlerta ? '🌊' : '💧',
    color:    enAlerta ? '#EF4444' : '#0EA5E9',
    title:    enAlerta
      ? '⚠️ Río Uruguay por encima del nivel de alerta'
      : 'Nivel del Río Uruguay',
    message: `${nombre}: ${typeof nivel === 'number' ? nivel.toFixed(2) : nivel} m`
      + ` (alerta: ${typeof alerta === 'number' ? alerta.toFixed(2) : alerta} m)`,
    data: { nivel, alerta, nombre },
  });

  localStorage.setItem(LASTRUN_KEY, String(now));
}

let _riverInitialized = false;
export function initRiverNotifications() {
  if (_riverInitialized) return;
  _riverInitialized = true;
  checkRiverLevel();
  setInterval(() => checkRiverLevel(), CHECK_INTERVAL_MS);
}

// Diagnóstico desde consola del navegador:
//   _checkRio()       → fuerza check ahora
//   _checkRio(false)  → respeta cooldown de 4 horas
if (typeof window !== 'undefined') {
  window._checkRio = (force = true) => checkRiverLevel(force);
}
