// ═══════════════════════════════════════════════════
// revenue-panel.js — Revenue Management básico
// Curva de demanda histórica · Comparativa YoY
// Sugerencia automática de precio por unidad / 30 días
// ═══════════════════════════════════════════════════

import { formatARS, showToast, getUnitColor, getUnitLabel, AppContext, localToday, localDateISO } from '../supabase-config.js';

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

export class RevenuePanel {
  constructor(supabase, ctx) {
    this.db  = supabase;
    this.ctx = ctx;
  }

  async load() {
    const container = document.getElementById('revenue-container');
    if (!container) return;

    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-3)">
      <div style="font-size:2rem;margin-bottom:12px">⟳</div>Analizando historial de precios...
    </div>`;

    try {
      const now    = new Date();
      const year   = now.getFullYear();
      const month  = now.getMonth();

      // Últimos 24 meses de datos
      const { data: allBookings } = await this.db
        .from('bookings')
        .select('check_in, check_out, price_per_night, total_amount, nights, status, source, booking_units(unit_id)')
        .eq('hotel_id', this.ctx.hotelId)
        .not('status', 'in', '(cancelled,blocked)')
        .gte('check_in', `${year - 2}-01-01`)
        .order('check_in');

      const bookings = allBookings ?? [];

      // Próximos 30 días para sugerencias
      const nextBookings = bookings.filter(b =>
        b.check_in >= localDateISO(now)
      );

      // ADR y ocupación por mes (24 meses)
      const monthly = {};
      for (let i = 0; i < 24; i++) {
        const d = new Date(year, month - 23 + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        monthly[key] = { label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`, revenue: 0, nights: 0, count: 0, prices: [] };
      }

      bookings.forEach(b => {
        const key = b.check_in.slice(0, 7);
        if (!monthly[key]) return;
        monthly[key].revenue += b.total_amount ?? 0;
        monthly[key].nights  += b.nights ?? 0;
        monthly[key].count   += 1;
        if (b.price_per_night > 0) monthly[key].prices.push(b.price_per_night);
      });

      const months = Object.entries(monthly).map(([key, d]) => ({
        key,
        label:       d.label,
        adr:         d.nights > 0 ? Math.round(d.revenue / d.nights) : 0,
        revenue:     Math.round(d.revenue),
        count:       d.count,
        nights:      d.nights,
        medianPrice: d.prices.length ? median(d.prices) : 0,
      }));

      // Sugerencias por unidad para próximos 30 días
      const suggestions = this._buildSuggestions(bookings, months, year, month);

      container.innerHTML = this._render(months, suggestions, year, month);
      this._bindEvents(container, suggestions);

    } catch (err) {
      console.error('[RevenuePanel]', err);
      container.innerHTML = `<div class="error-state"><span class="error-icon">⚠️</span>
        <p>${err.message}</p>
        <button class="btn btn-outline btn-sm" onclick="window._revenuePanel?.load()">🔄 Reintentar</button>
      </div>`;
    }
  }

  _buildSuggestions(bookings, months, year, month) {
    const totalUnits = this.ctx.units.length || 1;
    const sugg = [];

    this.ctx.units.forEach(unit => {
      // Historial de precios de esta unidad
      const unitBookings = bookings.filter(b =>
        (b.booking_units ?? []).some(bu => bu.unit_id === unit.id) &&
        b.price_per_night > 0
      );

      if (!unitBookings.length) return;

      // Precio mediana últimos 3 meses
      const recent = unitBookings
        .filter(b => b.check_in >= `${year}-${String(month-2).padStart(2,'0')}-01`)
        .map(b => b.price_per_night);
      const basePrice = recent.length ? median(recent) : median(unitBookings.map(b => b.price_per_night));

      // Mes siguiente = temporada?
      const nextMonth = (month + 1) % 12;
      const isHighSeason = [0,1,6,7].includes(nextMonth); // enero, feb, julio, agosto
      const isMidSeason  = [10,11,2].includes(nextMonth); // nov, dic, mar

      // ADR mismo mes año anterior
      const samePeriodLastYear = months.find(m => m.key === `${year-1}-${String(month+2).padStart(2,'0')}`);
      const yoyBoost = samePeriodLastYear?.adr > 0 && basePrice > 0
        ? (samePeriodLastYear.adr / basePrice - 1)
        : 0;

      // Ajuste por temporada
      let seasonMult = 1;
      if (isHighSeason) seasonMult = 1.25;
      else if (isMidSeason) seasonMult = 1.12;

      // Ajuste YoY (capped a ±20%)
      const yoyMult = Math.max(0.8, Math.min(1.2, 1 + yoyBoost));

      const suggested = Math.round(basePrice * seasonMult * yoyMult / 1000) * 1000; // redondear a $1000

      sugg.push({
        unit,
        basePrice:    Math.round(basePrice),
        suggested,
        delta:        Math.round(((suggested / basePrice) - 1) * 100),
        isHighSeason,
        seasonLabel:  isHighSeason ? '🔥 Temporada alta' : isMidSeason ? '📈 Temporada media' : '📉 Temporada baja',
        reasoning:    [
          `Base: ${formatARS(basePrice)}/noche (mediana reciente)`,
          isHighSeason || isMidSeason ? `Ajuste temporada: ×${seasonMult.toFixed(2)}` : null,
          Math.abs(yoyBoost) > 0.02 ? `Tendencia interanual: ${yoyBoost > 0 ? '+' : ''}${Math.round(yoyBoost*100)}%` : null,
        ].filter(Boolean),
      });
    });

    return sugg;
  }

  _render(months, suggestions, year, month) {
    const last12 = months.slice(-12);
    const prev12 = months.slice(0, 12);
    const maxADR = Math.max(...last12.map(m => m.adr), 1);
    const maxRev = Math.max(...last12.map(m => m.revenue), 1);

    // YoY comparison
    const curTotalRev  = last12.reduce((s,m) => s+m.revenue, 0);
    const prevTotalRev = prev12.reduce((s,m) => s+m.revenue, 0);
    const yoyPct = prevTotalRev > 0 ? Math.round(((curTotalRev/prevTotalRev)-1)*100) : 0;
    const curADR  = Math.round(last12.reduce((s,m) => s+(m.adr||0), 0) / last12.filter(m=>m.adr>0).length);
    const prevADR = Math.round(prev12.reduce((s,m) => s+(m.adr||0), 0) / prev12.filter(m=>m.adr>0).length);
    const adrYoY  = prevADR > 0 ? Math.round(((curADR/prevADR)-1)*100) : 0;

    return `
    <!-- KPIs YoY -->
    <div class="rev-kpi-row">
      ${this._kpi('Ingresos 12 meses', formatARS(curTotalRev), yoyPct, 'vs año anterior')}
      ${this._kpi('ADR promedio', formatARS(curADR), adrYoY, 'vs año anterior')}
      ${this._kpi('Reservas', last12.reduce((s,m)=>s+m.count,0), null, 'últimos 12 meses')}
      ${this._kpi('Noches', last12.reduce((s,m)=>s+m.nights,0), null, 'últimas 12 meses')}
    </div>

    <!-- Gráfico dual: ADR + Ingresos -->
    <div class="rev-chart-card">
      <div class="rev-chart-header">
        <div class="rev-chart-title">📈 Evolución ADR e Ingresos — últimos 12 meses</div>
        <div class="rev-chart-legend">
          <span style="color:var(--color-primary)">━ ADR</span>
          <span style="color:var(--color-primary);opacity:.55;margin-left:12px">▪ Ingresos</span>
        </div>
      </div>
      <div class="rev-chart-body">
        ${last12.map((m, i) => {
          const hRev = Math.max(4, Math.round((m.revenue / maxRev) * 120));
          const hAdr = Math.max(2, Math.round((m.adr / maxADR) * 120));
          return `<div class="rev-bar-group" title="${m.label}: ${formatARS(m.revenue)} · ADR ${formatARS(m.adr)}">
            <div class="rev-bar-revenue" style="height:${hRev}px"></div>
            <div class="rev-bar-adr" style="height:${hAdr}px"></div>
            <div class="rev-bar-label">${m.label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- YoY Comparativa -->
    <div class="rev-chart-card">
      <div class="rev-chart-header">
        <div class="rev-chart-title">📊 Comparativa interanual — Ingresos por mes</div>
        <div class="rev-chart-legend">
          <span style="color:var(--color-primary)">━ Este año</span>
          <span style="color:var(--color-text-3);margin-left:12px">━ Año anterior</span>
        </div>
      </div>
      <div class="rev-chart-body">
        ${MONTH_NAMES.map((label, mi) => {
          const cur  = months.find(m => m.key === `${year}-${String(mi+1).padStart(2,'0')}`);
          const prev = months.find(m => m.key === `${year-1}-${String(mi+1).padStart(2,'0')}`);
          const maxV = Math.max(cur?.revenue??0, prev?.revenue??0, 1);
          const hCur  = Math.max(3, Math.round(((cur?.revenue??0) / maxV) * 100));
          const hPrev = Math.max(3, Math.round(((prev?.revenue??0) / maxV) * 100));
          return `<div class="rev-bar-group rev-yoy" title="${label}: ${formatARS(cur?.revenue??0)} vs ${formatARS(prev?.revenue??0)}">
            <div class="rev-bar-revenue" style="height:${hCur}px"></div>
            <div class="rev-bar-prev" style="height:${hPrev}px"></div>
            <div class="rev-bar-label">${label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Sugerencias de precio -->
    ${suggestions.length ? `
    <div class="rev-chart-card">
      <div class="rev-chart-header">
        <div class="rev-chart-title">💡 Sugerencias de precio — próximo mes</div>
        <div style="font-size:.72rem;color:var(--color-text-3)">Basadas en historial + estacionalidad</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0">
        ${suggestions.map(s => `
          <div class="rev-suggestion-row" data-unit-id="${s.unit.id}" data-price="${s.suggested}">
            <div style="display:flex;align-items:center;gap:10px;flex:1">
              <div style="width:10px;height:10px;border-radius:50%;background:${getUnitColor(s.unit)};flex-shrink:0"></div>
              <div>
                <div style="font-weight:700;font-size:.85rem">${getUnitLabel(s.unit)}</div>
                <div style="font-size:.72rem;color:var(--color-text-3)">${s.seasonLabel}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <div style="text-align:right">
                <div style="font-size:.7rem;color:var(--color-text-3)">Base</div>
                <div style="font-size:.82rem">${formatARS(s.basePrice)}</div>
              </div>
              <div style="color:var(--color-text-3);font-size:.8rem">→</div>
              <div style="text-align:right">
                <div style="font-size:.7rem;color:var(--color-text-3)">Sugerido</div>
                <div style="font-size:1rem;font-weight:800;color:${s.delta > 3 ? 'var(--state-green-txt)' : s.delta < -3 ? 'var(--state-red-txt)' : 'var(--state-yellow-txt)'}">
                  ${formatARS(s.suggested)}
                  <span style="font-size:.7rem">${s.delta > 0 ? '+' : ''}${s.delta}%</span>
                </div>
              </div>
              <button class="btn btn-outline btn-sm rev-apply-btn" data-price="${s.suggested}" title="${s.reasoning.join('\n')}">
                Aplicar
              </button>
            </div>
          </div>
        `).join('')}
      </div>
      <p style="font-size:.7rem;color:var(--color-text-3);margin-top:12px;padding:0 2px">
        ⚠ Son sugerencias basadas en datos históricos. Revisá antes de aplicar.
      </p>
    </div>` : ''}
    `;
  }

  _kpi(label, value, pct, sub) {
    // Criterio de color: verde = bueno (mejora clara), amarillo = medio (estable),
    // rojo = malo (caída clara). Igual que el resto de MILA (Ocupación, etc).
    const deltaColor = pct == null ? '' : pct >= 5 ? 'color:var(--state-green-txt);background:var(--state-green-bg)'
      : pct <= -5 ? 'color:var(--state-red-txt);background:var(--state-red-bg)'
      : 'color:var(--state-yellow-txt);background:var(--state-yellow-bg)';
    const delta = pct != null ? `<span style="font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:99px;${deltaColor}">${pct >= 0 ? '+' : ''}${pct}%</span>` : '';
    return `<div class="rev-kpi-card">
      <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3);margin-bottom:4px">${label}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1.3rem;font-weight:800">${value}</span>
        ${delta}
      </div>
      <div style="font-size:.72rem;color:var(--color-text-3);margin-top:2px">${sub}</div>
    </div>`;
  }

  _bindEvents(container, suggestions) {
    container.querySelectorAll('.rev-apply-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const price  = parseFloat(btn.dataset.price);
        const row    = btn.closest('.rev-suggestion-row');
        const unitId = row?.dataset.unitId;
        if (!unitId || !price) return;

        if (!confirm(`Aplicar ${formatARS(price)}/noche como precio base sugerido para esta unidad?\n\nEste precio se usará como sugerencia al crear nuevas reservas.`)) return;

        try {
          await this.db.from('units').update({ suggested_price: price }).eq('id', unitId);
          showToast(`Precio sugerido guardado: ${formatARS(price)} ✓`, 'success');
          btn.textContent = '✓ Aplicado';
          btn.disabled = true;
          btn.style.color = 'var(--color-success)';
        } catch {
          showToast('Error al guardar precio', 'error');
        }
      });
    });
  }
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid-1]+sorted[mid])/2);
}
