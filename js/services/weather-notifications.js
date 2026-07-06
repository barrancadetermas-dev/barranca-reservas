// ═══════════════════════════════════════════════════
// weather-notifications.js — Pronóstico de 3 días, con
// onda (una frase graciosa según el clima del día).
// Usa Open-Meteo (open-meteo.com): API gratis de verdad,
// sin necesidad de clave ni registro.
//
// Corre una vez por día (o forzado, cada vez que se abren
// los Avisos), y arma un resumen de HOY + 2 días más — así
// no queda pesado de leer.
//
// Cubre 2 ubicaciones — San José/Colón y Rosario — pero
// cada una se puede prender/apagar por separado desde el
// panel (guardado acá mismo, en localStorage), para el caso
// de estar viajando entre las dos y solo querer la de donde
// estás parado.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY  = 'mila_weather_notif_lastrun';
const LOC_PREFS_KEY = 'mila_weather_locations_v1';
const FORECAST_DAYS = 3;

const LOCATIONS = [
  { key: 'colon',   label: 'SAN JOSÉ (COLÓN) | ENTRE RÍOS', lat: -32.2124, lon: -58.2191 },
  { key: 'rosario', label: 'ROSARIO | SANTA FE',            lat: -32.9468, lon: -60.6393 },
];

export function getWeatherLocations() { return LOCATIONS.map(l => ({ key: l.key, label: l.label })); }

function _loadLocationPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOC_PREFS_KEY)) ?? {};
    const merged = {};
    LOCATIONS.forEach(l => { merged[l.key] = saved[l.key] ?? true; }); // las 2 prendidas por default
    return merged;
  } catch {
    const all = {};
    LOCATIONS.forEach(l => { all[l.key] = true; });
    return all;
  }
}
let _locationPrefs = _loadLocationPrefs();
export function getLocationPrefs() { return { ..._locationPrefs }; }
export function setLocationEnabled(key, enabled) {
  _locationPrefs[key] = enabled;
  try { localStorage.setItem(LOC_PREFS_KEY, JSON.stringify(_locationPrefs)); } catch {}
}

// Códigos de clima (estándar WMO, los mismos que usa Open-Meteo) — cada
// uno con 2-3 frases con onda, se elige una al azar cada vez.
const WEATHER_CODES = {
  0: { icon: '☀️', label: 'Despejado', phrases: ['Está para la pileta 🏊', 'Día de mate afuera, ni lo dudes', 'Protector solar y a disfrutar'] },
  1: { icon: '🌤️', label: 'Mayormente despejado', phrases: ['Está para la pileta 🏊', 'Día de mate afuera, ni lo dudes', 'Protector solar y a disfrutar'] },
  2: { icon: '⛅', label: 'Parcialmente nublado', phrases: ['Día comodín — ni para pileta ni para paraguas', 'Buen día para las termas, sin quemarte de sol', 'Ideal para una caminata por Colón'] },
  3: { icon: '☁️', label: 'Nublado', phrases: ['Día comodín — ni para pileta ni para paraguas', 'Buen día para las termas, sin quemarte de sol', 'Ideal para una caminata por Colón'] },
  45: { icon: '🌫️', label: 'Niebla', phrases: ['Ojo con la ruta, visibilidad bajita', 'Día misterioso, bien de película', 'Si salís temprano, luces prendidas'] },
  48: { icon: '🌫️', label: 'Niebla con escarcha', phrases: ['Ojo con la ruta, visibilidad bajita', 'Día misterioso, bien de película', 'Si salís temprano, luces prendidas'] },
  51: { icon: '🌦️', label: 'Llovizna leve', phrases: ['Paraguas por las dudas, nada grave', 'Buen día para las termas techadas', 'No dejes la ropa colgada afuera'] },
  53: { icon: '🌦️', label: 'Llovizna', phrases: ['Paraguas por las dudas, nada grave', 'Buen día para las termas techadas', 'No dejes la ropa colgada afuera'] },
  55: { icon: '🌦️', label: 'Llovizna intensa', phrases: ['Paraguas por las dudas, nada grave', 'Buen día para las termas techadas', 'No dejes la ropa colgada afuera'] },
  61: { icon: '🌧️', label: 'Lluvia leve', phrases: ['¡Entrá la ropa, ya! 🏃💨', 'Día de peli, manta y mate', 'Las termas cubiertas son la posta hoy'] },
  63: { icon: '🌧️', label: 'Lluvia', phrases: ['¡Entrá la ropa, ya! 🏃💨', 'Día de peli, manta y mate', 'Las termas cubiertas son la posta hoy'] },
  65: { icon: '🌧️', label: 'Lluvia intensa', phrases: ['¡Entrá la ropa, ya! 🏃💨', 'Día de peli, manta y mate', 'Las termas cubiertas son la posta hoy'] },
  71: { icon: '🌨️', label: 'Nevada leve', phrases: ['¿Nieve en Entre Ríos?? Mandame la foto posta', 'Raro total, pero abrigate igual'] },
  73: { icon: '🌨️', label: 'Nevada', phrases: ['¿Nieve en Entre Ríos?? Mandame la foto posta', 'Raro total, pero abrigate igual'] },
  75: { icon: '🌨️', label: 'Nevada intensa', phrases: ['¿Nieve en Entre Ríos?? Mandame la foto posta', 'Raro total, pero abrigate igual'] },
  80: { icon: '🌦️', label: 'Chubascos leves', phrases: ['¡Entrá la ropa, ya! 🏃💨', 'Día de peli, manta y mate'] },
  81: { icon: '🌧️', label: 'Chubascos', phrases: ['¡Entrá la ropa, ya! 🏃💨', 'Día de peli, manta y mate'] },
  82: { icon: '⛈️', label: 'Chubascos fuertes', phrases: ['Ojo con sombrillas y reposeras sueltas', 'Mejor cancelá los planes al aire libre', 'Truenos afuera, asado adentro'] },
  95: { icon: '⛈️', label: 'Tormenta', phrases: ['Ojo con sombrillas y reposeras sueltas', 'Mejor cancelá los planes al aire libre', 'Truenos afuera, asado adentro'] },
  96: { icon: '⛈️', label: 'Tormenta con granizo', phrases: ['Ojo con sombrillas y reposeras sueltas', 'Mejor cancelá los planes al aire libre', 'Truenos afuera, asado adentro'] },
  99: { icon: '⛈️', label: 'Tormenta fuerte con granizo', phrases: ['Ojo con sombrillas y reposeras sueltas', 'Mejor cancelá los planes al aire libre', 'Truenos afuera, asado adentro'] },
};

