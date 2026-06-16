// ══════════════════════════════════════════════════
// price-suggester.js — Sugeridor de Precio Dinámico
// Analiza ocupación histórica del mismo período y
// sugiere precio con justificación detallada.
// ══════════════════════════════════════════════════

import { formatARS } from '../supabase-config.js';

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const PEAK_PERIODS = [
  { name:'Año Nuevo',      month:0,  dayStart:1,  dayEnd:3,  factor:1.35 },
  { name:'Semana Santa',   month:2,  dayStart:24, dayEnd:31, factor:1.40 },
  { name:'Semana Santa',   month:3,  dayStart:1,  dayEnd:6,  factor:1.40 },
  { name:'Fin de Año',     month:11, dayStart:26, dayEnd:31, factor:1.35 },
  { name:'Navidad',        month:11, dayStart:22, dayEnd:26, factor:1.20 },
  { name:'Verano',         month:0,  dayStart:4,  dayEnd:31, factor:1.25 },
  { name:'Verano',         month:1,  dayStart:1,  dayEnd:28, factor:1.25 },
  { name:'Vacaciones jul', month:6,  dayStart:7,  dayEnd:21, factor:1.20 },
];

export class PriceSuggester {
  constructor(supabase, ctx) {
    this.db  = supabase;
    this.ctx = ctx;
  }

  async suggest(unitIds, checkIn, checkOut) {
    if (!unitIds?.length || !checkIn || !checkOut) return null;
    if (checkIn >= checkOut) return null;

    try {
      const ci     = new Date(checkIn  + 'T00:00:00');
      const co     = new Date(checkOut + 'T00:00:00');
      const nights = Math.round((co - ci) / 86400000);
      if (nights <= 0) return null;

      const month    = ci.getMonth();
      const dayStart = ci.getDate();
      const dayEnd   = co.getDate();
      const currentYear = ci.getFullYear();
      const years = [currentYear - 1, currentYear - 2].filter(y => y >= 2022);

      const histData  = await Promise.all(years.map(y => this._fetchHistoricalData(unitIds, month, y)));
      const curData   = await this._fetchCurrentMonthADR(unitIds, month, currentYear);
      const validHist = histData.filter(h => h.bookingCount > 0);

      const avgHistADR = validHist.length
        ? Math.round(validHist.reduce((s,h) => s + h.avgADR, 0) / validHist.length) : 0;
      const avgHistOcc = validHist.length
        ? Math.round(validHist.reduce((s,h) => s + h.occupancyPct, 0) / validHist.length) : 0;

      const basePrice = Math.max(avgHistADR, curData.avgADR, 0);
      if (basePrice === 0) return { suggested:null, hasHistory:false, nights, month, years, confidence:'sin datos', peakName:null, histData };

      const peakFactor   = this._getPeakFactor(month, dayStart, dayEnd);
      const occFactor    = this._getOccupancyFactor(avgHistOcc);
      const lengthFactor = nights >= 7 ? 0.95 : nights >= 3 ? 1.0 : 1.05;

      const raw       = basePrice * peakFactor * occFactor * lengthFactor;
      const suggested = Math.round(raw / 1000) * 1000;
      const peakName  = PEAK_PERIODS.find(p =>
        p.month === month &&
        (dayStart >= p.dayStart && dayStart <= p.dayEnd ||
         dayEnd   >= p.dayStart && dayEnd   <= p.dayEnd)
      )?.name ?? null;

      return {
        suggested, rangeLow: Math.round(suggested*0.90/1000)*1000,
        rangeHigh: Math.round(suggested*1.10/1000)*1000,
        basePrice, peakFactor, occFactor, lengthFactor,
        avgHistOcc, avgHistADR, curMonthADR: curData.avgADR,
        nights, month, years, histData,
        peakName, hasHistory: validHist.length > 0,
        confidence: validHist.length >= 2 ? 'alta' : validHist.length === 1 ? 'media' : 'baja',
      };
    } catch (err) {
      console.warn('[PriceSuggester]', err.message);
      return null;
    }
  }

  async _fetchHistoricalData(unitIds, month, year) {
    const firstDay   = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay    = new Date(year, month+1, 0);
    const lastDayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
    const { data }   = await this.db.from('bookings')
      .select('check_in,check_out,price_per_night,booking_units(unit_id)')
      .eq('hotel_id', this.ctx.hotelId)
      .not('status','in','(cancelled,blocked)')
      .lte('check_in', lastDayStr).gt('check_out', firstDay);

    const bk = (data??[]).filter(b => (b.booking_units??[]).some(bu => unitIds.includes(bu.unit_id)));
    if (!bk.length) return { year, bookingCount:0, avgADR:0, occupancyPct:0 };

    let nights=0, revN=0, priceSum=0;
    bk.forEach(b => {
      const s = new Date(Math.max(new Date(b.check_in+'T00:00:00'), new Date(firstDay+'T00:00:00')));
      const e = new Date(Math.min(new Date(b.check_out+'T00:00:00'), new Date(lastDayStr+'T23:59:59')));
      const n = Math.max(0, Math.round((e-s)/86400000));
      nights += n;
      if (b.price_per_night > 0) { revN += n; priceSum += n * b.price_per_night; }
    });
    return { year, bookingCount:bk.length,
      avgADR:       revN > 0 ? Math.round(priceSum/revN) : 0,
      occupancyPct: Math.min(100, Math.round((nights/(lastDay.getDate()*unitIds.length))*100)) };
  }

