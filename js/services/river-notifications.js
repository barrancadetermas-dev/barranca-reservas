// ═══════════════════════════════════════════════════
// river-notifications.js — Nivel del Río Uruguay
// Estación: Concepción del Uruguay (cercana a Colón).
//
// Fuente: /api/rio (Vercel serverless — sin CORS)
// Diagnóstico: window._checkRio() desde consola
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY       = 'mila_river_notif_lastrun';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas
const FALLBACK_ALERT_M  = 5.50; // alerta amarilla Concepción del Uruguay
const KEYWORDS          = ['concepcion', 'uruguay'];

async function getInaData() {
  try {
    const res = await fetch('/api/rio', { signal: AbortSignal.timeout(15000) });
    const data = await res.json();

    if (!res.ok) {
      console.warn('[Río] /api/rio error', res.status + ':',
        JSON.stringify(data?.endpoints_tried ?? data, null, 2));
      return null;
    }

    console.info('[Río] /api/rio OK →', res.headers.get('X-INA-Source') ?? 'fuente desconocida');
    return data;
  } catch (err) {
    console.warn('[Río] /api/rio excepción:', err?.message);
    return null;
  }
}

function findStation(geojson) {
  const features = geojson?.features ?? [];
  if (!features.length) {
    console.warn('[Río] GeoJSON sin features');
    return null;
  }

  // Buscar por nombre — solo "concepcion" alcanza (el INA no incluye "uruguay" en el nombre)
  const match = features.find(f => {
    const nombre = (f?.properties?.nombre ?? '').toLowerCase();
    return nombre.includes('concepcion');
  });

  if (!match) {
    const nombres = features.slice(0, 20).map(f => f?.properties?.nombre).filter(Boolean);
    console.info('[Río] estaciones disponibles:', nombres);
  }

  return match ?? null;
}

// Extraer el nivel del día: el INA devuelve propiedades con clave fecha "YYYY-MM-DD"
function extractNivel(props) {
  // Primero intentar campos estándar
  const std = props.valor ?? props.altura ?? props.nivel ?? props.value;
  if (std != null && !isNaN(parseFloat(std))) return parseFloat(std);

  // Si no hay campo estándar, buscar la fecha de hoy o la más reciente
  const today = new Date().toISOString().slice(0, 10);
  const dateKeys = Object.keys(props)
    .filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort()
    .reverse(); // más reciente primero

  // Preferir hoy, sino la fecha más cercana disponible
  const key = dateKeys.includes(today) ? today : dateKeys[0];
  if (key) return parseFloat(props[key]);

  return null;
}

export async function checkRiverLevel(force = false) {
  const now     = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (!force && now - lastRun < CHECK_INTERVAL_MS) return;

  console.info('[Río] consultando…');
  const data = await getInaData();
  if (!data) return;

  const feat = findStation(data);
  if (!feat) {
    console.warn('[Río] no se encontró la estación Concepción del Uruguay');
    return;
  }

  const props    = feat.properties ?? {};
  const nivel    = extractNivel(props);
  const alerta   = props.nivel_alerta ?? props.alerta ?? FALLBACK_ALERT_M;
  const nombre   = props.nombre ?? 'Concepción del Uruguay';

  if (nivel == null || isNaN(nivel)) {
    console.warn('[Río] estación encontrada pero sin nivel. Props:', Object.keys(props));
    return;
  }

  // Próximos días (pronóstico si el INA los incluye)
  const today   = new Date().toISOString().slice(0, 10);
  const dateKeys = Object.keys(props).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  const futureKeys = dateKeys.filter(k => k > today).slice(0, 3);
  const forecastStr = futureKeys.length > 0
    ? ' · próx: ' + futureKeys.map(k => `${k.slice(5)}: ${parseFloat(props[k]).toFixed(2)}m`).join(', ')
    : '';

  const nivelStr  = nivel.toFixed(2);
  const alertaStr = typeof alerta === 'number' ? alerta.toFixed(2) : alerta;
  console.info(`[Río] ✓ ${nombre}: ${nivelStr} m (alerta: ${alertaStr} m)${forecastStr}`);

  const enAlerta = nivel >= alerta;
  addNotification({
    type:     'river_level',
    category: 'rio',
    icon:     enAlerta ? '🌊' : '💧',
    color:    enAlerta ? '#EF4444' : '#0EA5E9',
    title:    enAlerta
      ? '⚠️ Río Uruguay por encima del nivel de alerta'
      : 'Nivel del Río Uruguay',
    message:  `${nombre}: ${nivelStr} m (alerta: ${alertaStr} m)${forecastStr}`,
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

if (typeof window !== 'undefined') {
  // _checkRio()      → fuerza check ahora
  // _checkRio(false) → respeta cooldown
  window._checkRio = (force = true) => checkRiverLevel(force);

  // _debugRio() → muestra la respuesta cruda del endpoint
  window._debugRio = async () => {
    const res = await fetch('/api/rio');
    const data = await res.json();
    console.log('[Río debug] status:', res.status, 'source:', res.headers.get('X-INA-Source'));
    console.log('[Río debug] data:', data);
    return data;
  };
}
