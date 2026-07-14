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

  const features = data?.features ?? [];
  if (!features.length) { console.warn('[Río] sin features'); return; }

  // Estaciones de interés
  // No hay estación específica de Colón — Concepción del Uruguay es la más cercana (15 km mismo río).
  // "Uruguay" es una estación general del río Uruguay incluida como referencia secundaria.
  const STATIONS = [
    { key: 'concepcion', label: 'Colón / Concepción del Uruguay' },
    { key: 'uruguay',    label: 'Río Uruguay (est. Uruguay)'     },
  ];

  const today   = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  // Extraer nivel de hoy.
  // El INA puede entregar el valor de tres formas:
  //   1. props.valor = número o string numérico
  //   2. props.valor = objeto { "YYYY-MM-DD": "X.XX", ... }   ← caso real observado
  //   3. props["YYYY-MM-DD"] = "X.XX"  (claves de fecha directas en props)
  const getFromDateObj = obj => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj[today] != null) return parseFloat(obj[today]);
    const dk = Object.keys(obj).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().reverse();
    return dk.length > 0 ? parseFloat(obj[dk[0]]) : null;
  };

  const getNivel = props => {
    const std = props.valor ?? props.altura ?? props.nivel ?? props.value;
    // Caso 1: campo numérico directo
    if (std != null && typeof std !== 'object' && !isNaN(parseFloat(std))) return parseFloat(std);
    // Caso 2: props.valor es un objeto con fechas
    if (std != null && typeof std === 'object') {
      const v = getFromDateObj(std);
      if (v != null && !isNaN(v)) return v;
    }
    // Caso 3: claves de fecha directas en props
    const v2 = getFromDateObj(props);
    if (v2 != null && !isNaN(v2)) return v2;
    return null;
  };

  const found = [];
  for (const st of STATIONS) {
    const feat = features.find(f =>
      (f?.properties?.nombre ?? '').toLowerCase().includes(st.key)
    );
    if (feat) {
      const nivel = getNivel(feat.properties);
      if (nivel != null && !isNaN(nivel)) {
        found.push({ label: st.label, nivel });
        console.info(`[Río] ✓ ${st.label}: ${nivel.toFixed(2)} m`);
      }
    } else {
      console.info(`[Río] "${st.key}" no encontrada`);
    }
  }

  if (found.length === 0) {
    const todos = features.map(f => f?.properties?.nombre).filter(Boolean);
    console.info('[Río] estaciones disponibles:', todos);
    return;
  }

  const enAlerta = found.some(s => s.nivel >= FALLBACK_ALERT_M);
  const nivelLines = found.map(s => `${s.label}: ${s.nivel.toFixed(2)} m`).join(' · ');
  const msgDate    = today.split('-').reverse().join('/') + ' ' + nowTime;

  addNotification({
    type:     'river_level',
    category: 'rio',
    icon:     enAlerta ? '🌊' : '💧',
    color:    enAlerta ? '#EF4444' : '#0EA5E9',
    title:    enAlerta ? '⚠️ Río Uruguay — Alerta' : '💧 Río Uruguay',
    message:  `${nivelLines}\n${msgDate} · alerta: ${FALLBACK_ALERT_M.toFixed(2)} m`,
    data:     { found, alerta: FALLBACK_ALERT_M },
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