  async _fetchCurrentMonthADR(unitIds, month, year) {
    const firstDay = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const today    = new Date().toISOString().split('T')[0];
    const { data } = await this.db.from('bookings')
      .select('price_per_night,booking_units(unit_id)')
      .eq('hotel_id', this.ctx.hotelId)
      .not('status','in','(cancelled,blocked)')
      .gte('check_in', firstDay).lte('check_in', today);
    const bk = (data??[]).filter(b =>
      (b.booking_units??[]).some(bu=>unitIds.includes(bu.unit_id)) && b.price_per_night > 0);
    return { avgADR: bk.length ? Math.round(bk.reduce((s,b)=>s+b.price_per_night,0)/bk.length) : 0 };
  }

  _getPeakFactor(month, dayStart, dayEnd) {
    for (const p of PEAK_PERIODS) {
      if (p.month === month && (
        (dayStart >= p.dayStart && dayStart <= p.dayEnd) ||
        (dayEnd   >= p.dayStart && dayEnd   <= p.dayEnd) ||
        (dayStart <= p.dayStart && dayEnd   >= p.dayEnd)
      )) return p.factor;
    }
    return 1.0;
  }

  _getOccupancyFactor(pct) {
    if (pct >= 90) return 1.25;
    if (pct >= 75) return 1.15;
    if (pct >= 60) return 1.05;
    if (pct >= 40) return 1.00;
    if (pct >= 20) return 0.95;
    return 0.90;
  }

  // ── Renderizado del panel de sugerencia ───────────
  static renderPanel(result, currentPrice = 0) {
    if (!result) return '';
    if (!result.hasHistory) return `
      <div class="ps-box ps-empty">
        <span class="ps-icon">📊</span>
        <div>
          <strong>Sin historial suficiente</strong>
          <p>Se necesita al menos 1 año de reservas para sugerir precio automáticamente.</p>
        </div>
      </div>`;
    if (!result.suggested) return '';

    const fmt = n => n ? '$'+Math.round(n).toLocaleString('es-AR') : '—';
    const diffPct = currentPrice > 0
      ? Math.round(((result.suggested - currentPrice) / currentPrice) * 100) : null;
    const diffColor = diffPct == null ? '' : diffPct > 10 ? '#22c55e' : diffPct < -10 ? '#ef4444' : '#f59e0b';
    const confColor = { alta:'#22c55e', media:'#f59e0b', baja:'#ef4444', 'sin datos':'#94a3b8' }[result.confidence] ?? '#94a3b8';

    const factors = [
      result.peakName   ? `<span class="ps-tag ps-tag-peak">🎉 ${result.peakName} ×${result.peakFactor.toFixed(2)}</span>` : '',
      result.occFactor !== 1.0 ? `<span class="ps-tag">📊 Ocup. hist. ${result.avgHistOcc}% → ×${result.occFactor.toFixed(2)}</span>` : '',
      result.nights >= 7 ? `<span class="ps-tag ps-tag-disc">🌙 Estadía larga ×0.95</span>` : '',
    ].filter(Boolean).join('');

    const histRows = (result.histData ?? []).map(h =>
      h.bookingCount === 0
        ? `<div class="ps-hist-row"><span>${MONTH_NAMES[result.month]} ${h.year}</span><span style="color:#94a3b8">Sin datos</span></div>`
        : `<div class="ps-hist-row">
            <span>${MONTH_NAMES[result.month]} ${h.year}</span>
            <span>${h.bookingCount} res · ${h.occupancyPct}% ocup.</span>
            <strong>${fmt(h.avgADR)}/n</strong>
           </div>`
    ).join('');

    return `
      <div class="ps-box">
        <div class="ps-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="ps-badge">✨ Precio sugerido</span>
            <span style="font-size:.7rem;color:${confColor};font-weight:600">Confianza ${result.confidence}</span>
          </div>
          <button class="ps-use" data-price="${result.suggested}">Usar este precio</button>
        </div>
        <div class="ps-main">
          <span class="ps-price">${fmt(result.suggested)}</span>
          <span class="ps-night">/noche</span>
          ${diffPct !== null ? `<span class="ps-diff" style="color:${diffColor}">${diffPct>0?'+':''}${diffPct}% vs. actual</span>` : ''}
        </div>
        <div class="ps-range">Rango: ${fmt(result.rangeLow)} – ${fmt(result.rangeHigh)}</div>
        ${factors ? `<div class="ps-factors">${factors}</div>` : ''}
        <details class="ps-details">
          <summary>Ver historial que usé como base</summary>
          <div style="margin-top:8px">${histRows || '<span style="color:#94a3b8;font-size:.78rem">Sin datos previos</span>'}</div>
        </details>
      </div>`;
  }
}
