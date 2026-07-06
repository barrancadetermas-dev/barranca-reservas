// ═══════════════════════════════════════════════════
// news-notifications.js — Noticias de Perfil.com (RSS),
// por categoría: Política, Internacionales, Deportes,
// Espectáculos.
//
// AVISO: a diferencia de las otras fuentes (clima, dólar,
// fútbol, F1), esta es la primera que usa RSS en vez de
// una API pensada para navegador — es posible que el sitio
// bloquee la consulta directa desde acá (CORS). Si eso pasa,
// no rompe nada — simplemente no vas a ver notificaciones de
// esta categoría, en silencio, hasta que lo confirmemos.
//
// Cada 3 horas, se avisa con el Top 3 de UNA categoría por
// vez (rotando entre las 4) — así no llegan los 12 títulos
// juntos de golpe.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY   = 'mila_news_notif_lastrun';
const ROTATION_KEY  = 'mila_news_last_category';
const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 horas
const TOP_N = 3;

const CATEGORIES = [
  { key: 'politica',      label: 'Política',       icon: '🏛️', url: 'https://www.perfil.com/feed/politica' },
  { key: 'internacionales', label: 'Internacionales', icon: '🌍', url: 'https://www.perfil.com/feed/internacionales' },
  { key: 'deportes',      label: 'Deportes',       icon: '⚽', url: 'https://www.perfil.com/feed/deportes' },
  { key: 'espectaculos',  label: 'Espectáculos',   icon: '🎬', url: 'https://www.perfil.com/feed/espectaculos' },
];

async function _fetchTopHeadlines(cat) {
  const res = await fetch(cat.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('RSS mal formado');

  const items = [...doc.querySelectorAll('item')].slice(0, TOP_N);
  const titles = items.map(item => item.querySelector('title')?.textContent?.trim()).filter(Boolean);
  return titles;
}

let _running = false;
export async function checkNews() {
  if (_running) return;
  const now = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (now - lastRun < CHECK_INTERVAL_MS) return;
  _running = true;

  try {
    const lastKey = localStorage.getItem(ROTATION_KEY);
    const lastIdx = CATEGORIES.findIndex(c => c.key === lastKey);
    const cat = CATEGORIES[(lastIdx + 1) % CATEGORIES.length];

    try {
      const titles = await _fetchTopHeadlines(cat);
      if (titles.length) {
        addNotification({
          type: 'news', category: 'noticias', icon: cat.icon, color: '#6366F1',
          title: `Noticias — ${cat.label}`,
          message: titles.map((t, i) => `${i + 1}. ${t}`).join('\n'),
          data: { category: cat.key },
        });
      }
      localStorage.setItem(ROTATION_KEY, cat.key);
      localStorage.setItem(LASTRUN_KEY, String(now));
    } catch (err) {
      console.warn(`[Noticias] no se pudo obtener ${cat.label} (posible bloqueo CORS del sitio):`, err?.message ?? err);
    }
  } finally {
    _running = false;
  }
}

export function initNewsNotifications() {
  checkNews();
  setInterval(checkNews, CHECK_INTERVAL_MS);
}
