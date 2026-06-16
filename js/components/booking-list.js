import { can, isDemo } from "../auth/permissions.js";
// ═══════════════════════════════════════════════════
// booking-list.js — Listado y Archivo de Reservas
// ═══════════════════════════════════════════════════

import { formatARS, formatDate, showToast, getUnitChipHTML, getSourceBadgeHTML, getBookingBarColor, getUnitLabel, getUnitColor } from '../supabase-config.js';

const STATUS_LABELS = {
  pending:   'Sin seña',
  partial:   'Señada',
  paid:      'Abonada',
  cancelled: 'Cancelada',
  blocked:   'Bloqueada',
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
    this._pageSize = 25;
    this._allBookings = [];

    this._bindTabs();
    this._bindFilters();
    this._bindSourceFilters();
    this._populateUnitFilter();

    // Event Delegation para las acciones en la lista
    document.getElementById('bookings-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      const row = e.target.closest('.booking-row');
      if (!btn || !row) return;

      const id = row.dataset.bookingId;
      const action = btn.dataset.action;

      if (action === 'view') this._openDetail(id);
      if (action === 'edit') this.bookingForm.openEdit(id);
      if (action === 'delete') this._deleteBooking(id);
      if (action === 'whatsapp') this._sendWhatsApp(id);
    });

    document.addEventListener('booking:changed', () => {
      if (document.getElementById('section-bookings')?.classList.contains('active')) {
        this.load();
      }
    });
  }

  async load() {
    try {
      if (window.AppContext?.IS_DEMO) {
        const { generateMockBookings } = await import('../services/mock-data.js');
        const now = new Date();
        this._allBookings = generateMockBookings(this.ctx.units, now.getFullYear(), now.getMonth());
        this._render(now.toISOString().split('T')[0]);
        return;
      }
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await this.db
        .from('bookings')
        .select(`
          id, check_in, check_out, nights, status, source, total_amount, total_paid, balance,
          price_per_night, notes, is_blocked, block_reason, created_at,
          guests!bookings_guest_id_fkey(id, first_name, last_name, dni, phone, bad_experience, bad_experience_note),
          booking_units(unit_id, units(name, sort_order, color))
        `)
        .eq('hotel_id', this.ctx.hotelId)
        .order('check_in', { ascending: false });

      if (error) throw error;
      this._allBookings = data ?? [];
      this._render(today);
      this._updateNavBadge(data);
    } catch (err) {
      console.error('BookingList load error:', err);
      showToast('Error al cargar reservas', 'error');
    }
  }

  _bindTabs() {
    document.querySelectorAll('#section-bookings .tabs-bar .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#section-bookings .tabs-bar .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._tab = tab.dataset.tab;
        this._render(new Date().toISOString().split('T')[0]);
      });
    });
  }

  _bindSourceFilters() {
    document.querySelectorAll('.source-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.source-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._source = btn.dataset.source;
        this._render(new Date().toISOString().split('T')[0]);
      });
    });
    document.querySelector('.source-filter-btn[data-source=""]')?.classList.add('active');
  }

  _bindFilters() {
    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    document.getElementById('booking-search')?.addEventListener('input', debounce((e) => {
      this._search = e.target.value.trim().toLowerCase();
      this._page   = 1;
      this._render(new Date().toISOString().split('T')[0]);
    }, 250));

    ['filter-status', 'filter-unit', 'filter-date-from', 'filter-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', (e) => {
            this[`_${id.replace('filter-', '').replace('-', '_')}`] = e.target.value;
            this._render(new Date().toISOString().split('T')[0]);
        });
    });
  }

  _populateUnitFilter() {
    const sel = document.getElementById('filter-unit');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todas las unidades</option>';
    this.ctx.units.forEach(u => {
      sel.innerHTML += `<option value="${u.id}">#${u.sort_order ?? '?'} · ${u.name}</option>`;
    });
  }

  _render(today) {
    const container = document.getElementById('bookings-list');
    if (!container) return;

    let filtered = this._applyFilters(this._allBookings, today);

    if (!filtered.length) {
      container.innerHTML = `<div class="empty-state"><p>${this._tab === 'active' ? 'No hay reservas activas.' : 'No hay historial.'}</p></div>`;
      return;
    }

    container.innerHTML = '';
    if (can('exportData')) {
      container.innerHTML += `<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn btn-outline btn-sm" id="btn-export-csv">📥 Exportar (${filtered.length})</button></div>`;
      document.getElementById('btn-export-csv')?.addEventListener('click', async () => {
        const { exportBookingsCSV } = await import('../services/export-service.js');
        exportBookingsCSV(filtered);
      });
    }

    const listEl = document.createElement('div');
    listEl.className = 'bookings-list';
    listEl.innerHTML = filtered.slice(0, this._page * this._pageSize).map(b => this._renderRow(b, today)).join('');
    container.appendChild(listEl);
  }

  _renderRow(b, today) {
    const guest = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : (b.is_blocked ? 'Bloqueo' : 'Sin huésped');
    const { color: barColor, label: barLabel } = getBookingBarColor(b);
    
    return `
      <div class="booking-row" data-booking-id="${b.id}">
        <div style="width:4px;background:${barColor};"></div>
        <div class="booking-info">
          <span>${guest}</span>
          <div class="booking-meta">📅 ${formatDate(b.check_in)} → ${formatDate(b.check_out)}</div>
        </div>
        <div class="booking-actions">
          <button data-action="view" class="btn btn-ghost" title="Ver">👁️</button>
          <button data-action="whatsapp" class="btn btn-ghost" title="WhatsApp">💬</button>
          <button data-action="edit" class="btn btn-ghost" title="Editar">✏️</button>
          ${can("deleteBooking") ? `<button data-action="delete" class="btn btn-ghost" title="Eliminar" style="color:var(--color-danger)">🗑️</button>` : ''}
        </div>
      </div>`;
  }

  _applyFilters(bookings, today) {
    return bookings.filter(b => {
      const isArchive = b.check_out < today;
      if (this._tab === 'active' && isArchive) return false;
      if (this._tab === 'archive' && !isArchive) return false;
      // Agrega aquí tus otras lógicas de filtrado...
      return true;
    });
  }

  async _openDetail(id) {
    const { data: booking } = await this.db.from('bookings').select('*, guests(*), booking_units(unit_id, units(name))').eq('id', id).single();
    if (booking) this.bookingForm.openDetail(booking);
  }

  async _deleteBooking(id) {
    if (!confirm('¿Eliminar?')) return;
    await this.db.from('bookings').delete().eq('id', id);
    this.load();
  }

  async _sendWhatsApp(id) {
     // ... tu lógica original ...
  }

  _updateNavBadge(bookings) {
    const today = new Date().toISOString().split('T')[0];
    const pending = (bookings ?? []).filter(b => b.check_out >= today && b.status === 'pending').length;
    const badge = document.getElementById('nav-badge-bookings');
    if (badge) badge.style.display = pending > 0 ? 'inline' : 'none';
  }
}