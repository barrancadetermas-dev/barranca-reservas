// ═══════════════════════════════════════════════════
// mock-data.js — Generador de datos para modo Demo
// Produce datos realistas argentinos para el mes actual
// Nunca toca Supabase. Se activa cuando role = 'demo'
// ═══════════════════════════════════════════════════

const AR_FIRST = ['Sofía','Martín','Valentina','Lucas','Florencia','Mateo',
                  'Camila','Nicolás','Ana','Diego','María','Felipe','Laura','Tomás','Gabriela'];
const AR_LAST  = ['García','Rodríguez','Fernández','González','López','Martínez',
                  'Pérez','Sánchez','Romero','Torres','Díaz','Flores','Moreno','Muñoz','Álvarez'];

const rnd    = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function toISO(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(Math.max(1, Math.min(d, 28))).padStart(2,'0')}`;
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// Precios base por unidad (ARS, razonables para 2026)
const BASE_PRICES = { 1:95000, 2:72000, 3:72000, 4:58000, 5:58000, 6:58000, 7:58000 };

// ── Templates de reservas —  cobertura real del mes ──
const TEMPLATES = [
  { uIdx:0, start:1,  nights:7,  status:'paid',    source:'airbnb',  mult:1.2, paidPct:1.0  },
  { uIdx:0, start:12, nights:8,  status:'partial',  source:'direct',  mult:1.0, paidPct:0.3  },
  { uIdx:0, start:24, nights:5,  status:'pending',  source:'booking', mult:1.1, paidPct:0    },
  { uIdx:1, start:3,  nights:5,  status:'paid',    source:'booking', mult:1.1, paidPct:1.0  },
  { uIdx:1, start:11, nights:9,  status:'partial',  source:'direct',  mult:1.0, paidPct:0.4  },
  { uIdx:2, start:1,  nights:14, status:'paid',    source:'airbnb',  mult:1.2, paidPct:1.0  },
  { uIdx:2, start:18, nights:7,  status:'pending',  source:'direct',  mult:1.0, paidPct:0    },
  { uIdx:3, start:5,  nights:6,  status:'paid',    source:'family',  mult:0.8, paidPct:1.0  },
  { uIdx:3, start:15, nights:8,  status:'paid',    source:'booking', mult:1.1, paidPct:1.0  },
  { uIdx:4, start:2,  nights:4,  status:'paid',    source:'direct',  mult:1.0, paidPct:1.0  },
  { uIdx:4, start:8,  nights:2,  status:'blocked', source:'direct',  mult:0,   paidPct:0    },
  { uIdx:4, start:14, nights:9,  status:'partial',  source:'airbnb',  mult:1.2, paidPct:0.3  },
  { uIdx:5, start:6,  nights:10, status:'partial',  source:'direct',  mult:1.0, paidPct:0.5  },
  { uIdx:5, start:20, nights:7,  status:'paid',    source:'booking', mult:1.1, paidPct:1.0  },
  { uIdx:6, start:1,  nights:6,  status:'paid',    source:'direct',  mult:1.0, paidPct:1.0  },
  { uIdx:6, start:10, nights:12, status:'partial',  source:'airbnb',  mult:1.2, paidPct:0.35 },
];

const NOTES_POOL = [
  'Viene con mascotas 🐕',
  'Gente mayor — piden practicuna',
  'Cumpleaños de 15 🎂',
  'Requiere cuna para bebé',
  'Luna de miel 🥂',
  null, null, null, // 3 sin notas (más realista)
];

const METHODS = ['cash','transfer','mercadopago','credit_card','naranjax','uala'];

// ══════════════════════════════════════════════════
// RESERVAS DEL MES
// ══════════════════════════════════════════════════
export function generateMockBookings(units, year, month) {
  const bookings = [];

  TEMPLATES.forEach((t, i) => {
    const unit      = units[t.uIdx % units.length];
    const num       = unit.sort_order ?? (t.uIdx + 1);
    const basePrice = BASE_PRICES[num] ?? 65000;
    const price     = Math.round(basePrice * t.mult / 1000) * 1000;
    const checkIn   = toISO(year, month, t.start);
    const checkOut  = addDays(checkIn, t.nights);
    const total     = t.status === 'blocked' ? 0 : price * t.nights;
    const paid      = Math.round(total * t.paidPct);
    const balance   = total - paid;
    const fn        = AR_FIRST[i % AR_FIRST.length];
    const ln        = AR_LAST[(i * 3) % AR_LAST.length];
    const isBad     = i === 7; // solo uno para ejemplificar
    const method    = METHODS[i % METHODS.length];
    const note      = NOTES_POOL[i % NOTES_POOL.length];

    bookings.push({
      id:              `mock-bk-${i}`,
      hotel_id:        'mock-hotel',
      guest_id:        t.status === 'blocked' ? null : `mock-gu-${i}`,
      check_in:        checkIn,
      check_out:       checkOut,
      nights:          t.nights,
      status:          t.status,
      source:          t.source,
      price_per_night: price,
      total_amount:    total,
      total_paid:      paid,
      balance,
      free_nights:     0,
      discount_pct:    0,
      surcharge_amount:0,
      is_blocked:      t.status === 'blocked',
      block_reason:    t.status === 'blocked' ? 'Mantenimiento preventivo' : null,
      notes:           note,
      checked_in_at:   null,
      checked_out_at:  null,
      guests: t.status === 'blocked' ? null : {
        id:                   `mock-gu-${i}`,
        first_name:           fn,
        last_name:            ln,
        dni:                  `${30 + i}${rndInt(100000, 999999)}`,
        phone:                `+54911${rndInt(10000000, 99999999)}`,
        email:                `${fn.toLowerCase()}${ln.toLowerCase()}@gmail.com`,
        bad_experience:       isBad,
        bad_experience_note:  isBad ? 'Dejó el depto muy sucio. Requirió limpieza extra de 3hs.' : null,
      },
      booking_units: [{ unit_id: unit.id, units: unit }],
      payments: paid > 0 ? [{
        id:              `mock-pay-${i}`,
        booking_id:      `mock-bk-${i}`,
        amount:          paid,
        amount_ars:      paid,
        currency:        'ARS',
        exchange_rate:   null,
        method,
        credit_surcharge: method === 'credit_card' ? Math.round(paid * 0.1) : 0,
        paid_at:         new Date(year, month, t.start, 10, 30).toISOString(),
        notes:           null,
      }] : [],
    });
  });

  return bookings;
}

// ══════════════════════════════════════════════════
// HUÉSPEDES (para CRM demo)
// ══════════════════════════════════════════════════
export function generateMockGuests(year, month) {
  return AR_FIRST.slice(0, 12).map((fn, i) => {
    const ln = AR_LAST[i % AR_LAST.length];
    return {
      id:                  `mock-gu-${i}`,
      first_name:          fn,
      last_name:           ln,
      dni:                 `${30 + i}${rndInt(100000, 999999)}`,
      phone:               `+54911${rndInt(10000000, 99999999)}`,
      email:               `${fn.toLowerCase()}${ln.toLowerCase()}@gmail.com`,
      bad_experience:      i === 7,
      bad_experience_note: i === 7 ? 'Dejó el departamento muy sucio.' : null,
      total_bookings:      rndInt(1, 6),
      total_spent:         rndInt(180000, 1200000),
      avg_nights:          rndInt(4, 10),
      last_checkin:        toISO(year, month, rndInt(1, 20)),
    };
  });
}

// ══════════════════════════════════════════════════
// ESTADÍSTICAS (para Estadísticas + P&L demo)
// ══════════════════════════════════════════════════
export function generateMockStats(units) {
  const occ     = [73, 60, 67, 50, 43, 57, 63];
  const rev     = [2_090_000, 1_296_000, 1_440_000, 870_000, 754_000, 986_000, 1_102_000];
  const bkCount = [4, 3, 3, 3, 2, 3, 4];
  return units.map((u, i) => {
    const num    = (u.sort_order ?? i + 1) - 1;
    const price  = BASE_PRICES[u.sort_order ?? i+1] ?? 65000;
    const nights = Math.round((occ[num] / 100) * 30);
    return {
      unit:            u,
      nightsOcc:       nights,
      revenue:         rev[num]  ?? 900000,
      bookingCount:    bkCount[num] ?? 3,
      avgPricePerNight:price,
      occupancyPct:    occ[num]  ?? 50,
    };
  });
}

// ══════════════════════════════════════════════════
// GASTOS (para módulo de gastos demo)
// ══════════════════════════════════════════════════
export function generateMockExpenses() {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  return [
    { id:'me1', category:'servicios',     description:`Factura de luz — ${mm}/${yyyy}`,        amount:92500,  due_date:`${yyyy}-${mm}-20`, paid:false },
    { id:'me2', category:'servicios',     description:`Factura de gas — ${mm}/${yyyy}`,        amount:48000,  due_date:`${yyyy}-${mm}-25`, paid:false },
    { id:'me3', category:'mantenimiento', description:'Reparación calefón Unidad #3',          amount:68000,  due_date:`${yyyy}-${mm}-10`, paid:true  },
    { id:'me4', category:'limpieza',      description:'Servicio de limpieza semanal',          amount:130000, due_date:`${yyyy}-${mm}-30`, paid:false },
    { id:'me5', category:'impuestos',     description:`ABL — 2do bimestre ${yyyy}`,            amount:41000,  due_date:`${yyyy}-${mm}-15`, paid:true  },
    { id:'me6', category:'personal',      description:`Sueldo recepcionista — ${mm}/${yyyy}`,  amount:520000, due_date:`${yyyy}-${mm}-30`, paid:false },
    { id:'me7', category:'otros',         description:'Reposición ropa de cama',               amount:85000,  due_date:`${yyyy}-${mm}-05`, paid:true  },
  ];
}

// ══════════════════════════════════════════════════
// RECORDATORIOS (para dashboard demo)
// ══════════════════════════════════════════════════
export function generateMockReminders(units) {
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = addDays(today, 5);
  return [
    { id:'mr1', title:'Cortar el pasto', description:'Zona de ingreso + jardín trasero',
      scheduled_date: today,     completed:false, units:null },
    { id:'mr2', title:`Revisar calefón #3`,
      description:'Huésped reportó baja presión de agua caliente',
      scheduled_date: today,     completed:false, units: units[2] ?? null },
    { id:'mr3', title:'Fumigación general',
      description:'Empresa Fumigan SA — confirmar horario de acceso',
      scheduled_date: nextWeek,  completed:false, units:null },
  ];
}

