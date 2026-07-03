// ═══════════════════════════════════════════════════
// supabase-config.js v5.0 — MILA Sistema Inteligente
// Usa Vite + variables de entorno (.env.local / Vercel)
// Unidades 100% dinámicas desde tabla `units` en Supabase
// ═══════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[MILA] Faltan variables de entorno. Copiá .env.example → .env.local y completá los valores.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth:     { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const AppContext = {
  hotel:    null,
  user:     null,
  units:    [],
  hotelId:  null,
  role:     'staff',   // 'admin' | 'staff' | 'demo'
  IS_DEMO:  false,
  config:   {},        // configuración del hotel (comisiones, recargos, etc.)
};

// ══════════════════════════════════════════════════
// PALETA DE COLORES DEFAULT (fallback si la unidad no
// tiene color en la DB). Se prioriza siempre unit.color
// ══════════════════════════════════════════════════
const DEFAULT_COLORS = [
  '#EF4444','#3B82F6','#22D3EE','#84CC16',
  '#38BDF8','#F472B6','#C084FC','#F59E0B',
  '#34D399','#A78BFA','#FB923C','#E879F9',
];

export function getDefaultColor(index) {
  return DEFAULT_COLORS[(index - 1) % DEFAULT_COLORS.length] ?? '#6366F1';
}

// ══════════════════════════════════════════════════
// CANALES DE ORIGEN — fuente de verdad
// ══════════════════════════════════════════════════
export const SOURCE_CONFIG = {
  direct:   { label: 'Directo',    dot: '#64748B', color: null,      textColor: null    },
  walkin:   { label: 'Espontáneo', dot: '#0891B2', color: '#0891B2', textColor: 'white' },
  booking:  { label: 'Booking',    dot: '#1D4ED8', color: '#1D4ED8', textColor: 'white' },
  airbnb:   { label: 'Airbnb',     dot: '#EA580C', color: '#EA580C', textColor: 'white' },
  family:   { label: 'Familia',    dot: '#7C3AED', color: '#7C3AED', textColor: 'white' },
  company:  { label: 'Empresa',    dot: '#0F766E', color: '#0F766E', textColor: 'white' },
  referral: { label: 'Referido',   dot: '#B45309', color: '#B45309', textColor: 'white' },
  despegar: { label: 'Despegar',    dot: '#059669', color: '#059669', textColor: 'white' },
  expedia:  { label: 'Expedia',     dot: '#DC2626', color: '#DC2626', textColor: 'white' },
};

// ══════════════════════════════════════════════════
// COLOR DE BARRA DE RESERVA (prioridad estricta)
// blocked > family > airbnb > booking > paid > partial > pending
// ══════════════════════════════════════════════════
export function getBookingBarColor(booking) {
  const status = booking?.status ?? 'pending';
  const source = booking?.source ?? 'direct';
  const isPast = booking?.check_out
    ? new Date(booking.check_out + 'T00:00:00') < new Date()
    : false;

  if (status === 'blocked' || booking?.is_blocked)
    return { color: '#374151', textColor: 'rgba(255,255,255,.7)', label: 'Bloqueo', priority: 1 };

  if (source === 'family')
    return { color: isPast ? '#4C1D95' : '#7C3AED', textColor: 'white', label: 'Familia', priority: 2 };

  if (source === 'walkin')
    return { color: isPast ? '#155E75' : '#0891B2', textColor: 'white', label: 'Espontáneo', priority: 3 };

  if (source === 'airbnb')
    return { color: isPast ? '#7C2D12' : '#EA580C', textColor: 'white', label: 'Airbnb', priority: 3 };

  if (source === 'booking')
    return { color: isPast ? '#1E3A8A' : '#1D4ED8', textColor: 'white', label: 'Booking', priority: 4 };

  if (source === 'despegar')
    return { color: isPast ? '#064E3B' : '#059669', textColor: 'white', label: 'Despegar', priority: 4 };

  if (source === 'expedia')
    return { color: isPast ? '#7F1D1D' : '#DC2626', textColor: 'white', label: 'Expedia', priority: 4 };

  if (source === 'company')
    return { color: isPast ? '#0D4D4D' : '#0F766E', textColor: 'white', label: 'Empresa', priority: 4 };

  if (source === 'referral')
    return { color: isPast ? '#78350F' : '#B45309', textColor: 'white', label: 'Referido', priority: 4 };

  if (status === 'paid')
    return { color: isPast ? '#14532D' : '#16A34A', textColor: 'white', label: 'Pagado', priority: 5 };

  if (status === 'partial')
    return { color: isPast ? '#7F1D1D' : '#DC2626', textColor: 'white', label: 'Con seña', priority: 6 };

  return {
    color:     isPast ? '#78350F' : '#EAB308',
    textColor: isPast ? 'white'   : '#1C1917',
    label:     'Sin seña',
    priority:  7,
  };
}

