// ══════════════════════════════════════════════════
// expense-categories.js — Fuente única de categorías de
// gastos (nombre + color) para que Operaciones, Estadísticas
// y "Preguntale a Mila" muestren siempre lo mismo.
// ══════════════════════════════════════════════════
export const CATEGORIES = [
  'servicios', 'mantenimiento', 'limpieza', 'impuestos', 'personal',
  'compras', 'otros', 'honorarios', 'marketing', 'bancarios',
];

export const CATEGORY_COLORS = {
  servicios:     '#3B82F6', // azul
  mantenimiento: '#F59E0B', // ámbar
  limpieza:      '#34D399', // verde
  impuestos:     '#F43F5E', // rosa/rojo
  personal:      '#A855F7', // violeta
  compras:       '#0EA5E9', // celeste
  otros:         '#94A3B8', // gris
  honorarios:    '#6366F1', // índigo
  marketing:     '#EC4899', // rosa fuerte
  bancarios:     '#14B8A6', // teal
};

export const DEFAULT_CATEGORY_COLOR = '#94A3B8';

export function categoryColor(category) {
  return CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLOR;
}