// ══════════════════════════════════════════════════
// KPIs DE HOY (para dashboard demo)
// ══════════════════════════════════════════════════
export function generateMockDashboard(units, bookings) {
  const today      = new Date().toISOString().split('T')[0];
  const checkins   = bookings.filter(b => b.check_in  === today && b.status !== 'cancelled');
  const checkouts  = bookings.filter(b => b.check_out === today && b.status !== 'cancelled');
  const active     = bookings.filter(b => b.check_in <= today && b.check_out > today && b.status !== 'cancelled' && !b.is_blocked);

  const guestName = b => b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : '—';

  const recambios = [];
  checkins.forEach(ci => {
    const ciUnitId = ci.booking_units?.[0]?.unit_id;
    const co = checkouts.find(co => (co.booking_units?.[0]?.unit_id) === ciUnitId);
    if (co) {
      recambios.push({
        unitName: ci.booking_units?.[0]?.units?.name ?? 'Unidad',
        outGuest: guestName(co),
        inGuest:  guestName(ci),
      });
    }
  });

  const occupied = new Set(active.flatMap(b => (b.booking_units ?? []).map(bu => bu.unit_id)));
  const occupiedDetail = active.flatMap(b =>
    (b.booking_units ?? []).map(bu => ({ unitName: bu.units?.name ?? '—', guestName: guestName(b) }))
  );

  return {
    checkins,
    checkouts,
    recambios,
    occupiedUnits: occupied.size,
    occupiedDetail,
    arrivals: checkins.slice(0, 3),
  };
}

// ══════════════════════════════════════════════════
// COMISIONES (para estadísticas demo)
// ══════════════════════════════════════════════════
export const MOCK_COMMISSIONS = {
  booking: 15,
  airbnb:  18,
};
