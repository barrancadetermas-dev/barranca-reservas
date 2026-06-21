// ══════════════════════════════════════════════════
// operations.js — Módulo Operaciones
// • Limpieza (generada automáticamente al check-out)
// • Mantenimiento (incidencias con prioridades)
// • Stock e Insumos (alertas de stock bajo)
// ══════════════════════════════════════════════════

import { showToast, toISODate, formatDate } from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { logAction } from '../services/audit-service.js';

const PRIORITY_CONFIG = {
  low:    { label: 'Baja',    color: '#94a3b8', bg: '#f1f5f9' },
  medium: { label: 'Media',   color: '#f59e0b', bg: '#fffbeb' },
  high:   { label: 'Alta',    color: '#ef4444', bg: '#fef2f2' },
  urgent: { label: 'Urgente', color: '#dc2626', bg: '#fee2e2' },
};

const MAINTENANCE_CATEGORIES = [
  'Aire acondicionado','Termotanque','Televisor','WiFi / Internet',
  'Plomería','Electricidad','Mobiliario','Electrodoméstico','Estructural','Otro',
];

const STOCK_ITEMS = [
  { key: 'toilet_paper',     label: 'Papel higiénico',       unit: 'rollos' },
  { key: 'towels',           label: 'Toallas',                unit: 'unidades' },
  { key: 'sheets',           label: 'Sábanas',                unit: 'juegos' },
  { key: 'cleaning_products',label: 'Productos de limpieza',  unit: 'litros' },
  { key: 'amenities',        label: 'Amenities',              unit: 'kits' },
  { key: 'disposables',      label: 'Descartables',           unit: 'unidades' },
];

export class OperationsModule {
  constructor(supabase, ctx) {
    this.db  = supabase;
    this.ctx = ctx;
    this._tab = 'cleaning';
  }

  async load() {
    const container = document.getElementById('operations-container');
    if (!container) return;

    container.innerHTML = this._renderShell();
    this._bindTabs(container);
    await this._loadTab('cleaning', container);
  }

  _renderShell() {
    return `
      <div class="tabs-bar ops-tabs">
        <button class="tab active" data-ops-tab="cleaning">🧹 Limpieza</button>
        <button class="tab" data-ops-tab="maintenance">🔧 Mantenimiento</button>
        <button class="tab" data-ops-tab="stock">📦 Stock</button>
        <div class="ops-tab-actions" id="ops-header-actions"></div>
      </div>
      <div id="ops-panel"></div>
    `;
  }

