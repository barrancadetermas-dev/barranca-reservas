// ══════════════════════════════════════════════════════════════
// guest-count.js — Cantidad de personas de una reserva
//
// En la base conviven tres columnas: pax (total), adults y children.
// Reservas viejas o creadas por otros caminos pueden tener adults = 1
// (valor por defecto de la columna) con pax = 4. Antes el formulario
// mostraba 1 y al guardar pisaba pax con 1: se perdían personas.
// Regla: el total real es el MAYOR entre pax y adultos+menores; los
// menores se respetan y los adultos son el resto (mínimo 1).
// ══════════════════════════════════════════════════════════════

/**
 * @param {{adults?:number|null, children?:number|null, pax?:number|null}} b  fila de bookings
 * @param {number} [fallbackTotal=2] total a usar SOLO si la reserva no trae ningún dato
 * @returns {{adults:number, children:number, total:number}}
 */
export function resolveGuestCounts(b = {}, fallbackTotal = 2) {
  const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  const children = num(b.children);
  const total = Math.max(num(b.pax), num(b.adults) + children) || fallbackTotal;
  const kids = Math.min(children, Math.max(0, total - 1));   // siempre queda al menos 1 adulto
  return { adults: total - kids, children: kids, total };
}
