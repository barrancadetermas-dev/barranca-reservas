// ═══════════════════════════════════════════════════
// waitlist.js — Lista de espera
// Cuando alguien pide fechas ocupadas, queda guardado
// acá. Si después se libera algo que coincide (por una
// cancelación o reprogramación), waitlist-service.js
// crea un Recordatorio automático para avisarle.
// ═══════════════════════════════════════════════════

import { formatDate, showToast } from '../supabase-config.js';
import { can, isDemo } from '../auth/permissions.js';

const STATUS_LABELS = {
  open:      { label: '🟡 Esperando',   color: 'var(--state-yellow-txt)', bg: 'var(--state-yellow-bg)' },
  notified:  { label: '🔔 Avisado',     color: 'var(--color-primary)',    bg: 'var(--color-primary-l)' },
  converted: { label: '✅ Convertida',  color: 'var(--state-green-txt)',  bg: 'var(--state-green-bg)' },
  expired:   { label: '⌛ Vencida',     color: 'var(--color-text-3)',     bg: 'var(--color-surface-2)' },
  cancelled: { label: '❌ Cancelada',   color: 'var(--state-red-txt)',    bg: 'var(--state-red-bg)' },
};

export class WaitlistPanel {
  constructor(supabase, ctx) {
    this.db  = supabase;
    this.ctx = ctx;
    window._waitlistPanel = this;
  }