  _bindTabs(container) {
    container.querySelectorAll('.tab[data-ops-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab[data-ops-tab]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._tab = tab.dataset.opsTab;
        this._loadTab(this._tab, container);
      });
    });
  }

  async _loadTab(tab, container) {
    const panel = container.querySelector('#ops-panel');
    const header = container.querySelector('#ops-header-actions');
    if (!panel) return;
    panel.innerHTML = '<div class="loading-state">Cargando...</div>';

    if (tab === 'cleaning')     await this._loadCleaning(panel, header);
    if (tab === 'maintenance')  await this._loadMaintenance(panel, header);
    if (tab === 'stock')        await this._loadStock(panel, header);
  }

  // ══════════════════════════════════════════════════
  // LIMPIEZA
  // ══════════════════════════════════════════════════
  async _loadCleaning(panel, header) {
    header.innerHTML = can('manageReminders')
      ? `<button class="btn btn-primary btn-sm" id="btn-add-cleaning">+ Nueva tarea</button>`
      : '';
    header.querySelector('#btn-add-cleaning')?.addEventListener('click', () => this._openCleaningModal());

    try {
      const today = toISODate(new Date());
      const { data } = await this.db
        .from('cleaning_tasks')
        .select('*,units(name)')
        .eq('hotel_id', this.ctx.hotelId)
        .order('scheduled_date', { ascending: true })
        .limit(100);

      if (!data?.length) {
        panel.innerHTML = `
          <div class="empty-state">
            <span class="empty-state-icon">🧹</span>
            <p>Sin tareas de limpieza.</p>
            <p style="font-size:.78rem;color:var(--color-text-3)">
              Se generan automáticamente cuando un huésped hace check-out.
            </p>
          </div>`;
        return;
      }

      // KPIs rápidos
      const pending   = data.filter(t => t.status === 'pending'   && t.scheduled_date === today).length;
      const done      = data.filter(t => t.status === 'completed' && t.scheduled_date === today).length;
      const overdue   = data.filter(t => t.status !== 'completed' && t.scheduled_date < today).length;

      panel.innerHTML = `
        <div class="kpi-grid" style="margin-bottom:20px">
          <div class="kpi-card kpi-amber">
            <div class="kpi-body"><span class="kpi-label">Pendientes hoy</span><span class="kpi-value">${pending}</span></div>
          </div>
          <div class="kpi-card kpi-green">
            <div class="kpi-body"><span class="kpi-label">Finalizadas hoy</span><span class="kpi-value">${done}</span></div>
          </div>
          <div class="kpi-card kpi-rose">
            <div class="kpi-body"><span class="kpi-label">Atrasadas</span><span class="kpi-value">${overdue}</span></div>
          </div>
        </div>
        <div class="ops-list" id="cleaning-list">
          ${data.map(t => this._cleaningRowHTML(t, today)).join('')}
        </div>`;

      panel.querySelectorAll('.cleaning-status-btn').forEach(btn => {
        btn.addEventListener('click', () => this._updateCleaningStatus(btn.dataset.id, btn.dataset.status, panel));
      });

    } catch (err) {
      panel.innerHTML = this._errorHTML('cleaning_tasks');
    }
  }

  _cleaningRowHTML(task, today) {
    const statusMap = { pending:'⏳ Pendiente', in_progress:'🔄 En proceso', completed:'✅ Lista' };
    const isOverdue = task.status !== 'completed' && task.scheduled_date < today;
    const unitName  = task.units?.name ?? 'General';

    return `
      <div class="ops-row ${isOverdue ? 'ops-overdue' : ''} ${task.status === 'completed' ? 'ops-done' : ''}">
        <div class="ops-row-left">
          <span class="ops-unit-badge">${unitName}</span>
          <div class="ops-row-info">
            <div class="ops-row-title">${task.title ?? 'Limpieza post check-out'}</div>
            <div class="ops-row-meta">
              ${formatDate(task.scheduled_date)}
              ${task.assigned_to ? ` · 👤 ${task.assigned_to}` : ''}
              ${task.notes ? ` · ${task.notes}` : ''}
            </div>
          </div>
        </div>
        <div class="ops-row-right">
          <span class="ops-status-chip">${statusMap[task.status] ?? task.status}</span>
          ${task.status !== 'completed' ? `
            <button class="btn btn-outline btn-xs cleaning-status-btn"
                    data-id="${task.id}" data-status="${task.status === 'pending' ? 'in_progress' : 'completed'}">
              ${task.status === 'pending' ? 'Iniciar' : '✓ Finalizar'}
            </button>` : ''}
        </div>
      </div>`;
  }

  async _updateCleaningStatus(id, newStatus, panel) {
    try {
      const update = { status: newStatus };
      if (newStatus === 'completed') update.completed_at = new Date().toISOString();
      await this.db.from('cleaning_tasks').update(update).eq('id', id);
      await this._loadCleaning(panel, panel.closest('#operations-container').querySelector('#ops-header-actions'));
      showToast(newStatus === 'completed' ? '✅ Limpieza finalizada' : '🔄 En proceso', 'success');
    } catch { showToast('Error al actualizar', 'error'); }
  }

  _openCleaningModal() {
    const units = this.ctx.units ?? [];
    const today = toISODate(new Date());

    // Modal inline simple
    const existing = document.getElementById('overlay-cleaning-task');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-cleaning-task';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Nueva Tarea de Limpieza</h3>
          <button class="modal-close" id="cleaning-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Unidad</label>
            <select id="ct-unit" class="filter-select">
              <option value="">General</option>
              ${units.map(u => `<option value="${u.id}">#${u.sort_order} · ${u.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Título <span class="req">*</span></label>
            <input type="text" id="ct-title" placeholder="Limpieza profunda, cambio de sábanas...">
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label>Fecha <span class="req">*</span></label>
              <input type="date" id="ct-date" value="${today}">
            </div>
            <div class="form-group">
              <label>Responsable</label>
              <input type="text" id="ct-assigned" placeholder="Nombre">
            </div>
          </div>
          <div class="form-group">
            <label>Observaciones</label>
            <textarea id="ct-notes" rows="2"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="ct-cancel">Cancelar</button>
          <button class="btn btn-primary" id="ct-save">Guardar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.style.zIndex = '210'; // Por encima del modal base
    const close = () => { modal.remove(); escHandler && document.removeEventListener('keydown', escHandler); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
    modal.querySelector('#cleaning-modal-close').onclick = close;
    modal.querySelector('#ct-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    // Focus en primer input
    setTimeout(() => modal.querySelector('#ct-title')?.focus(), 80);
    modal.querySelector('#ct-save').addEventListener('click', async () => {
      const title = modal.querySelector('#ct-title').value.trim();
      const date  = modal.querySelector('#ct-date').value;
      if (!title || !date) { showToast('Título y fecha requeridos', 'warning'); return; }
      const saveBtn = modal.querySelector('#ct-save');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }
      try {
        const { error } = await this.db.from('cleaning_tasks').insert({
          hotel_id:     this.ctx.hotelId,
          unit_id:      modal.querySelector('#ct-unit').value || null,
          title, scheduled_date: date, status: 'pending',
          assigned_to:  modal.querySelector('#ct-assigned').value.trim() || null,
          notes:        modal.querySelector('#ct-notes').value.trim() || null,
        });
        if (error) throw error;
        showToast('Tarea de limpieza creada ✓', 'success');
        close();
        await this.load();
      } catch (err) {
        console.error('[Operations] cleaning insert:', err);
        showToast('Error: ' + (err?.message ?? 'Verificá que hayas corrido migration_complete_v8.sql en Supabase'), 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
      }
    });
  }

  // ══════════════════════════════════════════════════
  // MANTENIMIENTO
  // ══════════════════════════════════════════════════
  async _loadMaintenance(panel, header) {
    header.innerHTML = can('manageReminders')
      ? `<button class="btn btn-primary btn-sm" id="btn-add-maint">+ Nueva incidencia</button>`
      : '';
    header.querySelector('#btn-add-maint')?.addEventListener('click', () => this._openMaintenanceModal());

    try {
      const { data } = await this.db
        .from('maintenance_issues')
        .select('*,units(name)')
        .eq('hotel_id', this.ctx.hotelId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!data?.length) {
        panel.innerHTML = `
          <div class="empty-state">
            <span class="empty-state-icon">🔧</span>
            <p>Sin incidencias de mantenimiento.</p>
          </div>`;
        return;
      }

      const open    = data.filter(i => i.status !== 'resolved').length;
      const urgent  = data.filter(i => i.priority === 'urgent' && i.status !== 'resolved').length;

      panel.innerHTML = `
        <div class="kpi-grid" style="margin-bottom:20px">
          <div class="kpi-card kpi-amber">
            <div class="kpi-body"><span class="kpi-label">Abiertas</span><span class="kpi-value">${open}</span></div>
          </div>
          <div class="kpi-card kpi-rose">
            <div class="kpi-body"><span class="kpi-label">Urgentes</span><span class="kpi-value">${urgent}</span></div>
          </div>
        </div>
        <div class="ops-list">
          ${data.map(issue => this._maintenanceRowHTML(issue)).join('')}
        </div>`;

      panel.querySelectorAll('.maint-resolve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await this.db.from('maintenance_issues')
            .update({ status: 'resolved', resolved_at: new Date().toISOString() })
            .eq('id', btn.dataset.id);
          showToast('✅ Incidencia resuelta', 'success');
          this._loadMaintenance(panel, header);
        });
      });

    } catch (err) {
      panel.innerHTML = this._errorHTML('maintenance_issues');
    }
  }

  _maintenanceRowHTML(issue) {
    const pr  = PRIORITY_CONFIG[issue.priority ?? 'medium'];
    const unitName = issue.units?.name ?? 'General';
    const isOpen   = issue.status !== 'resolved';

    return `
      <div class="ops-row ${!isOpen ? 'ops-done' : ''}">
        <div class="ops-row-left">
          <span class="ops-priority-dot" style="background:${pr.color}" title="${pr.label}"></span>
          <div class="ops-row-info">
            <div class="ops-row-title">
              <span class="ops-unit-badge" style="margin-right:6px">${unitName}</span>
              ${issue.category ?? 'General'} — ${issue.title ?? issue.description ?? ''}
            </div>
            <div class="ops-row-meta">
              <span class="ops-badge" style="background:${pr.bg};color:${pr.color}">${pr.label}</span>
              ${issue.assigned_to ? ` · 👤 ${issue.assigned_to}` : ''}
              ${formatDate(issue.created_at ?? issue.created_date)}
              ${issue.status === 'resolved' ? ` · ✅ Resuelto ${formatDate(issue.resolved_at)}` : ''}
            </div>
          </div>
        </div>
        <div class="ops-row-right">
          ${isOpen ? `<button class="btn btn-outline btn-xs maint-resolve-btn" data-id="${issue.id}">✓ Resolver</button>` : ''}
        </div>
      </div>`;
  }

  _openMaintenanceModal() {
    const units = this.ctx.units ?? [];
    const existing = document.getElementById('overlay-maint-issue');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-maint-issue';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Nueva Incidencia de Mantenimiento</h3>
          <button class="modal-close" id="maint-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid-2">
            <div class="form-group">
              <label>Unidad</label>
              <select id="mi-unit" class="filter-select">
                <option value="">General</option>
                ${units.map(u => `<option value="${u.id}">#${u.sort_order} · ${u.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Categoría</label>
              <select id="mi-cat" class="filter-select">
                ${MAINTENANCE_CATEGORIES.map(c => `<option>${c}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Título / Descripción <span class="req">*</span></label>
            <input type="text" id="mi-title" placeholder="Ej: Aire acondicionado no enfría">
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label>Prioridad</label>
              <select id="mi-priority" class="filter-select">
                <option value="low">Baja</option>
                <option value="medium" selected>Media</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div class="form-group">
              <label>Responsable</label>
              <input type="text" id="mi-assigned" placeholder="Nombre / empresa">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="mi-cancel">Cancelar</button>
          <button class="btn btn-primary" id="mi-save">Registrar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.style.zIndex = '210';
    const close = () => { modal.remove(); escHandler && document.removeEventListener('keydown', escHandler); };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
    modal.querySelector('#maint-modal-close').onclick = close;
    modal.querySelector('#mi-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    setTimeout(() => modal.querySelector('#mi-title')?.focus(), 80);
    modal.querySelector('#mi-save').addEventListener('click', async () => {
      const title = modal.querySelector('#mi-title').value.trim();
      if (!title) { showToast('Ingresá una descripción', 'warning'); return; }
      const saveBtn = modal.querySelector('#mi-save');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }
      try {
        const { error } = await this.db.from('maintenance_issues').insert({
          hotel_id:    this.ctx.hotelId,
          unit_id:     modal.querySelector('#mi-unit').value || null,
          title, status: 'open',
          priority:    modal.querySelector('#mi-priority').value ?? 'normal',
          reported_by: modal.querySelector('#mi-assigned').value.trim() || null,
        });
        if (error) throw error;
        showToast('Incidencia registrada ✓', 'success');
        close();
        await this.load();
      } catch (err) {
        console.error('[Operations] maintenance insert:', err);
        showToast('Error: ' + (err?.message ?? 'No se pudo guardar. ¿Corriste la migración SQL?'), 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
      }
    });
  }

  // ══════════════════════════════════════════════════
  // STOCK
  // ══════════════════════════════════════════════════
  async _loadStock(panel, header) {
    header.innerHTML = can('manageExpenses')
      ? `<button class="btn btn-primary btn-sm" id="btn-save-stock">💾 Guardar stock</button>`
      : '';

    try {
      const { data } = await this.db
        .from('hotel_stock')
        .select('*')
        .eq('hotel_id', this.ctx.hotelId);

      const stockMap = {};
      (data ?? []).forEach(s => { stockMap[s.item_key] = s; });

      panel.innerHTML = `
        <div class="stock-grid">
          ${STOCK_ITEMS.map(item => {
            const stock   = stockMap[item.key];
            const current = stock?.current_stock ?? 0;
            const minimum = stock?.minimum_stock ?? 5;
            const isLow   = current <= minimum && current > 0;
            const isCrit  = current === 0;
            return `
              <div class="stock-card ${isCrit ? 'stock-critical' : isLow ? 'stock-low' : ''}">
                <div class="stock-header">
                  <span class="stock-name">${item.label}</span>
                  ${isCrit ? '<span class="stock-alert-badge stock-badge-critical">🚨 Agotado</span>' :
                    isLow  ? '<span class="stock-alert-badge stock-badge-low">⚠️ Bajo</span>' :
                             '<span class="stock-alert-badge stock-badge-ok">✓ OK</span>'}
                </div>
                <div class="stock-inputs">
                  <div class="form-group" style="margin:0">
                    <label>Stock actual</label>
                    <input type="number" class="stock-input form-control" data-key="${item.key}"
                           data-field="current" min="0" value="${current}" placeholder="0">
                  </div>
                  <div class="form-group" style="margin:0">
                    <label>Mínimo</label>
                    <input type="number" class="stock-input form-control" data-key="${item.key}"
                           data-field="minimum" min="0" value="${minimum}" placeholder="5">
                  </div>
                </div>
                <div class="stock-unit">${item.unit}</div>
              </div>`;
          }).join('')}
        </div>`;

      header.querySelector('#btn-save-stock')?.addEventListener('click', () => this._saveStock(panel));

    } catch {
      panel.innerHTML = this._errorHTML('hotel_stock');
    }
  }

  async _saveStock(panel) {
    const rows = [];
    panel.querySelectorAll('.stock-input[data-key]').forEach(input => {
      const key = input.dataset.key;
      const field = input.dataset.field;
      if (!rows.find(r => r.item_key === key)) {
        rows.push({ hotel_id: this.ctx.hotelId, item_key: key, current_stock: 0, minimum_stock: 5 });
      }
      const row = rows.find(r => r.item_key === key);
      if (field === 'current') row.current_stock = parseInt(input.value) || 0;
      if (field === 'minimum') row.minimum_stock = parseInt(input.value) || 0;
    });

    try {
      const { error } = await this.db
        .from('hotel_stock')
        .upsert(rows, { onConflict: 'hotel_id,item_key' });
      if (error) throw error;
      showToast('Stock actualizado ✓', 'success');
      await this._loadStock(panel, panel.closest('#operations-container').querySelector('#ops-header-actions'));
    } catch { showToast('Error al guardar stock', 'error'); }
  }

  _errorHTML(table) {
    return `
      <div class="error-state">
        <p>No se pudo cargar la sección.</p>
        <p style="font-size:.78rem;color:var(--color-text-3);margin-top:4px">
          Verificá que exista la tabla <code>${table}</code> en Supabase.
        </p>
      </div>`;
  }

  // ── API pública: crear tarea de limpieza al check-out ──
  static async createCheckoutCleaningTask(supabase, ctx, booking) {
    try {
      const unitIds = (booking.booking_units ?? []).map(bu => bu.unit_id);
      for (const unitId of unitIds) {
        const unit = ctx.units.find(u => u.id === unitId);
        await supabase.from('cleaning_tasks').insert({
          hotel_id:      ctx.hotelId,
          unit_id:       unitId,
          title:         `Check-out: ${booking.guests?.first_name ?? ''} ${booking.guests?.last_name ?? ''}`.trim(),
          scheduled_date: booking.check_out,
          status:         'pending',
          notes:          `Reserva #${String(booking.id).slice(0,8)} · ${booking.nights ?? '?'} noches`,
        });
      }
    } catch (err) {
      console.warn('[Operations] No se pudo crear tarea de limpieza:', err.message);
    }
  }
}
