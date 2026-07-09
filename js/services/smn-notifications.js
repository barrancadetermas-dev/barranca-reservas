// ═══════════════════════════════════════════════════════════════
// MILA PMS — Alertas meteorológicas del SMN
// Consulta el feed RSS del Servicio Meteorológico Nacional para
// alertas de mal tiempo en Entre Ríos / Colón.
// ═══════════════════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY       = 'mila_smn_lastrun';
const LASTALERT_KEY     = 'mila_smn_last_alert';
const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // cada 3 horas

// Feed RSS público del SMN con alertas por provincia
const SMN_RSS = 'https://ssl.smn.gob.ar/dpd/alertas/rss.xml';

// Palabras clave para filtrar alertas relevantes a Entre Ríos / Colón
const KEYWORDS = ['entre ríos', 'entre rios', 'colón', 'colon', 'litoral'];

export async function checkSMNAlerts() {
  const now     = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (now - lastRun < CHECK_INTERVAL_MS) return;

  try {
    // Usamos un proxy CORS público para el RSS del SMN
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(SMN_RSS)}`;
    const res   = await fetch(proxy, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text   = await res.text();
    const parser = new DOMParser();
    const xml    = parser.parseFromString(text, 'text/xml');
    const items  = Array.from(xml.querySelectorAll('item'));

    if (!items.length) {
      console.warn('[SMN] RSS vacío o sin alertas');
      localStorage.setItem(LASTRUN_KEY, String(now));
      return;
    }

    // Filtrar ítems relevantes para la región
    const relevant = items.filter(item => {
      const title = (item.querySelector('title')?.textContent ?? '').toLowerCase();
      const desc  = (item.querySelector('description')?.textContent ?? '').toLowerCase();
      return KEYWORDS.some(kw => title.includes(kw) || desc.includes(kw));
    });

    if (!relevant.length) {
      console.info('[SMN] Sin alertas para Entre Ríos/Colón');
      localStorage.setItem(LASTRUN_KEY, String(now));
      return;
    }

    // Tomar la alerta más reciente
    const item  = relevant[0];
    const title = item.querySelector('title')?.textContent?.trim() ?? 'Alerta meteorológica';
    const desc  = item.querySelector('description')?.textContent?.trim() ?? '';
    const link  = item.querySelector('link')?.textContent?.trim() ?? '';
    const guid  = item.querySelector('guid')?.textContent ?? title;

    // Evitar duplicar la misma alerta
    const lastAlert = localStorage.getItem(LASTALERT_KEY);
    if (lastAlert === guid) {
      localStorage.setItem(LASTRUN_KEY, String(now));
      return;
    }

    // Nivel de alerta según el título
    const isRed    = /rojo|extremo|peligro/i.test(title);
    const isOrange = /naranja|alto|severo/i.test(title);

    addNotification({
      type:     'smn_alert',
      category: 'sistema',
      icon:     isRed ? '🔴' : isOrange ? '🟠' : '🟡',
      color:    isRed ? '#EF4444' : isOrange ? '#F97316' : '#EAB308',
      title:    `⚡ SMN: ${title}`,
      message:  desc.length > 120 ? desc.slice(0, 120) + '…' : desc,
      data:     { link },
    });

    localStorage.setItem(LASTALERT_KEY, guid);
    localStorage.setItem(LASTRUN_KEY, String(now));

  } catch (err) {
    console.warn('[SMN] no se pudo consultar alertas:', err?.message ?? err);
  }
}

let _smnInitialized = false;
export function initSMNNotifications() {
  if (_smnInitialized) return;
  _smnInitialized = true;
  checkSMNAlerts();
  setInterval(checkSMNAlerts, CHECK_INTERVAL_MS);
}