function _describeCode(code) {
  return WEATHER_CODES[code] ?? { icon: '🌡️', label: 'Sin datos', phrases: [] };
}
function _randomPhrase(phrases) {
  return phrases.length ? phrases[Math.floor(Math.random() * phrases.length)] : '';
}

// Frase por TEMPERATURA — independiente de la condición (lluvia/sol/etc).
// Las dos pueden aparecer juntas (ej: lluvia + frío = "entrá la ropa" Y
// "fresco pa' chomba"), porque son cosas distintas que igual importan.
function _tempPhrase(tMax) {
  if (tMax <= 5)  return { icon: '🥶', phrase: _randomPhrase(['¡Está fresco pa\' chomba!', 'Frío que cala los huesos, abrigate bien', 'Día de campera gruesa, no la subestimes']) };
  if (tMax <= 10) return { icon: '🧊', phrase: _randomPhrase(['Fresquito — campera aunque sea', 'Bufanda no viene mal hoy']) };
  if (tMax >= 33) return { icon: '🥵', phrase: _randomPhrase(['¡CALORAZO!', 'Ventilador a full, ni lo dudes', 'Hidratate que hoy aprieta']) };
  if (tMax >= 28) return { icon: '😅', phrase: _randomPhrase(['Empieza a apretar el calor', 'Buen día de pileta, aprovechá']) };
  return null; // temperatura normal, no hace falta ninguna frase extra
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
  const mainInfo = _describeCode(currentCode);

  let phrase = '';
  let tempPhraseInfo = null;
  const lines = daily.time.slice(0, FORECAST_DAYS).map((dateISO, i) => {
    const info = _describeCode(daily.weather_code?.[i]);
    const tMax = Math.round(daily.temperature_2m_max?.[i] ?? 0);
    const tMin = Math.round(daily.temperature_2m_min?.[i] ?? 0);
    const rain = daily.precipitation_probability_max?.[i];
    const dayLabel = DAY_NAMES[i] ?? new Date(dateISO + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short' });
    const rainTxt = rain != null && rain >= 40 ? ` ☔${rain}%` : '';
    if (i === 0) {
      phrase = _randomPhrase(info.phrases); // frase por condición (lluvia/sol/etc), del día de hoy
      tempPhraseInfo = _tempPhrase(tMax);   // frase por temperatura, independiente — las 2 pueden aparecer juntas
    }
    const tempIcon = i === 0 && tempPhraseInfo ? tempPhraseInfo.icon + ' ' : '';
    return `${info.icon} ${dayLabel}: ${tempIcon}${tMin}°/${tMax}° — ${info.label}${rainTxt}`;
  });

  const extraLines = [phrase, tempPhraseInfo?.phrase].filter(Boolean).map(p => `<em>${p}</em>`);
  const message = `📍 ${loc.label}\n${lines.join('\n')}${extraLines.length ? `\n\n${extraLines.join('\n')}` : ''}`;
  return { icon: mainInfo.icon, message, data: { days: daily.time.length } };
}

/**
 * Trae el pronóstico de 3 días de las ubicaciones habilitadas y genera
 * una notificación por cada una. `force=true` salta el límite de una
 * vez por día (se usa al abrir el panel de Avisos, para que siempre se
 * vea fresco). Si alguna ubicación falla no rompe nada — esa puntual no
 * avisa, en silencio, sin afectar a la otra.
 */
let _weatherRunning = false;
export async function checkTodayWeather(force = false) {
  if (_weatherRunning) return;
  const todayISO = new Date().toISOString().slice(0, 10);
  if (!force && localStorage.getItem(LASTRUN_KEY) === todayISO) return;
  _weatherRunning = true;

  try {
    let anySucceeded = false;
    for (const loc of LOCATIONS) {
      if (_locationPrefs[loc.key] === false) continue; // ubicación apagada, se la saltea
      try {
        const { icon, message, data } = await _fetchLocationForecast(loc);
        addNotification({
          type: 'weather_forecast',
          category: 'clima',
          icon,
          color: '#0EA5E9',
          title: `Pronóstico — ${loc.label}`,
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
