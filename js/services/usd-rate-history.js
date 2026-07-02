// ══════════════════════════════════════════════════
// usd-rate-history.js — Historial de cotización USD
// Guarda una foto diaria del dólar oficial (venta promedio) en
// hotel_config (clave 'usd_rate_history', valor = JSON stringificado),
// para poder calcular un promedio móvil de los últimos 5 días en vez de
// usar el valor de un solo día/fuente. Se le suma el margen configurado
// en Configuración → "Dólar — margen sobre cotización oficial".
//
// No requiere tabla nueva: reutiliza hotel_config, que ya existe y ya
// se usa para el resto de la configuración (comisiones, recargos, etc).
// ══════════════════════════════════════════════════

const HISTORY_KEY = 'usd_rate_history';
const MAX_ENTRIES = 14; // más que suficiente para un promedio de 5 días

function toISODate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Registra la cotización de HOY en el historial (si todavía no se
 * registró). Es seguro llamarla varias veces por día — solo agrega una
 * entrada nueva si el día cambió respecto de la última registrada.
 * No lanza errores hacia afuera — es un registro best-effort.
 */
export async function recordDailyRateSnapshot(db, hotelId, sellRate) {
  if (!db || !hotelId || !sellRate) return;
  try {
    const today = toISODate(new Date());
    const { data } = await db.from('hotel_config')
      .select('value').eq('hotel_id', hotelId).eq('key', HISTORY_KEY).maybeSingle();

    let history = [];
    try { history = JSON.parse(data?.value ?? '[]'); } catch { history = []; }
    if (!Array.isArray(history)) history = [];

    if (history[history.length - 1]?.date === today) return; // ya registrado hoy

    history.push({ date: today, sell: Math.round(sellRate * 100) / 100 });
    if (history.length > MAX_ENTRIES) history = history.slice(-MAX_ENTRIES);

    await db.from('hotel_config').upsert({
      hotel_id: hotelId, key: HISTORY_KEY, value: JSON.stringify(history), updated_at: new Date().toISOString(),
    }, { onConflict: 'hotel_id,key' });
  } catch (_) { /* no crítico — el widget sigue funcionando con el valor del día */ }
}

/**
 * Trae el historial guardado y calcula el promedio de los últimos N días
 * (5 por defecto) + el valor con el margen configurado ya aplicado.
 */
export async function getUsdConversionRate(db, hotelId, marginPct = 0, days = 5) {
  const fallback = { avg: null, margined: null, history: [], daysUsed: 0 };
  if (!db || !hotelId) return fallback;
  try {
    const { data } = await db.from('hotel_config')
      .select('value').eq('hotel_id', hotelId).eq('key', HISTORY_KEY).maybeSingle();
    let history = [];
    try { history = JSON.parse(data?.value ?? '[]'); } catch { history = []; }
    if (!Array.isArray(history) || !history.length) return fallback;

    const recent = history.slice(-days);
    const avg = Math.round((recent.reduce((s, h) => s + (h.sell ?? 0), 0) / recent.length) * 100) / 100;
    const margined = Math.round(avg * (1 + (marginPct || 0) / 100) * 100) / 100;
    return { avg, margined, history, daysUsed: recent.length };
  } catch (_) { return fallback; }
}
