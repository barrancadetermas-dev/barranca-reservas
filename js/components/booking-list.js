import { can, isDemo } from "../auth/permissions.js";
// ═══════════════════════════════════════════════════
// booking-list.js v5.1 — Listado y Archivo de Reservas
// + Flag visual de huésped conflictivo
// + Acciones completas (checkout, cancelar, duplicar)
// + Exportar PDF y Excel desde la lista
// ═══════════════════════════════════════════════════

import { formatARS, formatDate, showToast, getUnitChipHTML, getSourceBadgeHTML, getBookingBarColor, getUnitLabel, getUnitColor, SOURCE_CONFIG, localToday, localDateISO, AppContext, getNationalityFlag, appendNote } from '../supabase-config.js';
import { logAction } from '../services/audit-service.js';
import { Bus, EVENTS } from '../services/event-bus.js';

const STATUS_LABELS = {
  pending:   'Sin seña',
  partial:   'Señada',
  paid:      'Abonada',
  cancelled: 'Cancelada',
  blocked:   'Bloqueada',
};

const STATUS_CLASSES = {
  pending:   'status-pending',
  partial:   'status-partial',
  paid:      'status-paid',
  cancelled: 'status-cancelled',
  blocked:   'status-blocked',
};

export class BookingList {
  constructor(supabase, ctx, bookingForm) {
    this.db          = supabase;
    this.ctx         = ctx;
    this.bookingForm = bookingForm;

    this._tab      = 'active';
    this._search   = '';
    this._status   = '';
    this._unit     = '';
    this._source   = '';
    this._dateFrom = '';
    this._dateTo   = '';
    this._page     = 1;
    this._pageSize = 30;
    this._sortBy   = 'check_in_asc'; // más próximas primero por defecto
    this._allBookings = [];

    this._bindTabs();
    this._bindFilters();
    this._bindSourceFilters();
    this._populateUnitFilter();
    this._bindGuestNameTooltip();

    // Event delegation en capture phase para evitar que stopPropagation de hijos bloquee
    document.getElementById('bookings-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      const row = e.target.closest('.booking-row');
      if (!row) return;
      const id = row.dataset.bookingId;

      if (!btn) {
        // Clic en la fila (fuera de botones) → ver detalle
        if (!e.target.closest('.booking-actions-cell')) {
          this._openDetail(id);
        }
        return;
      }

      e.stopPropagation(); // evitar que el clic en botón abra el detalle
      const action = btn.dataset.action;
      if (action === 'view')      this._openDetail(id);
      if (action === 'edit')      this.bookingForm.openEdit(id);
      if (action === 'whatsapp')  this._sendWhatsApp(id);
      if (action === 'delete')    this._deleteBooking(id);
      if (action === 'checkout')  this._doCheckout(id);
      if (action === 'flag')      this._openFlagModal(id, row);
      if (action === 'duplicate') this._duplicateBooking(id);
      if (action === 'pay-full')  this._payFull(id);
      if (action === 'reprogram') this._reprogramBooking(id);
      if (action === 'void-credit-note') this._voidCreditNote(btn.dataset.id);
    }, true); // ← capture phase: recibe el evento ANTES de que los hijos llamen stopPropagation

