// ═══════════════════════════════════════════════════
// weather-notifications.js — Pronóstico de 7 días
// Usa Open-Meteo (open-meteo.com): API gratis de verdad,
// sin necesidad de clave ni registro — no requiere que
// hagas nada de tu lado, ni ahora ni en el futuro.
//
// Corre una vez por día (mismo criterio que feriados y
// el recordatorio automático de saldo pendiente), pero en
// vez de mostrar solo el clima de HOY, arma un resumen de
// los próximos 7 días (hoy + 6 más) en una sola notificación
// por ubicación — así con un vistazo ves toda la semana.
//
// Cubre 2 ubicaciones fijas (San José/Colón y Rosario) —
// cada notificación aclara de qué ciudad es, para no
// confundirse cuando estás viajando entre las dos.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY = 'mila_weather_notif_lastrun';
const FORECAST_DAYS = 7;

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

const DAY_NAMES = ['Hoy', 'Mañana'];

async function _fetchLocationForecast(loc) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&forecast_days=${FORECAST_DAYS}` +
    `&timezone=America%2FArgentina%2FBuenos_Aires`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const daily = data.daily;
  if (!daily?.time?.length) throw new Error('sin datos diarios');

  const currentCode = data.current?.weather_code;
  const [mainIcon] = _describeCode(currentCode);

  const lines = daily.time.slice(0, FORECAST_DAYS).map((dateISO, i) => {
    const [icon, label] = _describeCode(daily.weather_code?.[i]);
    const tMax = Math.round(daily.temperature_2m_max?.[i] ?? 0);
    const tMin = Math.round(daily.temperature_2m_min?.[i] ?? 0);
    const rain = daily.precipitation_probability_max?.[i];
    const dayLabel = DAY_NAMES[i] ?? new Date(dateISO + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short' });
    const rainTxt = rain != null && rain >= 40 ? ` ☔${rain}%` : '';
    return `${icon} ${dayLabel}: ${tMin}°/${tMax}° — ${label}${rainTxt}`;
  });

  const message = `📍 ${loc.label}\n${lines.join('\n')}`;
  return { icon: mainIcon, message, data: { days: daily.time.length } };
}

/**
 * Trae el pronóstico de 7 días de las 2 ubicaciones fijas y genera una
 * notificación por cada una, una vez por día. Si alguna falla (sin
 * internet, servicio caído, etc.) no rompe nada — esa ubicación
 * puntual no avisa ese día, en silencio, sin afectar a la otra.
 */
let _weatherRunning = false;
export async function checkTodayWeather(force = false) {
  if (_weatherRunning) return; // ya está corriendo — evita duplicar si se llama 2 veces seguidas
  const todayISO = new Date().toISOString().slice(0, 10);
  if (!force && localStorage.getItem(LASTRUN_KEY) === todayISO) return; // ya se avisó hoy (salvo que sea forzado)
  _weatherRunning = true;

  try {
    let anySucceeded = false;
    for (const loc of LOCATIONS) {
      try {
        const { icon, message, data } = await _fetchLocationForecast(loc);
        addNotification({
          type: 'weather_forecast',
          category: 'clima',
          icon,
          color: '#0EA5E9',
          title: `Pronóstico 7 días — ${loc.label}`,
          message,
          data: { location: loc.key, ...data },
        });
        anySucceeded = true;
      } catch (err) {
        console.warn(`[Weather] no se pudo obtener el pronóstico de ${loc.label}:`, err?.message ?? err);
      }
    }
    if (anySucceeded) localStorage.setItem(LASTRUN_KEY, todayISO);
  } finally {
    _weatherRunning = false;
  }
}
