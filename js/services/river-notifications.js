// ═══════════════════════════════════════════════════
// river-notifications.js — Nivel del Río Uruguay en
// Concepción del Uruguay (estación más cercana a Colón).
//
// Usa el servicio geoespacial público del INA (Instituto
// Nacional del Agua) — es del Estado argentino, gratis,
// sin clave. Capa "ultimas_alturas": última altura medida
// en cada estación hidrométrica de la Cuenca del Plata.
//
// AVISO IMPORTANTE: a diferencia de las otras fuentes
// (clima, fútbol, F1), esta API del Estado está mucho
// menos documentada públicamente y no pude probarla en
// vivo antes de entregarla — es la más propensa a necesitar
// un ajuste una vez que la veas correr de verdad. Si falla,
// no rompe nada más de la app (mismo resguardo que todo el
// resto), pero puede que la notificación no aparezca hasta
// que ajustemos el nombre exacto del campo o de la estación.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY = 'mila_river_notif_lastrun';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas, mismo criterio que el resto

const WFS_URL = 'https://alerta.ina.gob.ar/geoserver/wfs' +
  '?service=WFS&version=1.0.0&request=GetFeature' +
  '&typeName=alerta5:ultimas_alturas' +
  '&outputFormat=application/json' +
  "&CQL_FILTER=nombre ILIKE '%Concepcion del Uruguay%'";

export async function checkRiverLevel() {
  const now = Date.now();
  const lastRun = parseInt(localStorage.getItem(LASTRUN_KEY) ?? '0', 10);
  if (now - lastRun < CHECK_INTERVAL_MS) return;

  try {
    const res = await fetch(WFS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const feature = data?.features?.[0]?.properties;

    if (!feature) {
      console.warn('[Río] la consulta funcionó pero no devolvió ninguna estación — puede que el nombre de la estación o el filtro necesiten un ajuste.', data);
      return;
    }

    // Los nombres exactos de estos campos pueden variar — se prueban
    // varias alternativas conocidas del esquema del INA.
    const nivel   = feature.valor ?? feature.altura ?? feature.value ?? null;
    const alerta  = feature.nivel_alerta ?? feature.alerta ?? null;
    const nombre  = feature.nombre ?? 'Concepción del Uruguay';

    if (nivel == null) {
      console.warn('[Río] no se encontró el campo de altura en la respuesta — revisar estructura:', feature);
      return;
    }

    const enAlerta = alerta != null && nivel >= alerta;
    addNotification({
      type: 'river_level',
      category: 'rio',
      icon: enAlerta ? '🌊' : '💧',
      color: enAlerta ? '#EF4444' : '#0EA5E9',
      title: enAlerta ? '⚠️ Río Uruguay por encima del nivel de alerta' : 'Nivel del Río Uruguay',
      message: `${nombre}: ${nivel} m${alerta != null ? ` (nivel de alerta: ${alerta} m)` : ''}`,
      data: { nivel, alerta, nombre },
    });

    localStorage.setItem(LASTRUN_KEY, String(now));
  } catch (err) {
    console.warn('[Río] no se pudo consultar el nivel del río:', err?.message ?? err);
  }
}

export function initRiverNotifications() {
  checkRiverLevel();
  setInterval(checkRiverLevel, CHECK_INTERVAL_MS);
}