    document.addEventListener('booking:changed', () => {
      if (document.getElementById('section-bookings')?.classList.contains('active')) {
        this.load();
      }
    });
  }

  // ── Carga principal ────────────────────────────────
  // ── Avatar con iniciales y color consistente ─────
  static _avatar(guest) {
    if (!guest) return '<div class="bl-avatar bl-avatar-empty">?</div>';
    const fn = guest.first_name ?? '';
    const ln = guest.last_name  ?? '';
    const initials = ((fn[0] ?? '') + (ln[0] ?? '')).toUpperCase() || '?';
    // Hash simple para color consistente por huésped
    const str   = (fn + ln).toLowerCase();
    let hash    = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue   = Math.abs(hash) % 360;
    const bg    = `hsl(${hue},55%,88%)`;
    const color = `hsl(${hue},55%,32%)`;
    return `<div class="bl-avatar" style="background:${bg};color:${color}" title="${fn} ${ln}">${initials}</div>`;
  }

  async load() {
    try {
      // Si venimos de un link "Ver reservas →" del dashboard (Dinero
      // asegurado / Cobros del mes), abrir ya ordenado por saldo pendiente.
      if (sessionStorage.getItem('mila_jump_pending_balance') === '1') {
        sessionStorage.removeItem('mila_jump_pending_balance');
        this._sortBy = 'balance_desc';
      }
      if (this.ctx.IS_DEMO) {
        const { generateMockBookings } = await import('../services/mock-data.js');
        const now = new Date();
        this._allBookings = generateMockBookings(this.ctx.units, now.getFullYear(), now.getMonth());
        this._render(localDateISO(now));
        return;
      }

      const { data, error } = await this.db
        .from('bookings')
        .select(`
          id, check_in, check_out, nights, status, source,
          total_amount, total_paid, balance, price_per_night,
          notes, is_blocked, block_reason, created_at, adults, children, pax,
          checked_in_at, checked_out_at,
          guests!bookings_guest_id_fkey(
            id, first_name, last_name, dni, phone,
            bad_experience, bad_experience_note, tags, age, car_model, car_plate, nationality
          ),
          booking_units(unit_id, price_per_night, units(name, sort_order, color))
        `)
        .eq('hotel_id', this.ctx.hotelId)
        .order('check_in', { ascending: true });

      if (error) throw error;
      this._allBookings = data ?? [];

      // Pagos en consulta separada (evita duplicación + permite desglose real
      // por unidad en el tooltip al pasar el mouse sobre el huésped).
      const ids = this._allBookings.map(b => b.id);
      if (ids.length) {
        const { data: paymentsData } = await this.db.from('payments')
          .select('booking_id, amount, unit_id')
          .in('booking_id', ids);
        const byBooking = {};
        (paymentsData ?? []).forEach(p => { (byBooking[p.booking_id] ??= []).push(p); });
        this._allBookings.forEach(b => { b.payments = byBooking[b.id] ?? []; });
      }

      this._render(localToday());
      this._updateNavBadge(data);

    } catch (err) {
      console.error('BookingList load error:', err);
      showToast('Error al cargar reservas', 'error');
    }
  }

  // ── Tabs ──────────────────────────────────────────
  _bindTabs() {
    document.querySelectorAll('#section-bookings .tabs-bar .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#section-bookings .tabs-bar .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._tab    = tab.dataset.tab;
        this._page   = 1;
        // Default sort per tab: active → próximas primero; archive → más recientes primero
        this._sortBy = this._tab === 'archive' ? 'check_in_desc' : 'check_in_asc';
        this._render(localToday());
      });
    });
  }

  _bindSourceFilters() {
    document.querySelectorAll('.source-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.source-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._source = btn.dataset.source;
        this._page   = 1;
        this._render(localToday());
      });
    });
    document.querySelector('.source-filter-btn[data-source=""]')?.classList.add('active');
  }

  _bindFilters() {
    const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    document.getElementById('booking-search')?.addEventListener('input', deb((e) => {
      this._search = e.target.value.trim().toLowerCase();
      this._page   = 1;
      this._render(localToday());
    }, 250));

    ['filter-status', 'filter-unit', 'filter-date-from', 'filter-date-to'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', (e) => {
        const key = '_' + id.replace('filter-', '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this[key] = e.target.value;
        this._page = 1;
        this._updateDateClearBtn();
        this._render(localToday());
      });
    });

    // Limpiar fechas
    document.getElementById('filter-date-clear')?.addEventListener('click', () => {
      document.getElementById('filter-date-from').value = '';
      document.getElementById('filter-date-to').value   = '';
      this._dateFrom = '';
      this._dateTo   = '';
      this._updateDateClearBtn();
      this._clearActivePreset();
      this._page = 1;
      this._render(localToday());
    });

    // Presets de fecha rápidos
    document.querySelectorAll('.date-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const now   = new Date();
        const y     = now.getFullYear();
        const m     = now.getMonth();
        let from, to;

        switch (btn.dataset.preset) {
          case 'today':
            from = to = localDateISO(now);
            break;
          case 'week': {
            const day  = now.getDay() || 7;
            const mon  = new Date(now); mon.setDate(now.getDate() - day + 1);
            const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
            from = localDateISO(mon);
            to   = localDateISO(sun);
            break;
          }
          case 'month':
            from = `${y}-${String(m+1).padStart(2,'0')}-01`;
            to   = new Date(y, m+1, 0).toISOString().split('T')[0];
            break;
          case 'last-month':
            from = new Date(y, m-1, 1).toISOString().split('T')[0];
            to   = new Date(y, m, 0).toISOString().split('T')[0];
            break;
          case 'next-month':
            from = new Date(y, m+1, 1).toISOString().split('T')[0];
            to   = new Date(y, m+2, 0).toISOString().split('T')[0];
            break;
          case 'year':
            from = `${y}-01-01`;
            to   = `${y}-12-31`;
            break;
        }

        if (from && to) {
          document.getElementById('filter-date-from').value = from;
          document.getElementById('filter-date-to').value   = to;
          this._dateFrom = from;
          this._dateTo   = to;
          this._updateDateClearBtn();
          // Marcar preset activo visualmente
          document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this._page = 1;
          this._render(localToday());
        }
      });
    });

    // Load more
    document.getElementById('btn-load-more')?.addEventListener('click', () => {
      this._page++;
      this._render(localToday());
    });
  }

  _updateDateClearBtn() {
    const btn = document.getElementById('filter-date-clear');
    if (btn) btn.style.display = (this._dateFrom || this._dateTo) ? '' : 'none';
  }

  _clearActivePreset() {
    document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
  }

  _populateUnitFilter() {
    const sel = document.getElementById('filter-unit');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todas las unidades</option>';
    this.ctx.units.forEach(u => {
      sel.innerHTML += `<option value="${u.id}">#${u.sort_order ?? '?'} · ${u.name}</option>`;
    });
  }

  // ── Filtros aplicados ─────────────────────────────
  _applyFilters(bookings, today) {
    return bookings.filter(b => {
      const isArchive = b.check_out < today;
      if (this._tab === 'active'  && isArchive)  return false;
      if (this._tab === 'archive' && !isArchive) return false;

      if (this._status && b.status !== this._status) return false;
      if (this._source && b.source !== this._source) return false;
      if (this._unit) {
        const units = (b.booking_units ?? []).map(bu => bu.unit_id);
        if (!units.includes(this._unit)) return false;
      }
      if (this._dateFrom && b.check_in  < this._dateFrom) return false;
      if (this._dateTo   && b.check_out > this._dateTo)   return false;

      if (this._search) {
        const g    = b.guests;
        const name = g ? `${g.first_name} ${g.last_name}`.toLowerCase() : '';
        const dni  = (g?.dni ?? '').toLowerCase();
        const unit = (b.booking_units ?? []).map(bu => bu.units?.name ?? '').join(' ').toLowerCase();
        if (!name.includes(this._search) && !dni.includes(this._search) && !unit.includes(this._search)) return false;
      }

      return true;
    });
  }

  // ── Ordenamiento ──────────────────────────────────
  _sortBookings(arr) {
    const sorted = [...arr];
    switch (this._sortBy) {
      case 'check_in_asc':  return sorted.sort((a, b) => a.check_in.localeCompare(b.check_in));
      case 'check_in_desc': return sorted.sort((a, b) => b.check_in.localeCompare(a.check_in));
      case 'unit_asc':      return sorted.sort((a, b) =>
        (a.booking_units?.[0]?.units?.sort_order ?? 99) -
        (b.booking_units?.[0]?.units?.sort_order ?? 99));
      case 'amount_asc':    return sorted.sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
      case 'amount_desc':   return sorted.sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
      case 'balance_desc':  return sorted.sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0));
      default:              return sorted;
    }
  }

  _renderSortTabs() {
    const OPTS = [
      { value: 'check_in_asc',  label: '📅 Próximas' },
      { value: 'check_in_desc', label: '📅 Lejanas'  },
      { value: 'unit_asc',      label: '🏠 Depto.'   },
      { value: 'amount_asc',    label: '💰 Menor'    },
      { value: 'amount_desc',   label: '💰 Mayor'    },
      { value: 'balance_desc',  label: '🔴 Saldo pendiente' },
    ];
    return `
      <div class="bl-sort-wrap">
        <span class="bl-sort-label">Ordenar:</span>
        <select id="bl-sort-select" class="filter-select" style="font-size:.78rem;padding:4px 8px">
          ${OPTS.map(o => `<option value="${o.value}" ${this._sortBy === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>`;
  }

  // ── Pago total desde la lista ─────────────────────
  async _payFull(id) {
    const b = this._allBookings.find(x => x.id === id);
    if (!b) return;
    const balance = Math.max(0, Number(b.balance ?? 0));
    if (balance <= 0) { showToast('Esta reserva ya está pagada ✓', 'info'); return; }

    const existing = document.getElementById('overlay-pay-full');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-pay-full';
    const guest = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Huésped';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">✅ Registrar pago total</h3>
          <button class="modal-close" id="pf-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.875rem;margin-bottom:16px">
            <strong>${guest}</strong> · Saldo a cobrar: <strong style="color:var(--color-primary)">${formatARS(balance)}</strong>
          </p>
          <div class="form-group">
            <label class="form-label">Método de pago</label>
            <select id="pf-method" class="form-input">
              <option value="cash">💵 Efectivo</option>
              <option value="transfer" selected>🏦 Transferencia</option>
              <option value="card">💳 Tarjeta</option>
              <option value="mercadopago">💙 MercadoPago</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Fecha</label>
            <input type="date" id="pf-date" class="form-input" value="${new Date().toISOString().slice(0,10)}">
          </div>
          <div class="form-group">
            <label class="form-label">Notas (opcional)</label>
            <input type="text" id="pf-notes" class="form-input" placeholder="Ej: pago en mostrador">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="pf-cancel">Cancelar</button>
          <button class="btn btn-primary" id="pf-confirm">Confirmar pago ${formatARS(balance)}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('#pf-close').onclick   = close;
    modal.querySelector('#pf-cancel').onclick  = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#pf-confirm').addEventListener('click', async () => {
      const btn = modal.querySelector('#pf-confirm');
      btn.disabled = true; btn.textContent = '⏳ Registrando…';

      // 1. Insertar el pago (el trigger SQL recalcula total_paid y balance automáticamente)
      const { error: payErr } = await this.db.from('payments').insert({
        booking_id:   id,
        hotel_id:     this.ctx.hotelId,
        amount:       balance,
        currency:     'ARS',
        payment_type: 'balance',
        method:       document.getElementById('pf-method').value,
        payment_date: document.getElementById('pf-date').value,
        notes:        document.getElementById('pf-notes').value.trim() || null,
      });
      if (payErr) {
        showToast('Error al registrar pago: ' + payErr.message, 'error');
        btn.disabled = false; btn.textContent = `Confirmar pago ${formatARS(balance)}`;
        return;
      }

      // 2. Actualizar status de la reserva a 'paid'
      await this.db.from('bookings')
        .update({ status: 'paid', updated_at: new Date().toISOString() })
        .eq('id', id);

      close();
      showToast('✅ Pago registrado — reserva abonada en su totalidad', 'success');
      document.dispatchEvent(new CustomEvent('booking:changed'));
    });
  }

  // ── Rebuild sin recargar de Supabase (para filtros/sort locales) ──
  _rebuildList() {
    this._render(localToday());
  }

  // ── Render principal ──────────────────────────────
  _render(today) {
    const container = document.getElementById('bookings-list');
    if (!container) return;

    const filtered = this._applyFilters(this._allBookings, today);
    const sorted   = this._sortBookings(filtered);
    const showing  = sorted.slice(0, this._page * this._pageSize);
    const hasMore  = sorted.length > showing.length;

    if (!filtered.length) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">📋</span>
          <p>${this._tab === 'active' ? 'No hay reservas activas.' : 'No hay reservas en el archivo.'}</p>
          ${this._search || this._status || this._unit || this._source
            ? '<p style="font-size:.78rem;color:var(--color-text-3)">Probá cambiando los filtros.</p>' : ''}
        </div>`;
      return;
    }

    let html = '';

    // Sort tabs
    html += this._renderSortTabs();

    // Header con conteo, totales y exportar
    // Mismo criterio que ya usamos en el Dashboard: una reserva cancelada
    // con nota de crédito ABIERTA sigue sumando lo que ya cobró (esa
    // plata es real), pero no aporta nada a "por cobrar" — ese saldo ya
    // no se va a cobrar nunca.
    const nonCancelled = filtered.filter(b => b.status !== 'cancelled');
    const cancelledWithNC = filtered.filter(b =>
      b.status === 'cancelled' && b.notes?.includes('🔄NC:') &&
      !b.notes?.includes('✅NCUSED') && !b.notes?.includes('❌NCVOID')
    );
    const totalVendido  = nonCancelled.reduce((s,b) => s + (b.total_amount ?? 0), 0)
                         + cancelledWithNC.reduce((s,b) => s + (b.total_paid ?? 0), 0);
    const senasCobradas = nonCancelled.reduce((s,b) => s + (b.total_paid ?? 0), 0)
                         + cancelledWithNC.reduce((s,b) => s + (b.total_paid ?? 0), 0);
    const porCobrar      = nonCancelled.reduce((s,b) => s + (b.balance ?? 0), 0);

    html += `<div class="list-header-bar" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span class="list-count">${filtered.length} reserva${filtered.length !== 1 ? 's' : ''}</span>
        <span style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--color-text-3)">
          Total vendido <b style="color:var(--color-text)">${formatARS(totalVendido)}</b>
        </span>
        <span style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--color-text-3)">
          Señas cobradas <b style="color:#16a34a">${formatARS(senasCobradas)}</b>
        </span>
        <span style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--color-text-3)">
          Por cobrar <b style="color:var(--state-yellow-txt,#b45309)">${formatARS(porCobrar)}</b>
        </span>`;

    if (can('exportData')) {
      html += `<button class="btn btn-outline btn-sm" id="btn-export-list" style="gap:5px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Exportar ▾
      </button>`;
    }
    html += `</div>`;

    if (can('exportData')) {
      html += `<button class="btn btn-sm" id="btn-share-encargada" style="gap:5px;background:#e0f2fe;color:#0284c7;border:1.5px solid #7dd3fc;font-weight:700">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Encargada
      </button>`;
    }
    html += `</div>`;

    // Filas
    html += showing.map(b => this._renderRow(b, today)).join('');

    // Load more
    if (hasMore) {
      html += `<div style="text-align:center;padding:16px">
        <button class="btn btn-outline" id="btn-load-more">
          Ver más (${filtered.length - showing.length} restantes)
        </button></div>`;
    }

    container.innerHTML = html;

    // Bind sort tabs
    container.querySelector('#bl-sort-select')?.addEventListener('change', (e) => {
      this._sortBy = e.target.value;
      this._page = 1;
      this._rebuildList();
    });;

    // Bind botón único EXPORTAR ▾
    document.getElementById('btn-share-encargada')?.addEventListener('click', () => {
      import('../modules/encargada-share/encargada-share.js').then(({ openEncargadaShare }) => {
        openEncargadaShare(this._allBookings ?? []);
      }).catch(err => console.error('[Encargada]', err));
    });

    document.getElementById('btn-export-list')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      import('../services/export-service.js').then(({ showExportDropdown, exportBookingsExcel, exportBookingsCSV, exportBookingsPDF }) => {
        showExportDropdown({
          anchorEl: btn,
          type: 'bookings',
          data: this._allBookings ?? [],
          onExport: ({ fmt: f, data, from, to }) => {
            const range = from && to ? `${from.split('-').reverse().join('/')} → ${to.split('-').reverse().join('/')}` : '';
            if (f === 'excel') exportBookingsExcel(data, 'reservas', range);
            else if (f === 'pdf') exportBookingsPDF(data, range);
            else exportBookingsCSV(data);
          },
        });
      }).catch(err => console.error('[Export]', err));
    });
    document.getElementById('btn-load-more')?.addEventListener('click', () => {
      this._page++;
      this._render(today);
    });
  }

  // ── Fila individual ────────────────────────────────
  _renderRow(b, today) {
    const g      = b.guests;
    const guest  = g ? `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() : (b.is_blocked ? 'Bloqueo' : 'Sin huésped');
    const { color: barColor, label: barLabel } = getBookingBarColor(b);
    const units  = (b.booking_units ?? []);
    // La línea lateral ahora marca la(s) unidad(es) de la reserva — mismo
    // color que usa el calendario para cada depto. Con una sola unidad
    // queda sólida; con varias, se divide en franjas iguales (gradiente
    // con cortes duros, no degradé real).
    const unitColorsForAccent = units.map(bu => bu.units?.color ?? barColor).filter(Boolean);
    const accentBg = unitColorsForAccent.length <= 1
      ? (unitColorsForAccent[0] ?? barColor)
      : (() => {
          const n = unitColorsForAccent.length;
          const stops = unitColorsForAccent.flatMap((c, i) => [
            `${c} ${(i / n * 100).toFixed(2)}%`,
            `${c} ${((i + 1) / n * 100).toFixed(2)}%`,
          ]);
          return `linear-gradient(to bottom, ${stops.join(', ')})`;
        })();
    const unitChips = units.map(bu => {
      const u = { ...bu.units, id: bu.unit_id };
      return getUnitChipHTML(u, 'sm');
    });
    // Con más de 2 unidades, en vez de que el wrap dependa del ancho
    // disponible (rompía la alineación de la fila entera), se agrupan de
    // a 2 por línea siempre, y la card crece hacia abajo prolijamente.
    const unitChipsHTML = unitChips.length > 2
      ? `<div class="bl-unit-chips-grid">${unitChips.join('')}</div>`
      : unitChips.join(' ');

    // Flags de huésped
    const isBad   = g?.bad_experience || (g?.tags ?? []).includes('no_recomendar');
    const isVIP   = (g?.tags ?? []).includes('vip');
    const isFrecuente = (g?.tags ?? []).includes('frecuente');

    // Detectar cliente recurrente: cuántas reservas no canceladas tiene en toda la lista
    const prevStays = g?.id
      ? (this._allBookings ?? []).filter(x =>
          x.guests?.id === g.id &&
          x.id !== b.id &&
          x.status !== 'cancelled'
        ).length
      : 0;
    const isRecurring = prevStays > 0;

    const flagHTML = isBad ? `<span class="guest-flag flag-bad" title="${g?.bad_experience_note ?? 'Mala experiencia'}">⚑ Conflictivo</span>`
                  : isVIP ? `<span class="guest-flag flag-vip" title="Huésped VIP">★ VIP</span>`
                  : isFrecuente ? `<span class="guest-flag flag-freq" title="Huésped frecuente">♺ Frecuente</span>`
                  : isRecurring ? `<span class="guest-flag flag-recurring" title="Ya se hospedó ${prevStays} vez${prevStays > 1 ? 'ces' : ''} antes">↩ Cliente</span>`
                  : '';

    const isToday  = (b.check_in === today || b.check_out === today) && b.status !== 'cancelled';
    // "Alojada" — el huésped ya hizo check-in y todavía no hizo check-out,
    // y no es ninguno de los 2 días especiales (llegada/salida) de hoy —
    // es una estadía que ya está en curso.
    const isStaying = !isToday && b.status !== 'cancelled' && !!b.checked_in_at && !b.checked_out_at
                     && b.check_in < today && b.check_out > today;
    const statusCls = STATUS_CLASSES[b.status] ?? '';
    const statusLbl = STATUS_LABELS[b.status]  ?? b.status;
    const nights   = b.nights ?? Math.round((new Date(b.check_out) - new Date(b.check_in)) / 86400000);

    return `
      <div class="booking-row ${isBad ? 'booking-row-bad' : ''} ${b.status === 'cancelled' ? 'booking-row-cancelled' : ''}" data-booking-id="${b.id}"
           style="cursor:pointer">
        <div class="booking-row-accent" style="background:${accentBg}" title="${units.map(bu => bu.units?.name).filter(Boolean).join(' · ') || barLabel}"></div>
        <div class="booking-row-body">
          <div class="bl-row-main">
            <div class="bl-col-guest">
              ${BookingList._avatar(g)}
              <div class="bl-guest-info">
                <div class="bl-guest-name bl-guest-name-hover" data-booking-id="${b.id}">${getNationalityFlag(g?.nationality) ? getNationalityFlag(g?.nationality) + ' ' : ''}${guest}${flagHTML ? ' '+flagHTML : ''}</div>
                <div class="bl-guest-meta">${unitChipsHTML}${getSourceBadgeHTML(b.source)}</div>
              </div>
            </div>
            <div class="bl-col-dates">
              <span class="bl-dates">${formatDate(b.check_in)} → ${formatDate(b.check_out)}</span>
              <span class="bl-nights">${nights} ${nights === 1 ? 'noche' : 'noches'}</span>
            </div>
            <div class="bl-col-amount">
              ${(() => {
                const ncMatch = b.status === 'cancelled' ? b.notes?.match(/🔄NC:(\d+):/) : null;
                const ncUsed  = b.notes?.includes('✅NCUSED') || b.notes?.includes('❌NCVOID');
                if (ncMatch && !ncUsed) {
                  const ncAmount = parseInt(ncMatch[1]);
                  return `
                    <div class="bl-amount-total" style="text-decoration:line-through;opacity:.45">${formatARS(b.total_amount)}</div>
                    <div class="bl-amount-breakdown" style="opacity:.45">
                      <span class="bl-balance" style="text-decoration:line-through">${formatARS(b.balance)}</span>
                    </div>
                    <div style="font-size:.78rem;font-weight:700;color:#7c3aed;margin-top:2px">🔄 NC ${formatARS(ncAmount)}</div>`;
                }
                return `
                  <div class="bl-amount-total">${formatARS(b.total_amount)}</div>
                  ${b.total_paid > 0 && b.balance > 0
                    ? `<div class="bl-amount-breakdown">
                        <span class="bl-paid">−${formatARS(b.total_paid)}</span>
                        <span class="bl-sep">=</span>
                        <span class="bl-balance">${formatARS(b.balance)}</span>
                       </div>`
                    : b.balance <= 0
                      ? `<div class="bl-amount-paid">✓ Pagado</div>`
                      : ''
                  }`;
              })()}
            </div>
            <div class="bl-col-status">
              <span class="status-badge ${statusCls}">${statusLbl}</span>
              ${(() => {
                const m = b.notes?.match(/🔄NC:(\d+):(\d{4}-\d{2}-\d{2})/);
                if (!m || b.notes?.includes('✅NCUSED') || b.notes?.includes('❌NCVOID')) return '';
                const amount = parseInt(m[1], 10);
                const ageDays = Math.round((Date.now() - new Date(m[2] + 'T00:00:00')) / 86400000);
                const stale = ageDays >= 90; // ~3 meses
                return stale
                  ? `<span class="status-badge" data-action="void-credit-note" data-id="${b.id}"
                       style="background:var(--state-red-bg);color:var(--state-red-txt);border:1px solid rgba(239,68,68,.25);cursor:pointer"
                       title="Nota de crédito de ${formatARS(amount)} sin usar hace ${ageDays} días — click para anularla">
                       ⚠️ NC vieja (${ageDays}d) · anular</span>`
                  : `<span class="status-badge" style="background:rgba(124,58,237,.1);color:#7c3aed;border:1px solid rgba(124,58,237,.2)" title="Nota de crédito abierta de ${formatARS(amount)}">🔄 NC abierta</span>`;
              })()}
              ${b.balance > 0 && b.status !== 'cancelled' ? `<button data-action="pay-full" class="bl-action-btn bl-payfull-btn"
                onclick="event.stopPropagation()">✅ Cobrar</button>` : ''}
            </div>
            <div class="booking-actions-cell" onclick="event.stopPropagation()">
              <button data-action="edit"
                class="bl-action-btn"
                title="Editar reserva" aria-label="Editar reserva">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button data-action="whatsapp"
                class="bl-action-btn whatsapp"
                title="Enviar por WhatsApp" aria-label="Enviar comprobante por WhatsApp">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                  <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
                </svg>
              </button>
              <button data-action="flag"
                class="bl-action-btn ${isBad ? 'danger' : ''}"
                title="${isBad ? 'Huésped marcado como conflictivo' : 'Marcar huésped'}"
                aria-label="${isBad ? 'Huésped marcado como conflictivo' : 'Marcar huésped'}">
                <svg viewBox="0 0 24 24" fill="${isBad ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
              </button>
              ${b.status !== 'cancelled' ? `<button data-action="reprogram" class="bl-action-btn" title="Reprogramar — cancela esta reserva y abre una nueva con nota de crédito" aria-label="Reprogramar reserva">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/>
                    <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
                  </svg>
                </button>` : ''}
              ${b.check_out === today && b.status !== 'cancelled'
                ? `<button data-action="checkout" class="bl-action-btn" title="Registrar check-out" aria-label="Registrar check-out"
                     style="color:#22c55e;border-color:#22c55e;background:rgba(34,197,94,.08)">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                   </button>`
                : ''}
              ${can('deleteBooking') ? `<button data-action="delete" class="bl-action-btn danger" title="Eliminar reserva" aria-label="Eliminar reserva">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                </svg>
              </button>` : ''}
            </div>
          </div>
          ${(() => {
            // El círculo cambia de color según el estado ECONÓMICO de la
            // reserva (pagó todo / solo señó / no pagó nada) — el texto
            // (CHECK-IN / ALOJADA / CHECK-OUT) sigue indicando la
            // situación real, en los 3 casos.
            const payDot = b.status === 'paid' ? '🟢' : b.status === 'partial' ? '🔴' : '🟡';
            if (isToday && b.check_in === today)  return `<div class="booking-today-banner" style="background:${barColor}18;border-color:${barColor}">${payDot} CHECK-IN HOY</div>`;
            if (isToday && b.check_out === today) return `<div class="booking-today-banner" style="background:${barColor}18;border-color:${barColor}">${payDot} CHECK-OUT HOY</div>`;
            if (isStaying) return `<div class="booking-today-banner" style="background:#8B5CF618;border-color:#8B5CF6;color:#8B5CF6">${payDot} ALOJADA</div>`;
            return '';
          })()}
        </div>
          ${b.notes ? `<div class="bl-notes-row">💬 ${b.notes.length > 100 ? b.notes.slice(0,100)+'…' : b.notes}</div>` : ''}
      </div>`;
  }

  // ── Modal de FLAG de huésped ───────────────────────
  async _openFlagModal(bookingId, row) {
    const booking = this._allBookings.find(b => b.id === bookingId);
    const guest   = booking?.guests;
    if (!guest?.id) { showToast('No hay huésped asociado', 'warning'); return; }

    const existing = document.getElementById('overlay-flag-guest');
    if (existing) existing.remove();

    const currentTags = guest.tags ?? [];
    const isBad       = guest.bad_experience ?? false;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-flag-guest';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Marcar Huésped</h3>
          <button class="modal-close" id="flag-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.875rem;margin-bottom:16px">
            <strong>${guest.first_name} ${guest.last_name}</strong>
          </p>
          <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
            ${this._flagCheckbox('flag-bad-exp',   'Mala experiencia / Conflictivo',  isBad)}
            ${this._flagCheckbox('flag-vip',        'VIP — Atención preferencial',     currentTags.includes('vip'))}
            ${this._flagCheckbox('flag-frecuente',  'Huésped frecuente',               currentTags.includes('frecuente'))}
            ${this._flagCheckbox('flag-empresa',    'Cliente empresa',                 currentTags.includes('empresa'))}
            ${this._flagCheckbox('flag-norec',      'No recomendar',                   currentTags.includes('no_recomendar'))}
          </div>
          <div class="form-group">
            <label>Observaciones internas</label>
            <textarea id="flag-notes" rows="3" placeholder="Detalles de la situación..."
              style="width:100%;resize:vertical">${guest.bad_experience_note ?? ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="flag-cancel">Cancelar</button>
          <button class="btn btn-primary" id="flag-save">Guardar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('#flag-close').onclick  = close;
    modal.querySelector('#flag-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#flag-save').addEventListener('click', async () => {
      const newTags = [];
      if (modal.querySelector('#flag-vip')?.checked)       newTags.push('vip');
      if (modal.querySelector('#flag-frecuente')?.checked) newTags.push('frecuente');
      if (modal.querySelector('#flag-empresa')?.checked)   newTags.push('empresa');
      if (modal.querySelector('#flag-norec')?.checked)     newTags.push('no_recomendar');

      const badExp  = modal.querySelector('#flag-bad-exp')?.checked ?? false;
      const notes   = modal.querySelector('#flag-notes').value.trim();

      try {
        const { error: updateErr } = await this.db.from('guests').update({
          bad_experience:      badExp,
          bad_experience_note: notes || null,
          tags:                newTags,
          updated_at:          new Date().toISOString(),
        }).eq('id', guest.id);

        if (updateErr) throw new Error(updateErr.message);

        await logAction('UPDATE', 'guest', guest.id, `Etiquetas actualizadas: ${newTags.join(', ')}`);
        showToast('Huésped actualizado ✓', 'success');
        close();
        await this.load();
      } catch (err) {
        console.error('[FlagModal] Error al guardar etiquetas:', err);
        showToast('Error al guardar: ' + err.message, 'error');
      }
    });
  }

  _flagCheckbox(id, label, checked) {
    return `
      <label style="display:flex;align-items:center;gap:10px;font-size:.875rem;cursor:pointer">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}
               style="width:16px;height:16px;accent-color:var(--color-primary)">
        ${label}
      </label>`;
  }

  // ── Checkout rápido ───────────────────────────────
  async _doCheckout(id) {
    if (!confirm('¿Confirmar check-out de esta reserva?')) return;
    try {
      await this.db.from('bookings').update({ status: 'paid' }).eq('id', id);
      // Crear tarea de limpieza automáticamente
      const booking = this._allBookings.find(b => b.id === id);
      if (booking) {
        const { OperationsModule } = await import('./operations.js');
        await OperationsModule.createCheckoutCleaningTask(this.db, this.ctx, booking);
      }
      showToast('Check-out realizado ✓', 'success');
      this.load();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  // ── Duplicar reserva ──────────────────────────────
  async _duplicateBooking(id) {
    const b = this._allBookings.find(x => x.id === id);
    if (!b) return;
    this.bookingForm.open({ unitId: b.booking_units?.[0]?.unit_id });
    showToast('Reserva base cargada — modificá las fechas', 'info');
  }

  // ── Detalle ───────────────────────────────────────
  async _openDetail(id) {
    // booking_units y payments en consultas separadas — combinarlas en un
    // solo .select() puede duplicar pagos cuando hay varias unidades (bug
    // de producto cruzado en PostgREST).
    const [{ data: booking }, { data: paymentsData }] = await Promise.all([
      this.db.from('bookings').select('*, guests(*), booking_units(unit_id, units(name))').eq('id', id).single(),
      this.db.from('payments').select('*').eq('booking_id', id),
    ]);
    if (booking) {
      booking.payments = paymentsData ?? [];
      this.bookingForm.openDetail(booking);
    }
  }

  // ── Reprogramación ──────────────────────────────────
  // Cancela la reserva actual con nota de crédito. Si ya se sabe la fecha
  // nueva, abre la reserva nueva de una con todo precargado. Si no —caso
  // frecuente: el huésped todavía no decidió cuándo vuelve— la nota de
  // crédito queda "abierta" (tag 🔄NC: en las notas) y se ofrece sola la
  // próxima vez que se busque a ese huésped para cualquier reserva nueva.
  async _reprogramBooking(id) {
    if (this._reprogramInProgress?.has(id)) return; // ya está corriendo para esta reserva, ignorar el segundo click
    (this._reprogramInProgress ??= new Set()).add(id);
    try {
      await this._reprogramBookingInner(id);
    } finally {
      this._reprogramInProgress.delete(id); // pase lo que pase, liberar
    }
  }

  async _reprogramBookingInner(id) {
    const b = this._allBookings?.find(x => x.id === id);
    if (!b) return;
    const guest  = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'este huésped';
    const dates  = `${b.check_in} → ${b.check_out}`;

    // Pedimos el total_paid FRESCO acá, en vez de confiar en el que ya
    // tenía la lista en memoria (this._allBookings) — esa lista solo se
    // refresca sola si la pestaña de Reservas estaba activa en pantalla
    // en el momento justo en que se guardó un pago. Si editaste/cargaste
    // el pago desde el Calendario u otra pantalla, quedaba vieja, y acá
    // se terminaba calculando la nota de crédito con un monto pagado
    // desactualizado (a veces $0 aunque en la base sí hubiera plata
    // cargada) — el motivo exacto de "me quedó sin saldo en la NC".
    let freshPaid = b.total_paid ?? 0;
    try {
      const { data: freshRow } = await this.db.from('bookings').select('total_paid').eq('id', id).single();
      if (freshRow) freshPaid = freshRow.total_paid ?? 0;
    } catch (err) {
      console.warn('[Reprogramar] no se pudo refrescar total_paid, uso el valor en memoria:', err?.message ?? err);
    }
    const paid   = Math.round(freshPaid);

    // Política de cancelación configurada (Configuración → Política de
    // cancelación): si falta menos de X días para el check-in, la política
    // SUGIERE retener un % — pero es una sugerencia, no una obligación.
    // Antes se aplicaba sola sin preguntar; ahora, si corresponde retención,
    // se pregunta si aplicarla o dar el 100% de crédito igual (por ejemplo,
    // si el huésped no tuvo culpa, o simplemente preferís no cobrarle nada).
    const freeDays   = parseFloat(AppContext.config?.cancel_free_days   ?? 3)  || 0;
    const penaltyPct = parseFloat(AppContext.config?.cancel_penalty_pct ?? 30) || 0;
    const daysToGo   = Math.round((new Date(b.check_in + 'T00:00:00') - new Date()) / 86400000);
    const wouldPenalize = paid > 0 && daysToGo < freeDays;
    let inPenaltyWindow = false;
    if (wouldPenalize) {
      const suggestedRetained = Math.round(paid * (penaltyPct / 100));
      inPenaltyWindow = confirm(
        `Faltan ${daysToGo} día${daysToGo === 1 ? '' : 's'} para el check-in — según la política de cancelación configurada, correspondería retener ${penaltyPct}% (${formatARS(suggestedRetained)}).\n\n` +
        `Aceptar → aplicar la retención (crédito de ${formatARS(paid - suggestedRetained)}).\n` +
        `Cancelar → dar el 100% de crédito igual, sin retener nada (${formatARS(paid)}).`
      );
    }
    const credit = inPenaltyWindow ? Math.round(paid * (1 - penaltyPct / 100)) : paid;
    const retained = paid - credit;

    const msg = paid <= 0
      ? `¿Reprogramar la reserva de ${guest} (${dates})?\n\nSe cancela esta reserva. No tenía pagos, así que no hay nota de crédito que generar.`
      : inPenaltyWindow
        ? `¿Reprogramar la reserva de ${guest} (${dates})?\n\nFaltan ${daysToGo} día${daysToGo === 1 ? '' : 's'} para el check-in — según la política de cancelación configurada (menos de ${freeDays} días), se retiene ${penaltyPct}%.\n\nNota de crédito: ${formatARS(credit)} (de ${formatARS(paid)} pagados, se retienen ${formatARS(retained)}).`
        : `¿Reprogramar la reserva de ${guest} (${dates})?\n\nSe cancela esta reserva y queda una Nota de Crédito por ${formatARS(credit)} (lo que ya tenía pagado — está dentro del plazo sin cargo).`;
    if (!confirm(msg)) return;

    // Si hay plata de por medio, preguntamos si ya hay fecha nueva o si la
    // NC queda pendiente para cuando el huésped decida. Sin plata no hace
    // falta preguntar — no hay nada que trasladar, se cancela y listo.
    const openNow = credit > 0
      ? confirm(`¿Ya tenés la fecha nueva para reprogramar ahora?\n\nAceptar → abre la reserva nueva ya mismo con la Nota de Crédito cargada.\nCancelar → la Nota de Crédito queda abierta y se va a ofrecer sola la próxima vez que busques a ${guest} para una reserva nueva.`)
      : false;

    const today = new Date().toLocaleDateString('es-AR');
    const todayISO = new Date().toISOString().slice(0, 10);
    // Tag machine-readable 🔄NC:<monto>:<fecha ISO> — permite detectar
    // después notas de crédito abiertas y calcular su antigüedad sin tener
    // que parsear texto en español.
    const cancelNote = credit > 0
      ? `🔄NC:${credit}:${todayISO} — Reprogramada, nota de crédito por ${formatARS(credit)} (${today})`
      : `🔄 Reprogramada (${today})`;

    try {
      const { data: updated, error } = await this.db.from('bookings')
        .update({ status: 'cancelled', notes: appendNote(b.notes, cancelNote) })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!updated?.length) {
        throw new Error('La reserva no se modificó — probablemente un permiso de la base de datos lo está bloqueando en silencio.');
      }

      await logAction('CANCEL', 'booking', id, `Reprogramada: ${guest} (${dates})${credit > 0 ? ` — NC ${formatARS(credit)}` : ''}`);
      Bus.emit(EVENTS.BOOKING_CANCELLED, {
        hotelId: this.ctx.hotelId,
        checkIn: b.check_in,
        checkOut: b.check_out,
        unitIds: (b.booking_units ?? []).map(bu => bu.unit_id),
      });
      await this.load();

      if (!openNow) {
        showToast(credit > 0
          ? `Reserva cancelada — NC de ${formatARS(credit)} queda abierta para ${guest}`
          : 'Reserva cancelada', 'info');
        return;
      }

      const shortId = id.slice(0, 8);
      showToast('Reserva cancelada — completá las fechas nuevas', 'info');
      this.bookingForm.open({
        prefillGuestId: b.guests?.id,
        // No paso prefillGuest: la lista no trae 'email' — que lo vuelva a
        // buscar completo por ID en _prefillGuestAsync().
        notes:          `🔄 Nota de crédito por reprogramación de reserva anterior (#${shortId}) — cancelada y reprogramada`,
        creditNote:     { amount: credit, sourceBookingId: id },
      });
    } catch (err) {
      console.error('[BookingList] reprogram error:', err);
      showToast('Error al reprogramar: ' + (err?.message ?? err), 'error');
    }
  }

  // ── Anular una nota de crédito vieja sin usar ──────
  async _voidCreditNote(id) {
    const b = this._allBookings?.find(x => x.id === id);
    if (!b) return;
    const m = b.notes?.match(/🔄NC:(\d+):(\d{4}-\d{2}-\d{2})/);
    const amount = m ? parseInt(m[1], 10) : 0;
    const guest = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'este huésped';

    if (!confirm(`¿Anular la Nota de Crédito de ${formatARS(amount)} de ${guest}?\n\nQueda registrada como anulada — no se va a poder aplicar a ninguna reserva nueva. Esta acción no se puede deshacer.`)) return;

    try {
      const { error } = await this.db.from('bookings')
        .update({ notes: appendNote(b.notes, '❌NCVOID') })
        .eq('id', id);
      if (error) throw error;
      await logAction('UPDATE', 'booking', id, `Nota de crédito anulada manualmente: ${guest} — ${formatARS(amount)}`);
      showToast('Nota de crédito anulada', 'info');
      await this.load();
    } catch (err) {
      showToast('Error al anular: ' + (err?.message ?? err), 'error');
    }
  }

  // ── Eliminar ──────────────────────────────────────
  async _deleteBooking(id) {
    if (!can('deleteBooking')) {
      showToast('🔒 Sin permiso para eliminar reservas', 'warning');
      return;
    }
    const booking = this._allBookings?.find(b => b.id === id);
    const guest   = booking?.guests ? `${booking.guests.first_name} ${booking.guests.last_name}` : 'esta reserva';
    const dates   = booking ? ` (${booking.check_in} → ${booking.check_out})` : '';

    if (!confirm(`¿Eliminar la reserva de ${guest}${dates}?\n\nEsta acción no se puede deshacer.`)) return;

    const row = document.querySelector(`.booking-row[data-booking-id="${id}"]`);
    if (row) {
      row.style.opacity      = '.35';
      row.style.pointerEvents = 'none';
      row.style.transition   = 'opacity .25s';
    }

    try {
      const { error } = await this.db.from('bookings').delete().eq('id', id);
      if (error) throw error;
      showToast('Reserva eliminada ✓', 'success');
      await logAction('DELETE', 'booking', id, `Eliminada desde lista: ${guest}${dates}`);
      if (booking) {
        const unitNames = (booking.booking_units ?? [])
          .map(bu => bu.units?.name).filter(Boolean).join(', ') || '—';
        Bus.emit(EVENTS.BOOKING_DELETED, {
          bookingId: id, guestName: guest, unitNames,
          checkIn: booking.check_in, checkOut: booking.check_out,
        });
        Bus.emit(EVENTS.BOOKING_CANCELLED, {
          hotelId: this.ctx.hotelId,
          checkIn: booking.check_in,
          checkOut: booking.check_out,
          unitIds: (booking.booking_units ?? []).map(bu => bu.unit_id),
        });
      }
      await this.load();
    } catch (err) {
      console.error('[BookingList] delete error:', err);
      if (row) { row.style.opacity = ''; row.style.pointerEvents = ''; }
      showToast('Error al eliminar: ' + (err.message ?? err), 'error');
    }
  }

  // ── WhatsApp ──────────────────────────────────────
  async _sendWhatsApp(id) {
    const booking = this._allBookings.find(b => b.id === id);
    if (!booking?.guests?.phone) { showToast('Sin número de teléfono', 'warning'); return; }
    const { generateVoucherText } = await import('../services/whatsapp-service.js');
    const text = generateVoucherText(booking);
    const phone = booking.guests.phone.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  }

  // ── Exportar Excel ────────────────────────────────
  async _exportExcel(bookings) {
    const { exportBookingsExcel } = await import('../services/export-service.js');
    exportBookingsExcel(bookings);
  }

  // ── Exportar PDF ──────────────────────────────────
  _exportPDF(bookings) {
    const month = new Date().toLocaleString('es-AR', { month: 'long', year: 'numeric' });
    const rows  = bookings.map(b => {
      const g = b.guests;
      const guest = g ? `${g.first_name} ${g.last_name}` : '—';
      const unit  = (b.booking_units ?? []).map(bu => bu.units?.name ?? '').join(', ');
      return `<tr>
        <td>${guest}</td>
        <td>${unit}</td>
        <td>${b.check_in}</td>
        <td>${b.check_out}</td>
        <td>${b.nights}</td>
        <td>${formatARS(b.total_amount)}</td>
        <td>${STATUS_LABELS[b.status] ?? b.status}</td>
      </tr>`;
    }).join('');

    const w = window.open('', '_blank');
    w.document.write(`
      <!DOCTYPE html><html><head><title>Reservas MILA</title>
      <style>body{font-family:sans-serif;padding:24px}
        h1{font-size:16px;margin-bottom:4px}
        p{font-size:12px;color:#666;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{background:#f1f5f9;text-align:left;padding:6px 10px;font-weight:600}
        td{padding:5px 10px;border-bottom:1px solid #e2e8f0}
        @media print{.no-print{display:none}}
      </style></head>
      <body>
        <h1>MILA · Listado de Reservas</h1>
        <p>${month} · ${bookings.length} reservas</p>
        <button class="no-print" onclick="window.print()" style="margin-bottom:16px;padding:6px 14px">Imprimir / PDF</button>
        <table>
          <thead><tr>
            <th>Huésped</th><th>Unidad</th><th>Check-in</th><th>Check-out</th>
            <th>Noches</th><th>Total</th><th>Estado</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  // ── Badge de nav ──────────────────────────────────
  _updateNavBadge(bookings) {
    const today   = localToday();
    const pending = (bookings ?? []).filter(b => b.check_out >= today && b.status === 'pending').length;
    const badge   = document.getElementById('nav-badge-bookings');
    if (badge) {
      badge.style.display  = pending > 0 ? 'inline' : 'none';
      badge.textContent    = pending;
    }
  }

  // ── Tooltip enriquecido al pasar el mouse sobre el nombre del huésped ──
  // Mismo diseño/contenido que el tooltip de las barras del calendario (.cal-tooltip).
  // Usa delegación de eventos sobre el contenedor, ya que las filas se
  // reconstruyen en cada _render().
  _bindGuestNameTooltip() {
    const list = document.getElementById('bookings-list');
    if (!list || list._guestTooltipBound) return;
    list._guestTooltipBound = true;

    list.addEventListener('mouseover', (e) => {
      const nameEl = e.target.closest('.bl-guest-name-hover');
      if (!nameEl || nameEl._tooltipActive) return;
      const booking = this._allBookings?.find(b => b.id === nameEl.dataset.bookingId);
      if (!booking) return;
      nameEl._tooltipActive = true;
      this._showGuestTooltip(booking, e);
    });

    list.addEventListener('mousemove', (e) => {
      if (!this._guestTooltip) return;
      if (!e.target.closest('.bl-guest-name-hover')) return;
      this._moveGuestTooltip(e);
    });

    list.addEventListener('mouseout', (e) => {
      const nameEl = e.target.closest('.bl-guest-name-hover');
      if (!nameEl) return;
      // Solo ocultar si realmente salimos del elemento (no de un hijo, como el flag)
      if (nameEl.contains(e.relatedTarget)) return;
      nameEl._tooltipActive = false;
      this._hideGuestTooltip();
    });
  }

  _showGuestTooltip(booking, e) {
    this._hideGuestTooltip();
    const guest     = booking.guests ? `${booking.guests.first_name ?? ''} ${booking.guests.last_name ?? ''}`.trim() : (booking.is_blocked ? 'Bloqueo' : 'Sin huésped');
    const { color: barColor, label: barLabel } = getBookingBarColor(booking);
    const source    = booking.source ?? 'direct';
    const srcCfg    = SOURCE_CONFIG[source] ?? {};
    const units     = (booking.booking_units ?? []).map(bu => {
      const u = bu.units ?? {};
      return `#${u.sort_order ?? '?'} · ${u.name ?? '?'}`;
    }).join(', ');
    const hasBadExp = booking.guests?.bad_experience;
    const nights    = booking.nights ?? Math.round((new Date(booking.check_out) - new Date(booking.check_in)) / 86400000);

    const tip = document.createElement('div');
    tip.className = 'cal-tooltip';

    const totalAmount = booking.total_amount ?? 0;
    const totalPaid   = booking.total_paid   ?? 0;
    const balance     = booking.balance      ?? (totalAmount - totalPaid);
    const saldado     = balance <= 0;
    const bUnits      = booking.booking_units ?? [];

    // Desglose por departamento cuando hay 2+ unidades con precio individual cargado.
    // Usa los pagos REALES etiquetados por unidad (payments.unit_id) cuando
    // existen; solo la porción "General" se reparte proporcionalmente.
    const bPayments = booking.payments ?? [];
    const hasPerUnitPrices = bUnits.length >= 2 && bUnits.every(bu => bu.price_per_night != null && bu.price_per_night > 0);
    let perUnitRows = '';
    if (hasPerUnitPrices) {
      const unitTotals = bUnits.map(bu => ({
        uid:   bu.unit_id,
        name:  bu.units?.name ?? '—',
        color: bu.units?.color ?? '#94A3B8',
        total: (bu.price_per_night ?? 0) * nights,
      }));
      const sumTotals   = unitTotals.reduce((s,u) => s + u.total, 0) || 1;
      const generalPaid = bPayments.filter(p => !p.unit_id).reduce((s,p) => s + (p.amount ?? 0), 0);
      perUnitRows = `
        <div style="border-top:1px solid rgba(255,255,255,.1);padding-top:9px;margin-top:9px">
          <div style="font-size:.62rem;color:#64748B;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Por departamento</div>
          ${unitTotals.map(u => {
            const directPaid   = bPayments.filter(p => p.unit_id === u.uid).reduce((s,p) => s + (p.amount ?? 0), 0);
            const generalShare = generalPaid * (u.total / sumTotals);
            const estPaid = directPaid + generalShare;
            const estBal  = Math.max(0, u.total - estPaid);
            return `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
              <span style="width:7px;height:7px;border-radius:50%;background:${u.color};flex-shrink:0"></span>
              <span style="font-size:.72rem;color:#CBD5E1;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name}</span>
              <span style="font-size:.74rem;font-weight:700;color:#F8FAFC">${formatARS(u.total)}</span>
              ${totalPaid > 0 ? `<span style="font-size:.66rem;color:${estBal<=0?'#34D399':'#EAB308'}">${estBal<=0?'✓':formatARS(estBal)}</span>` : ''}
            </div>`;
          }).join('')}
          ${generalPaid > 0 ? `<div style="font-size:.6rem;color:#64748B;font-style:italic;margin-top:2px">Incluye pagos generales repartidos proporcionalmente</div>` : ''}
        </div>`;
    }

    const payRow = totalAmount > 0 ? `
      <div style="border-top:1px solid rgba(255,255,255,.1);padding-top:9px;margin-top:9px">
        <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:5px">
          <div>
            <div style="font-size:.65rem;color:#64748B;text-transform:uppercase;letter-spacing:.04em">Total</div>
            <div style="font-weight:700;color:#F8FAFC;font-size:.88rem">${formatARS(totalAmount)}</div>
          </div>
          ${totalPaid > 0 ? `<div>
            <div style="font-size:.65rem;color:#64748B;text-transform:uppercase;letter-spacing:.04em">Señas / depósitos</div>
            <div style="font-weight:600;color:#A78BFA;font-size:.85rem">${formatARS(totalPaid)}</div>
          </div>` : ''}
          <div style="text-align:right">
            <div style="font-size:.65rem;color:#64748B;text-transform:uppercase;letter-spacing:.04em">Saldo al ingreso</div>
            <div style="font-weight:700;font-size:.88rem;color:${saldado ? '#34D399' : '#EAB308'}">${saldado ? '✓ Saldado' : formatARS(balance)}</div>
          </div>
        </div>
        ${perUnitRows}
      </div>` : '';

    const emitidaStr = booking.created_at
      ? new Date(booking.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '';
    tip.innerHTML = `
      <div class="ct-guest">${guest}${hasBadExp ? ' <span style="color:#EF4444">⚠️</span>' : ''}</div>
      ${emitidaStr ? `<div style="font-size:.62rem;color:#64748B;margin-top:1px">Emitida ${emitidaStr}</div>` : ''}
      <div class="ct-unit">🛏️ ${units || '—'}</div>
      <div class="ct-dates" style="margin-top:6px">📅 ${booking.check_in} → ${booking.check_out}</div>
      <div class="ct-nights">🌙 ${nights} noches${booking.pax ? ` · 👥 ${booking.adults ?? booking.pax} adultos${booking.children ? ` + ${booking.children} menores` : ''}` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <span style="padding:2px 8px;border-radius:99px;font-size:.7rem;font-weight:700;
          background:${barColor}22;color:${barColor};
          border:1px solid ${barColor}40">${barLabel}</span>
        ${source !== 'direct' && source !== 'blocked' ? `<span style="padding:2px 8px;border-radius:99px;font-size:.7rem;font-weight:700;
          background:${srcCfg.color??''}22;color:${srcCfg.color??'#64748B'};border:1px solid ${srcCfg.color??''}40">
          ${srcCfg.emoji??''} ${srcCfg.label??''}</span>` : ''}
      </div>
      ${payRow}
      ${booking.notes ? `<div style="margin-top:8px;font-size:.7rem;color:#94A3B8;font-style:italic;border-top:1px solid rgba(255,255,255,.07);padding-top:7px">📝 ${booking.notes.length > 80 ? booking.notes.slice(0,80)+'…' : booking.notes}</div>` : ''}
    `;
    document.body.appendChild(tip);
    this._guestTooltip = tip;
    this._moveGuestTooltip(e);
  }

  _moveGuestTooltip(e) {
    if (!this._guestTooltip) return;
    const tw = this._guestTooltip.offsetWidth  || 220;
    const th = this._guestTooltip.offsetHeight || 140;
    const x  = e.clientX + 18;
    const y  = e.clientY - 10;
    this._guestTooltip.style.left = `${x+tw>window.innerWidth ? x-tw-36 : x}px`;
    this._guestTooltip.style.top  = `${y+th>window.innerHeight ? y-th : y}px`;
  }

  _hideGuestTooltip() {
    this._guestTooltip?.remove();
    this._guestTooltip = null;
  }
}