  async load() {
    const container = document.getElementById('waitlist-container');
    if (!container) return;

    container.innerHTML = `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <h3>📋 Lista de espera</h3>
          <span style="font-size:.78rem;color:var(--color-text-3)">Fechas pedidas que hoy no había — se avisan solas si se liberan</span>
        </div>
        <button class="btn btn-primary btn-sm" id="wl-add-btn">+ Nueva entrada</button>
      </div>
      <div class="bl-sort-wrap" id="wl-filter-tabs" style="margin-bottom:12px">
        <span class="bl-sort-label">Filtrar:</span>
        ${[
          ['all', '📋 Todas'], ['open', '🟡 Esperando'], ['notified', '🔔 Avisadas'],
          ['converted', '✅ Convertidas'], ['expired', '⌛ Vencidas'], ['cancelled', '❌ Canceladas'],
        ].map(([val, label]) => `<button type="button" class="wl-filter-btn${(this._filter ?? 'all') === val ? ' active' : ''}" data-filter="${val}">${label}</button>`).join('')}
      </div>
      <div id="wl-form-container"></div>
      <div id="wl-list"><div style="padding:16px;text-align:center;color:var(--color-text-3)">⟳ Cargando...</div></div>
    `;

    document.getElementById('wl-add-btn')?.addEventListener('click', () => this._openForm());
    document.getElementById('wl-filter-tabs')?.querySelectorAll('.wl-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._filter = btn.dataset.filter;
        document.querySelectorAll('.wl-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._renderList();
      });
    });
    await this._renderList();
    this._updateBadge();
  }

  async _renderList() {
    const listEl = document.getElementById('wl-list');
    if (!listEl) return;
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await this.db.from('waitlist')
      .select('*')
      .eq('hotel_id', this.ctx.hotelId)
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<div class="error-state" style="padding:24px;text-align:center">Error: ${error.message}</div>`;
      return;
    }

    // Vencidas visualmente (sin tocar la base) — check-in ya pasado y sigue "open"
    let rows = (data ?? []).map(w => ({
      ...w,
      _effectiveStatus: (w.status === 'open' && w.check_in < today) ? 'expired' : w.status,
    }));

    const filter = this._filter ?? 'all';
    if (filter !== 'all') rows = rows.filter(w => w._effectiveStatus === filter);

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📋</span><p>${filter === 'all' ? 'Sin entradas en la lista de espera.' : 'Sin entradas con ese filtro.'}</p></div>`;
      return;
    }

    listEl.innerHTML = rows.map(w => {
      const st = STATUS_LABELS[w._effectiveStatus] ?? STATUS_LABELS.open;
      const unitNames = (w.unit_ids?.length
        ? w.unit_ids.map(id => this.ctx.units?.find(u => String(u.id) === String(id))?.name).filter(Boolean).join(', ')
        : 'Cualquier unidad');
      return `
        <div class="card" style="margin-bottom:10px;padding:14px 16px" data-wl-id="${w.id}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-weight:700;color:var(--color-text)">${w.guest_name}</span>
                <span style="font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:999px;background:${st.bg};color:${st.color}">${st.label}</span>
              </div>
              <div style="font-size:.8rem;color:var(--color-text-2)">
                📅 ${formatDate(w.check_in)} → ${formatDate(w.check_out)} · 🏠 ${unitNames}${w.pax ? ` · 👥 ${w.pax}` : ''}
              </div>
              ${w.phone ? `<div style="font-size:.78rem;color:var(--color-text-3);margin-top:2px">📱 ${w.phone}</div>` : ''}
              ${w.notes ? `<div style="font-size:.76rem;color:var(--color-text-3);margin-top:4px;font-style:italic">${w.notes}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${w.phone && w._effectiveStatus !== 'converted' && w._effectiveStatus !== 'cancelled' ? `
                <button class="btn btn-outline btn-sm wl-whatsapp-btn" data-id="${w.id}" title="Avisar por WhatsApp">💬 Avisar</button>` : ''}
              ${w._effectiveStatus === 'open' || w._effectiveStatus === 'notified' ? `
                <button class="btn btn-outline btn-sm wl-convert-btn" data-id="${w.id}" title="Se convirtió en reserva">✅ Convertida</button>` : ''}
              <button class="btn btn-ghost btn-sm wl-delete-btn" data-id="${w.id}" title="Eliminar" aria-label="Eliminar de la lista de espera">🗑️</button>
            </div>
          </div>
        </div>`;
    }).join('');

    this._bindListActions(listEl);
  }

  _bindListActions(listEl) {
    listEl.querySelectorAll('.wl-whatsapp-btn').forEach(btn => {
      btn.addEventListener('click', () => this._sendWhatsApp(btn.dataset.id));
    });
    listEl.querySelectorAll('.wl-convert-btn').forEach(btn => {
      btn.addEventListener('click', () => this._updateStatus(btn.dataset.id, 'converted'));
    });
    listEl.querySelectorAll('.wl-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this._deleteEntry(btn.dataset.id));
    });
  }

  async _sendWhatsApp(id) {
    const { data: w } = await this.db.from('waitlist').select('*').eq('id', id).single();
    if (!w) return;
    const fmtD = (s) => { const [y,m,d] = s.split('-'); return `${d}/${m}`; };
    const text = `¡Hola ${w.guest_name}! Te escribo de Barranca de Termas — se liberaron fechas para el ${fmtD(w.check_in)} al ${fmtD(w.check_out)} que habías consultado. ¿Seguís interesado/a?`;
    const phone = (w.phone ?? '').replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  async _updateStatus(id, status) {
    const { error } = await this.db.from('waitlist').update({ status }).eq('id', id);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast(status === 'converted' ? '✓ Marcada como convertida en reserva' : 'Actualizado', 'success');
    await this._renderList();
    this._updateBadge();
  }

  async _deleteEntry(id) {
    if (!confirm('¿Eliminar esta entrada de la lista de espera?')) return;
    const { error } = await this.db.from('waitlist').delete().eq('id', id);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('Eliminada', 'success');
    await this._renderList();
    this._updateBadge();
  }

  async _updateBadge() {
    const badge = document.getElementById('nav-badge-waitlist');
    if (!badge) return;
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await this.db.from('waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('hotel_id', this.ctx.hotelId)
      .eq('status', 'open')
      .gte('check_in', today);
    if (count > 0) { badge.textContent = count; badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  }

  // ── Formulario de alta (inline, no modal separado) ──
  _openForm(prefill = {}) {
    const container = document.getElementById('wl-form-container');
    if (!container) return;
    const unitOptions = (this.ctx.units ?? []).map(u =>
      `<label style="display:flex;align-items:center;gap:6px;font-size:.8rem;padding:4px 6px">
        <input type="checkbox" value="${u.id}" class="wl-unit-check"> #${u.sort_order ?? ''} · ${u.name}
      </label>`).join('');

    container.innerHTML = `
      <div class="card" style="margin-bottom:16px;border:1.5px solid var(--color-primary)">
        <div class="card-header"><h3>Nueva entrada — Lista de espera</h3></div>
        <div class="form-grid-2">
          <div class="form-group"><label>Nombre <span class="req">*</span></label><input type="text" id="wl-name" placeholder="Nombre del interesado"></div>
          <div class="form-group"><label>Teléfono</label><input type="text" id="wl-phone" placeholder="+549..."></div>
        </div>
        <div class="form-grid-2">
          <div class="form-group"><label>Check-in <span class="req">*</span></label><input type="date" id="wl-checkin"></div>
          <div class="form-group"><label>Check-out <span class="req">*</span></label><input type="date" id="wl-checkout"></div>
        </div>
        <div class="form-group"><label>Cantidad de personas</label><input type="number" id="wl-pax" min="1" style="max-width:100px"></div>
        <div class="form-group">
          <label>Departamento(s) <span class="label-hint">Sin marcar ninguno = cualquiera sirve</span></label>
          <div class="r-unit-checks">${unitOptions}</div>
        </div>
        <div class="form-group"><label>Nota</label><textarea id="wl-notes" rows="2" placeholder="Detalles adicionales..."></textarea></div>
        <div class="modal-footer" style="padding:0;margin-top:8px">
          <button class="btn btn-outline" id="wl-cancel-btn">Cancelar</button>
          <button class="btn btn-primary" id="wl-save-btn">Guardar</button>
        </div>
      </div>`;

    if (prefill.checkIn)  document.getElementById('wl-checkin').value  = prefill.checkIn;
    if (prefill.checkOut) document.getElementById('wl-checkout').value = prefill.checkOut;
    if (prefill.unitId) {
      const cb = container.querySelector(`.wl-unit-check[value="${prefill.unitId}"]`);
      if (cb) cb.checked = true;
    }

    document.getElementById('wl-cancel-btn')?.addEventListener('click', () => { container.innerHTML = ''; });
    document.getElementById('wl-save-btn')?.addEventListener('click', () => this._saveForm(container));
    document.getElementById('wl-name')?.focus();
  }

  async _saveForm(container) {
    if (isDemo()) { showToast('🎭 No disponible en modo demo', 'warning'); return; }
    if (!can('createBooking')) { showToast('🔒 Sin permiso', 'warning'); return; }

    const name  = document.getElementById('wl-name')?.value.trim();
    const ci    = document.getElementById('wl-checkin')?.value;
    const co    = document.getElementById('wl-checkout')?.value;
    if (!name || !ci || !co) { showToast('Nombre y fechas son obligatorios', 'warning'); return; }
    if (ci >= co) { showToast('El check-out debe ser posterior al check-in', 'warning'); return; }

    const unitIds = [...container.querySelectorAll('.wl-unit-check:checked')].map(cb => cb.value);

    const { error } = await this.db.from('waitlist').insert({
      hotel_id:   this.ctx.hotelId,
      guest_name: name,
      phone:      document.getElementById('wl-phone')?.value.trim() || null,
      check_in:   ci,
      check_out:  co,
      pax:        parseInt(document.getElementById('wl-pax')?.value) || null,
      unit_ids:   unitIds,
      notes:      document.getElementById('wl-notes')?.value.trim() || null,
      status:     'open',
    });

    if (error) { showToast('Error al guardar: ' + error.message, 'error'); return; }
    showToast('✓ Agregado a la lista de espera', 'success');
    container.innerHTML = '';
    await this._renderList();
    this._updateBadge();
  }
}
