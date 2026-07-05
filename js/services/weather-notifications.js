// ═══════════════════════════════════════════════════
// weather-notifications.js — Aviso de clima diario
// Usa Open-Meteo (open-meteo.com): API gratis de verdad,
// sin necesidad de clave ni registro — no requiere que
// hagas nada de tu lado, ni ahora ni en el futuro.
//
// Corre una vez por día (mismo criterio que feriados y
// el recordatorio automático de saldo pendiente).
//
// Cubre 2 ubicaciones fijas (San José/Colón y Rosario) —
// cada notificación aclara de qué ciudad es, para no
// confundirse cuando estás viajando entre las dos.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY = 'mila_weather_notif_lastrun';

const LOCATIONS = [
  { key: 'colon',   label: 'SAN JOSÉ (COLÓN) | ENTRE RÍOS', lat: -32.2124, lon: -58.2191 },
  { key: 'rosario', label: 'ROSARIO | SANTA FE',            lat: -32.9468, lon: -60.6393 },
];

// Códigos de clima (estándar WMO, los mismos que usa Open-Meteo)
const WEATHER_CODES = {
  0: ['☀️', 'Despejado'], 1: ['🌤️', 'Mayormente despejado'], 2: ['⛅', 'Parcialmente nublado'], 3: ['☁️', 'Nublado'],
  45: ['🌫️', 'Niebla'], 48: ['🌫️', 'Niebla con escarcha'],
  51: ['🌦️', 'Llovizna leve'], 53: ['🌦️', 'Llovizna'], 55: ['🌦️', 'Llovizna intensa'],
  61: ['🌧️', 'Lluvia leve'], 63: ['🌧️', 'Lluvia'], 65: ['🌧️', 'Lluvia intensa'],
  71: ['🌨️', 'Nevada leve'], 73: ['🌨️', 'Nevada'], 75: ['🌨️', 'Nevada intensa'],
  80: ['🌦️', 'Chubascos leves'], 81: ['🌧️', 'Chubascos'], 82: ['⛈️', 'Chubascos fuertes'],
  95: ['⛈️', 'Tormenta'], 96: ['⛈️', 'Tormenta con granizo'], 99: ['⛈️', 'Tormenta fuerte con granizo'],
};

function _describeCode(code) {
  return WEATHER_CODES[code] ?? ['🌡️', 'Sin datos'];
}

async function _fetchLocationWeather(loc) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=America%2FArgentina%2FBuenos_Aires`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const tempNow = Math.round(data.current?.temperature_2m ?? 0);
  const code    = data.current?.weather_code;
  const [icon, label] = _describeCode(code);
  const tMax     = Math.round(data.daily?.temperature_2m_max?.[0] ?? tempNow);
  const tMin     = Math.round(data.daily?.temperature_2m_min?.[0] ?? tempNow);
  const rainProb = data.daily?.precipitation_probability_max?.[0];

  let message = `📍 ${loc.label}\n${label} · ${tempNow}°C ahora (mín ${tMin}° / máx ${tMax}°)`;
  if (rainProb != null && rainProb >= 40) message += `\n☔ ${rainProb}% de probabilidad de lluvia`;

  return { icon, message, data: { code, tempNow, tMax, tMin, rainProb } };
}

/**
 * Trae el clima de hoy de las 2 ubicaciones fijas y genera una
 * notificación por cada una, una vez por día. Si alguna falla (sin
 * internet, servicio caído, etc.) no rompe nada — esa ubicación
 * puntual no avisa ese día, en silencio, sin afectar a la otra.
 */
export async function checkTodayWeather() {
  const todayISO = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(LASTRUN_KEY) === todayISO) return; // ya se avisó hoy

  let anySucceeded = false;
  for (const loc of LOCATIONS) {
    try {
      const { icon, message, data } = await _fetchLocationWeather(loc);
      addNotification({
        type: 'weather_today',
        category: 'clima',
        icon,
        color: '#0EA5E9',
        title: `Clima de hoy — ${loc.label}`,
        message,
        data: { location: loc.key, ...data },
      });
      anySucceeded = true;
    } catch (err) {
      console.warn(`[Weather] no se pudo obtener el clima de ${loc.label}:`, err?.message ?? err);
    }
  }
  if (anySucceeded) localStorage.setItem(LASTRUN_KEY, todayISO);
}
