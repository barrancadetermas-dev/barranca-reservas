// ═══════════════════════════════════════════════════
// dollar-variants-notifications.js — Blue / MEP / CCL,
// en formato lista, aparte del Oficial (que ya se avisa
// desde usd-rate-history.js sin tocarlo).
//
// Usa DolarAPI (dolarapi.com) — misma fuente que ya usás
// para el Oficial, gratis, sin clave.
// Corre 1 vez por día. Categoría "economia" — se agrupa
// con el aviso de variación del oficial que ya existía.
// ═══════════════════════════════════════════════════

import { addNotification } from './notification-center.js';

const LASTRUN_KEY = 'mila_dollar_variants_lastrun';

const WANTED = [
  { casa: 'oficial',         label: 'Oficial' },
  { casa: 'blue',            label: 'Blue' },
  { casa: 'bolsa',           label: 'MEP' },
  { casa: 'contadoconliqui', label: 'CCL' },
];

let _running = false;
export async function checkDollarVariants() {
  if (_running) return;
  const todayISO = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(LASTRUN_KEY) === todayISO) return;
  _running = true;

  try {
    const res = await fetch('https://dolarapi.com/v1/dolares');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const lines = WANTED.map(w => {
      const d = data.find(x => x.casa === w.casa);
      if (!d) return null;
      return `${w.label}: $${Math.round(d.compra).toLocaleString('es-AR')} / $${Math.round(d.venta).toLocaleString('es-AR')}`;
    }).filter(Boolean);

    if (lines.length) {
      addNotification({
        type: 'dollar_variants', category: 'economia', icon: '💵', color: '#22C55E',
        title: 'Cotizaciones del dólar',
        message: `${lines.join('\n')}\n\n(compra / venta)`,
      });
      localStorage.setItem(LASTRUN_KEY, todayISO);
    }
  } catch (err) {
    console.warn('[Dólar variantes] no se pudo obtener la lista:', err?.message ?? err);
  } finally {
    _running = false;
  }
}