// Backward compat
export function getBookingColor(status, checkOut) {
  return getBookingBarColor({ status, check_out: checkOut }).color;
}

// ══════════════════════════════════════════════════
// HELPERS DE UNIDADES — 100% dinámicos desde AppContext
// ══════════════════════════════════════════════════

/** Color de un unit: prioridad DB > color default por índice */
export function getUnitColor(unit) {
  if (!unit) return '#6366F1';
  const color = String(unit.color ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(color) || /^#[0-9a-f]{3}$/i.test(color)) return color;
  return getDefaultColor(unit.sort_order ?? unit.number ?? 1);
}

/** Formato estándar: "#1 · Nombre Unidad" */
// Bandera por nacionalidad — cubre tanto la lista completa de Huéspedes
// como la lista acotada del formulario de reservas, para que se vea bien
// sin importar de dónde salió el dato.
const NATIONALITY_FLAGS = {
  'Argentina': '🇦🇷', 'Uruguay': '🇺🇾', 'Brasil': '🇧🇷', 'Paraguay': '🇵🇾',
  'Chile': '🇨🇱', 'Bolivia': '🇧🇴', 'Perú': '🇵🇪', 'Colombia': '🇨🇴',
  'Venezuela': '🇻🇪', 'Ecuador': '🇪🇨', 'España': '🇪🇸', 'México': '🇲🇽',
  'EE.UU.': '🇺🇸',
};
export function getNationalityFlag(nationality) {
  if (!nationality || nationality === 'Otro' || nationality === 'Otros') return '';
  return NATIONALITY_FLAGS[nationality] ?? '';
}

export function getUnitLabel(unit) {
  if (!unit) return '—';
  const num  = unit.sort_order ?? unit.number ?? '?';
  const name = (unit.name ?? `Unidad ${num}`)
    .replace('Planta Baja', 'P. Baja')
    .replace('Planta Alta', 'P. Alta');
  return `#${num} · ${name}`;
}

/** Chip HTML con color dinámico */
export function getUnitChipHTML(unit, size = 'sm') {
  if (!unit) return '';
  const color = getUnitColor(unit);
  const label = getUnitLabel(unit);
  const pad   = size === 'lg' ? '4px 12px' : '2px 9px';
  const fs    = size === 'lg' ? '.8rem'    : '.7rem';
  return `<span class="unit-chip-v2" style="
    padding:${pad};font-size:${fs};border-radius:999px;
    background:${color}18;color:${color};border:1px solid ${color}38;
    display:inline-flex;align-items:center;gap:5px;font-weight:700;
    white-space:nowrap;line-height:1.4;vertical-align:middle">
    <span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></span>
    ${label}
  </span>`;
}

/** Badge de origen */
export function getSourceBadgeHTML(source) {
  if (!source || source === 'direct') return '';
  const cfg = SOURCE_CONFIG[source];
  if (!cfg?.color) return '';
  return `<span class="source-badge" style="
    padding:2px 8px;border-radius:999px;font-size:.7rem;font-weight:700;
    background:${cfg.color}18;color:${cfg.color};border:1px solid ${cfg.color}35;
    white-space:nowrap">■ ${cfg.label}</span>`;
}

// ══════════════════════════════════════════════════
// UTILIDADES GENERALES
// ══════════════════════════════════════════════════

/** Formato ARS con símbolo $ */
export function formatARS(n) {
  if (n == null || isNaN(n)) return '$—';
  return '$' + Math.round(n).toLocaleString('es-AR');
}

/** Formato fecha legible (dd/mm/aaaa) */
export function formatDate(iso) {
  if (!iso) return '—';
  try {
    // If already has time component (timestamp), parse directly
    // If only date (YYYY-MM-DD), append T12:00:00 to avoid timezone shifts
    const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch { return iso; }
}

/** YYYY-MM-DD de un Date local */
export function toISODate(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Fecha local de hoy en formato YYYY-MM-DD (evita bug UTC a las 21hs AR)
export function localToday() {
  return toISODate(new Date());
}

// Convierte cualquier Date a YYYY-MM-DD usando hora local
export function localDateISO(d) {
  return toISODate(d instanceof Date ? d : new Date(d));
}

// ══════════════════════════════════════════════════
// TOAST GLOBAL (deduplicado)
// ══════════════════════════════════════════════════
let _lastToastKey = '';
let _lastToastTime = 0;

export function showToast(msg, type = 'success', duration = 3500) {
  const key = `${type}::${msg}`;
  const now = Date.now();
  // Evitar duplicados dentro de 800ms
  if (key === _lastToastKey && now - _lastToastTime < 800) return;
  _lastToastKey  = key;
  _lastToastTime = now;

  const container = document.getElementById('toast-container');
  if (!container) return;

  const colors = {
    success: { bg: '#f0fdf4', border: '#22c55e', text: '#14532d', icon: '✓' },
    error:   { bg: '#fef2f2', border: '#ef4444', text: '#7f1d1d', icon: '✕' },
    warning: { bg: '#fffbeb', border: '#f59e0b', text: '#78350f', icon: '⚠' },
    info:    { bg: '#eff6ff', border: '#3b82f6', text: '#1e3a8a', icon: 'ℹ' },
  };
  const c = colors[type] ?? colors.info;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span style="width:20px;height:20px;border-radius:50%;background:${c.border};
      color:#fff;display:flex;align-items:center;justify-content:center;
      font-size:.75rem;font-weight:700;flex-shrink:0">${c.icon}</span>
    <span style="flex:1;color:${c.text}">${msg}</span>`;
  toast.style.cssText = `background:${c.bg};border-left:3px solid ${c.border}`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-show'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ══════════════════════════════════════════════════
// CARGAR CONTEXTO DEL HOTEL
// Lee hotel por VITE_HOTEL_SLUG o primer hotel activo
// Las unidades se cargan 100% desde Supabase
// ══════════════════════════════════════════════════
const HOTEL_SLUG = import.meta.env.VITE_HOTEL_SLUG ?? 'barranca-de-termas';
export { HOTEL_SLUG };

export async function loadHotelContext() {
  const { data: hotel, error } = await supabase
    .from('hotels').select('*').eq('slug', HOTEL_SLUG).single();

  if (error || !hotel) throw new Error(`Hotel "${HOTEL_SLUG}" no encontrado.`);

  AppContext.hotel   = hotel;
  AppContext.hotelId = hotel.id;

  // Cargar unidades — sin override hardcodeado
  const { data: units } = await supabase
    .from('units').select('*')
    .eq('hotel_id', hotel.id)
    .eq('is_active', true)
    .order('sort_order');

  AppContext.units = (units ?? []).map(u => ({
    ...u,
    color: u.color || getDefaultColor(u.sort_order ?? 1),
  }));

  // Cargar configuración del hotel (tabla opcional — se crea con schema-v5-nuevas-tablas.sql)
  try {
    const { data: cfg, error: cfgErr } = await supabase
      .from('hotel_config')
      .select('*')
      .eq('hotel_id', hotel.id);
    // Si la tabla no existe (404/42P01), ignorar silenciosamente
    if (cfgErr) {
      // No loguear — es esperado hasta que se cree la tabla hotel_config
    } else if (cfg?.length) {
      cfg.forEach(row => { AppContext.config[row.key] = row.value; });
    }
  } catch (_) { /* tabla opcional */ }
}

// Backward-compat exports que otros módulos importan
export const UNIT_CATALOG = [];  // ya no se usa — dinámico
export const UNIT_NAMES   = {};  // ya no se usa — dinámico
export const UNIT_PALETTE = {};  // ya no se usa — dinámico
