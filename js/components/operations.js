// ══════════════════════════════════════════════════
// operations.js — Módulo Operaciones
// • Limpieza (generada automáticamente al check-out)
// • Mantenimiento (incidencias con prioridades)
// • Stock e Insumos (alertas de stock bajo)
// ══════════════════════════════════════════════════

import { showToast, toISODate, formatDate, formatARS, getUnitColor, getUnitChipHTML, localToday } from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { logAction } from '../services/audit-service.js';
import { CATEGORIES as EXPENSE_CATEGORIES, categoryColor } from '../services/expense-categories.js';

const PRIORITY_CONFIG = {
  low:    { label: 'Baja',    color: '#94a3b8', bg: '#f1f5f9' },
  medium: { label: 'Media',   color: '#f59e0b', bg: '#fffbeb' },
  high:   { label: 'Alta',    color: '#ef4444', bg: '#fef2f2' },
  urgent: { label: 'Urgente', color: '#dc2626', bg: '#fee2e2' },
};

const MAINTENANCE_CATEGORIES = [
  'Aire acondicionado','Termotanque','Televisor','WiFi / Internet',
  'Plomería','Electricidad','Mobiliario','Electrodoméstico','Estructural',
  'Bloqueo calendario','Otro',
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

  _withTimeout(promise, label = 'operación', ms = 12000) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} tardó demasiado. Revisá conexión/permisos e intentá nuevamente.`));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  async load() {
    const container = document.getElementById('operations-container');
    if (!container) return;

    container.innerHTML = this._renderShell();
    this._bindTabs(container);
    await this._loadTab('reminders', container);
  }

  _renderShell() {
    return `
      <div class="tabs-bar ops-tabs">
        <button class="tab active" data-ops-tab="reminders">🔔 Recordatorios</button>
        <button class="tab" data-ops-tab="cleaning">🧹 Limpieza</button>
        <button class="tab" data-ops-tab="maintenance">🔧 Mantenimiento</button>
        <button class="tab" data-ops-tab="expenses">💰 Gastos</button>
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

    if (tab === 'reminders')    await this._loadReminders(panel, header);
    if (tab === 'cleaning')     await this._loadCleaning(panel, header);
    if (tab === 'maintenance')  await this._loadMaintenance(panel, header);
    if (tab === 'stock')        await this._loadStock(panel, header);
    if (tab === 'expenses')     await this._loadExpenses(panel, header);
  }

  // ══════════════════════════════════════════════════
  // RECORDATORIOS
  // ══════════════════════════════════════════════════
  async _loadReminders(panel, header) {
    header.innerHTML = `<button class="btn btn-primary btn-sm" id="btn-add-reminder-ops">+ Nuevo Recordatorio</button>`;
    panel.innerHTML  = '<div class="loading-state">Cargando...</div>';

    document.getElementById('btn-add-reminder-ops')?.addEventListener('click', () => {
      const overlay = document.getElementById('overlay-reminder');
      const titleEl = overlay?.querySelector('.modal-title');
      if (titleEl) titleEl.textContent = 'Nuevo Recordatorio';
      const r_title = document.getElementById('r-title');
      const r_date  = document.getElementById('r-date');
      const r_desc  = document.getElementById('r-desc');
      if (r_title) r_title.value = '';
      if (r_date)  r_date.value  = localToday();
      if (r_desc)  r_desc.value  = '';
      if (typeof populateReminderUnitSelect === 'function') populateReminderUnitSelect();
      overlay?.classList.remove('hidden');
    });

    const { data: reminders, error } = await this.db
      .from('reminders')
      .select('*, units(name)')
      .eq('hotel_id', this.ctx.hotelId)
      .order('scheduled_date');

    if (error) {
      panel.innerHTML = `<div class="error-state" style="padding:32px;text-align:center">
        <p style="font-weight:700">Error al cargar recordatorios</p>
        <p style="font-size:.82rem;color:var(--color-text-3)">${error.message}</p></div>`;
      return;
    }

    if (!reminders?.length) {
      panel.innerHTML = `<div class="empty-state">
        <span class="empty-state-icon">🔔</span>
        <p>Sin recordatorios.</p>
        <p style="font-size:.78rem;color:var(--color-text-3)">Usá el botón "+ Nuevo Recordatorio" para crear uno.</p>
      </div>`;
      return;
    }

    const today = localToday();
    panel.innerHTML = `<div class="ops-list" id="reminders-ops-list">${reminders.map(r => {
      const isToday  = r.scheduled_date === today;
      const isPast   = r.scheduled_date < today && !r.completed;
      const dotColor = r.completed ? '#94a3b8' : isToday ? '#f59e0b' : isPast ? '#ef4444' : 'var(--color-primary)';
      const fmtD = d => d ? new Date(d+'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'}) : '—';
      return `<div class="reminder-card ${r.completed?'reminder-done':''} ${isPast?'reminder-overdue':''}" data-id="${r.id}">
        <div class="reminder-dot" style="background:${dotColor}"></div>
        <div class="reminder-body">
          <div class="reminder-title ${r.completed?'line-through':''}">${r.title}</div>
          <div class="reminder-meta">
            📅 ${fmtD(r.scheduled_date)}
            ${r.units?.name ? ` · 🏠 ${r.units.name}` : ' · General'}
            ${r.description ? ` · ${r.description}` : ''}
          </div>
        </div>
        <div class="reminder-actions">
          <label class="reminder-check" title="${r.completed?'Marcar pendiente':'Marcar completado'}">
            <input type="checkbox" ${r.completed?'checked':''} onchange="window.toggleReminder('${r.id}',this.checked)">
            <span class="reminder-check-icon">${r.completed?'✅':'⬜'}</span>
          </label>
          <button class="btn btn-ghost btn-xs reminder-edit-btn"
            data-id="${r.id}" data-title="${r.title.replace(/"/g,'&quot;')}"
            data-date="${r.scheduled_date}" data-desc="${(r.description??'').replace(/"/g,'&quot;')}"
            data-unit="${r.unit_id??''}" title="Editar">✏️</button>
          <button class="btn btn-ghost btn-xs reminder-del-ops-btn" data-id="${r.id}" title="Eliminar">🗑️</button>
        </div>
      </div>`;
    }).join('')}</div>`;

    // Event delegation
    if (!panel.dataset.reminderOpsBound) {
      panel.dataset.reminderOpsBound = '1';
      panel.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.reminder-edit-btn');
        const delBtn  = e.target.closest('.reminder-del-ops-btn');

        if (editBtn) {
          const titleEl = document.getElementById('r-title');
          const dateEl  = document.getElementById('r-date');
          const descEl  = document.getElementById('r-desc');
          const unitEl  = document.getElementById('r-unit');
          if (titleEl) titleEl.value = editBtn.dataset.title;
          if (dateEl)  dateEl.value  = editBtn.dataset.date;
          if (descEl)  descEl.value  = editBtn.dataset.desc;
          if (typeof populateReminderUnitSelect === 'function') populateReminderUnitSelect();
          setTimeout(() => { if (unitEl) unitEl.value = editBtn.dataset.unit; }, 60);
          const overlay    = document.getElementById('overlay-reminder');
          const saveBtn    = document.getElementById('reminder-save');
          const modalTitle = overlay?.querySelector('.modal-title');
          if (modalTitle) modalTitle.textContent = 'Editar Recordatorio';
          overlay?.classList.remove('hidden');
          const handleSave = async () => {
            const title = titleEl?.value.trim();
            const date  = dateEl?.value;
            if (!title || !date) { showToast('Título y fecha obligatorios','warning'); return; }
            const { error } = await this.db.from('reminders')
              .update({ title, description: descEl?.value.trim()||null, scheduled_date: date, unit_id: unitEl?.value||null })
              .eq('id', editBtn.dataset.id);
            if (error) { showToast('Error: '+error.message,'error'); return; }
            showToast('Recordatorio actualizado ✓','success');
            overlay?.classList.add('hidden');
            if (modalTitle) modalTitle.textContent = 'Nuevo Recordatorio';
            saveBtn?.removeEventListener('click', handleSave);
            panel.dataset.reminderOpsBound = '';
            await this._loadReminders(panel, header);
          };
          saveBtn?.removeEventListener('click', window._reminderSaveHandler);
          saveBtn?.addEventListener('click', handleSave);
          window._reminderSaveHandler = handleSave;
        }

        if (delBtn && !delBtn.disabled) {
          if (!confirm('¿Eliminar este recordatorio?')) return;
          delBtn.disabled = true;
          const { error } = await this.db.from('reminders').delete().eq('id', delBtn.dataset.id);
          if (error) { showToast('Error: '+error.message,'error'); delBtn.disabled=false; return; }
          showToast('Eliminado','success');
          panel.dataset.reminderOpsBound = '';
          await this._loadReminders(panel, header);
        }
      });
    }

    // Update badge
    const pending = reminders.filter(r => !r.completed && r.scheduled_date <= today).length;
    document.dispatchEvent(new CustomEvent('reminders:badge', { detail: { count: pending } }));
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
      // Auto-generate cleaning tasks for checkouts today
      await this._autoCreateCheckoutCleaningTasks(today);

      const { data, error } = await this.db
        .from('cleaning_tasks')
        .select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .order('scheduled_date', { ascending: true })
        .limit(100);

      if (error) throw error;

      if (!data?.length) {
        panel.innerHTML = `
          <div class="empty-state">
            <span class="empty-state-icon">🧹</span>
            <p>Sin tareas de limpieza.</p>
            <p style="font-size:.78rem;color:var(--color-text-3)">
              Se generan automáticamente cuando hay check-outs. También podés crear una manualmente.
            </p>
          </div>`;
        return;
      }

      const pending  = data.filter(t => t.status === 'pending'   && t.scheduled_date === today).length;
      const done     = data.filter(t => t.status === 'completed' && t.scheduled_date === today).length;
      const overdue  = data.filter(t => t.status !== 'completed' && t.scheduled_date < today).length;

      panel.innerHTML = `
        <div class="kpi-grid" style="margin-bottom:16px">
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

      // ── Event delegation — usa data-bound para no duplicar listener ──
      if (!panel.dataset.cleaningBound) {
        panel.dataset.cleaningBound = '1';
        panel.addEventListener('click', async (e) => {
          const btn = e.target.closest('button');
          if (!btn) return;

          if (btn.classList.contains('cleaning-status-btn') && !btn.disabled) {
            const id = btn.dataset.id;
            const newStatus = btn.dataset.status;
            btn.disabled = true; btn.textContent = '...';
            try {
              const update = { status: newStatus };
              if (newStatus === 'completed') update.completed_at = new Date().toISOString();
              const { error } = await this.db.from('cleaning_tasks').update(update).eq('id', id);
              if (error) throw error;
              showToast(newStatus === 'completed' ? '✅ Limpieza lista — depto disponible' : '🔄 En proceso', 'success');
              await this._loadCleaning(panel, header);
              if (typeof updateOperationsBadge === 'function') updateOperationsBadge();
            } catch (err) {
              showToast('Error: ' + (err?.message ?? err), 'error');
              btn.disabled = false; btn.textContent = newStatus === 'in_progress' ? 'Iniciar' : '✓ Listo';
            }
          }

          if (btn.classList.contains('cleaning-delete-btn') && !btn.disabled) {
            if (!confirm('¿Eliminar esta tarea?')) return;
            btn.disabled = true;
            const { error } = await this.db.from('cleaning_tasks').delete().eq('id', btn.dataset.id);
            if (error) { showToast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
            showToast('Tarea eliminada', 'success');
            await this._loadCleaning(panel, header);
            if (typeof updateOperationsBadge === 'function') updateOperationsBadge();
          }
        });
      }

    } catch (err) {
      console.error('[Operations] cleaning:', err);
      panel.innerHTML = this._errorHTML('cleaning_tasks');
    }
  }

  _cleaningRowHTML(task, today) {
    const statusMap = {
      pending:     '⏳ Pendiente',
      in_progress: '🔄 En proceso',
      completed:   '✅ Lista',
      skipped:     '⏭️ Omitida',
    };
    const isOverdue = task.status !== 'completed' && task.scheduled_date < today;
    const unitName  = task.unit_name ?? task.units?.name ??
                      this.ctx.units?.find(u => u.id === task.unit_id)?.name ?? 'General';

    return `
      <div class="ops-row ${isOverdue ? 'ops-overdue' : ''} ${task.status === 'completed' ? 'ops-done' : ''}" data-id="${task.id}">
        <div class="ops-row-left">
          <span class="ops-unit-badge">${unitName}</span>
          <div class="ops-row-info">
            <div class="ops-row-title">${task.title ?? 'Limpieza'}</div>
            <div class="ops-row-meta">
              ${formatDate(task.scheduled_date)}
              ${task.assigned_to ? ` · 👤 ${task.assigned_to}` : ''}
              ${task.notes       ? ` · ${task.notes}`          : ''}
            </div>
          </div>
        </div>
        <div class="ops-row-right">
          <span class="ops-status-chip">${statusMap[task.status] ?? task.status}</span>
          ${task.status === 'pending' ? `
            <button class="btn btn-outline btn-xs cleaning-status-btn"
                    data-id="${task.id}" data-status="in_progress">Iniciar</button>` : ''}
          ${task.status === 'in_progress' ? `
            <button class="btn btn-primary btn-xs cleaning-status-btn"
                    data-id="${task.id}" data-status="completed">✓ Listo</button>` : ''}
          <button class="btn btn-ghost btn-xs cleaning-delete-btn"
                  data-id="${task.id}" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }

  async _autoCreateCheckoutCleaningTasks(today) {
    try {
      // Find bookings with checkout today that don't have a cleaning task yet
      const { data: checkouts } = await this.db
        .from('bookings')
        .select('id, booking_units(unit_id)')
        .eq('hotel_id', this.ctx.hotelId)
        .eq('check_out', today)
        .not('status', 'in', '(cancelled,blocked)');

      if (!checkouts?.length) return;

      for (const b of checkouts) {
        const units = b.booking_units ?? [];
        for (const bu of units) {
          // Check if task already exists for this booking+unit+date
          const { data: existing } = await this.db.from('cleaning_tasks')
            .select('id')
            .eq('hotel_id', this.ctx.hotelId)
            .eq('scheduled_date', today)
            .eq('unit_id', bu.unit_id)
            .limit(1);
          if (existing?.length) continue;

          const unitName = this.ctx.units?.find(u => u.id === bu.unit_id)?.name ?? 'Unidad';
          await this.db.from('cleaning_tasks').insert({
            hotel_id:       this.ctx.hotelId,
            unit_id:        bu.unit_id,
            title:          `Limpieza post check-out — ${unitName}`,
            scheduled_date: today,
            status:         'pending',
          });
        }
      }
    } catch { /* silencioso — si la tabla no existe aún */ }
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
        const { error } = await this._withTimeout(this.db.from('cleaning_tasks').insert({
          hotel_id:     this.ctx.hotelId,
          unit_id:      modal.querySelector('#ct-unit').value || null,
          title, scheduled_date: date, status: 'pending',
          assigned_to:  modal.querySelector('#ct-assigned').value.trim() || null,
          notes:        modal.querySelector('#ct-notes').value.trim() || null,
        }), 'Crear tarea de limpieza');
        if (error) throw error;
        showToast('Tarea de limpieza creada ✓', 'success');
        close();
        const panel = document.getElementById('ops-panel');
        const hdrEl = document.getElementById('ops-header-actions');
        if (panel && hdrEl) await this._loadCleaning(panel, hdrEl);
        if (typeof updateOperationsBadge === 'function') updateOperationsBadge();
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
    const addMaintBtn = header.querySelector('#btn-add-maint');
    if (addMaintBtn) addMaintBtn.addEventListener('click', () => this._openMaintenanceModal(panel, header));

    try {
      // Cargar maintenance_issues y bloqueos huérfanos en paralelo
      const [issuesRes, blocksRes] = await Promise.all([
        this.db
          .from('maintenance_issues')
          .select('*')
          .eq('hotel_id', this.ctx.hotelId)
          .order('created_at', { ascending: false })
          .limit(100),
        this.db
          .from('bookings')
          .select('id, check_in, check_out, block_reason, is_blocked, status, booking_units(unit_id)')
          .eq('hotel_id', this.ctx.hotelId)
          .eq('is_blocked', true)
          .neq('status', 'cancelled')
          .order('check_in', { ascending: false })
          .limit(100),
      ]);

      if (issuesRes.error) throw issuesRes.error;

      const issues = issuesRes.data ?? [];

      // IDs de bookings que ya tienen maintenance_issue
      const linkedBookingIds = new Set(
        issues.map(i => i.booking_id).filter(Boolean)
      );

      // Bloqueos huérfanos: no tienen maintenance_issue asociado
      const orphanBlocks = (blocksRes.data ?? []).filter(
        b => !linkedBookingIds.has(b.id)
      );

      const open   = issues.filter(i => i.status !== 'resolved').length + orphanBlocks.length;
      const urgent = issues.filter(i => i.priority === 'urgent' && i.status !== 'resolved').length;

      const hasContent = issues.length > 0 || orphanBlocks.length > 0;
      if (!hasContent) {
        panel.innerHTML = `
          <div class="empty-state">
            <span class="empty-state-icon">🔧</span>
            <p>Sin incidencias de mantenimiento.</p>
          </div>`;
        return;
      }

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
          ${issues.map(issue => this._maintenanceRowHTML(issue)).join('')}
          ${orphanBlocks.length ? `
            <div style="margin:16px 0 8px;font-size:.72rem;font-weight:700;text-transform:uppercase;
                        letter-spacing:.06em;color:var(--color-text-3);padding:0 4px;">
              🔒 Bloqueos del calendario sin incidencia
            </div>
            ${orphanBlocks.map(b => this._blockOrphanRowHTML(b)).join('')}
          ` : ''}
        </div>`;

      // ── Event delegation — data-bound guard ─────────────────────
      if (!panel.dataset.maintBound) {
        panel.dataset.maintBound = '1';
        panel.addEventListener('click', async (e) => {
          const btn = e.target.closest('button');
          if (!btn || btn.disabled) return;

          if (btn.classList.contains('maint-resolve-btn')) {
            if (!confirm('¿Marcar como resuelta?')) return;
            btn.disabled = true; btn.textContent = '...';
            const { error } = await this.db.from('maintenance_issues')
              .update({ status: 'resolved', resolved_at: new Date().toISOString() })
              .eq('id', btn.dataset.id);
            if (error) {
              showToast('Error: ' + error.message, 'error');
              btn.disabled = false; btn.textContent = '✓ Resolver';
              return;
            }
            showToast('✅ Incidencia resuelta', 'success');
            panel.dataset.maintBound = '';
            await this._loadMaintenance(panel, header);
            if (typeof updateOperationsBadge === 'function') updateOperationsBadge();
          }

          if (btn.classList.contains('maint-edit-btn')) {
            const issueId = btn.dataset.id;
            const allIssues = [...panel.querySelectorAll('.ops-row[data-id]')].map(r => r.dataset.id);
            // Fetch the issue data from DB and open edit modal
            const { data: iss } = await this.db.from('maintenance_issues')
              .select('*').eq('id', issueId).single();
            if (iss) this._openMaintenanceEditModal(iss, panel, header);
            return;
          }

          if (btn.classList.contains('maint-delete-btn')) {
            if (!confirm('¿Eliminar esta incidencia?')) return;
            btn.disabled = true;
            const { error } = await this.db.from('maintenance_issues').delete().eq('id', btn.dataset.id);
            if (error) { showToast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
            showToast('Eliminada', 'success');
            panel.dataset.maintBound = '';
            await this._loadMaintenance(panel, header);
            if (typeof updateOperationsBadge === 'function') updateOperationsBadge();
          }

          // Eliminar bloqueo huérfano desde mantenimiento
          if (btn.classList.contains('maint-block-delete-btn')) {
            if (!confirm('¿Eliminar este bloqueo del calendario?')) return;
            btn.disabled = true;
            const bookingId = btn.dataset.bookingId;
            const { error } = await this.db.from('bookings').delete().eq('id', bookingId);
            if (error) { showToast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
            showToast('Bloqueo eliminado ✓', 'success');
            panel.dataset.maintBound = '';
            await this._loadMaintenance(panel, header);
            if (typeof updateOperationsBadge === 'function') updateOperationsBadge();
          }
        });
      }

    } catch (err) {
      console.error('[Operations] _loadMaintenance error:', err);
      panel.innerHTML = this._errorHTML('maintenance_issues');
    }
  }

  // ── Fila HTML para bloqueo huérfano (sin maintenance_issue) ──
  _blockOrphanRowHTML(block) {
    const unitId   = block.booking_units?.[0]?.unit_id ?? null;
    const unitObj  = this.ctx.units?.find(u => String(u.id) === String(unitId));
    const unitName = unitObj ? `#${unitObj.sort_order} · ${unitObj.name}` : 'Sin unidad';
    const reason   = block.block_reason ?? 'Bloqueo';
    const ci       = block.check_in  ?? '';
    const co       = block.check_out ?? '';

    return `
      <div class="ops-row" data-booking-id="${block.id}" style="border-left:3px solid #fca5a5;">
        <div class="ops-row-left">
          <span class="ops-priority-dot" style="background:#ef4444" title="Bloqueo"></span>
          <div class="ops-row-info">
            <div class="ops-row-title">
              <span class="ops-unit-badge" style="margin-right:6px">${unitName}</span>
              🔒 ${reason}
            </div>
            <div class="ops-row-meta">
              <span class="ops-badge" style="background:#fef2f2;color:#dc2626;">Bloqueo calendario</span>
              ${ci} → ${co}
            </div>
          </div>
        </div>
        <div class="ops-row-right">
          <button class="btn btn-ghost btn-xs maint-block-delete-btn"
                  data-booking-id="${block.id}" title="Eliminar bloqueo">🗑️</button>
        </div>
      </div>`;
  }

  _maintenanceRowHTML(issue) {
    const pr       = PRIORITY_CONFIG[issue.priority ?? 'medium'];
    const unitName = issue.unit_name ?? issue.units?.name ??
                     this.ctx.units?.find(u => String(u.id) === String(issue.unit_id))?.name ??
                     'General';
    const isOpen   = issue.status !== 'resolved';

    return `
      <div class="ops-row ${!isOpen ? 'ops-done' : ''}" data-id="${issue.id}">
        <div class="ops-row-left">
          <span class="ops-priority-dot" style="background:${pr.color}" title="${pr.label}"></span>
          <div class="ops-row-info">
            <div class="ops-row-title">
              <span class="ops-unit-badge" style="margin-right:6px">${unitName}</span>
              ${issue.category ?? 'General'} — ${issue.title ?? issue.description ?? ''}
            </div>
            <div class="ops-row-meta">
              <span class="ops-badge" style="background:${pr.bg};color:${pr.color}">${pr.label}</span>
              ${formatDate(issue.created_at)}
              ${issue.assigned_to ? ` · 👤 ${issue.assigned_to}` : ''}
              ${issue.status === 'resolved' ? ` · ✅ Resuelto ${formatDate(issue.resolved_at)}` : ''}
            </div>
          </div>
        </div>
        <div class="ops-row-right">
          ${isOpen
            ? `<button class="btn btn-primary btn-xs maint-resolve-btn" data-id="${issue.id}">✓ Resolver</button>`
            : `<span style="font-size:.72rem;color:var(--color-text-3)">Resuelto</span>`}
          <button class="btn btn-ghost btn-xs maint-edit-btn" data-id="${issue.id}" title="Editar" style="font-size:.85rem;">✏️</button>
          <button class="btn btn-ghost btn-xs maint-delete-btn" data-id="${issue.id}" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }

  _openMaintenanceModal(panel, header) {
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
        const unitVal = modal.querySelector('#mi-unit').value;
        const { error } = await this._withTimeout(this.db.from('maintenance_issues').insert({
          hotel_id:    this.ctx.hotelId,
          unit_id:     unitVal || null,
          category:    modal.querySelector('#mi-cat')?.value || null,
          title,
          status:      'open',
          priority:    modal.querySelector('#mi-priority').value || 'medium',
          assigned_to: modal.querySelector('#mi-assigned').value.trim() || null,
        }), 'Crear incidencia de mantenimiento', 8000);
        if (error) throw error;
        showToast('Incidencia registrada ✓', 'success');
        close();
        panel.dataset.maintBound = '';
        await this._loadMaintenance(panel, header);
        if (typeof updateOperationsBadge === 'function') updateOperationsBadge();
      } catch (err) {
        console.error('[Operations] maintenance insert:', err);
        // Si el error es de permisos RLS, dar instrucción específica
        const isRLS = err?.message?.includes('policy') || err?.message?.includes('permission') || err?.message?.includes('tardó demasiado');
        const msg = isRLS
          ? 'Sin permiso para insertar. Ejecutá fix_all_rls.sql en Supabase → SQL Editor.'
          : 'Error: ' + (err?.message ?? 'Intentá nuevamente');
        showToast(msg, 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Registrar'; }
      }
    });
  }


  // ── Modal de edición de incidencia de mantenimiento ──
  _openMaintenanceEditModal(issue, panel, header) {
    const existing = document.getElementById('overlay-maint-edit');
    if (existing) existing.remove();

    const unitObj  = this.ctx.units?.find(u => String(u.id) === String(issue.unit_id));
    const unitChip = unitObj ? getUnitChipHTML(unitObj, 'sm') : '<span style="color:var(--color-text-3);font-size:.8rem;">General / Sin unidad</span>';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-maint-edit';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header" style="background:var(--color-surface-2);">
          <div style="display:flex;flex-direction:column;gap:4px;">
            <h3 class="modal-title">✏️ Editar incidencia</h3>
            <div>${unitChip}</div>
          </div>
          <button class="modal-close" id="me-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid-2">
            <div class="form-group">
              <label>Categoría</label>
              <select id="me-cat" class="filter-select">
                ${MAINTENANCE_CATEGORIES.map(c => `<option${c === issue.category ? ' selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Prioridad</label>
              <select id="me-priority" class="filter-select">
                ${['low','medium','high','urgent'].map(p => `<option value="${p}"${p === issue.priority ? ' selected' : ''}>${{low:'Baja',medium:'Media',high:'Alta',urgent:'Urgente'}[p]}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Título / Descripción</label>
            <input type="text" id="me-title" value="${(issue.title ?? '').replace(/"/g, '&quot;')}" placeholder="Descripción de la incidencia">
          </div>
          <div class="form-group">
            <label>Notas adicionales</label>
            <textarea id="me-notes" rows="2" placeholder="Notas, detalles, presupuesto...">${issue.description ?? ''}</textarea>
          </div>
          <div class="form-group">
            <label>Responsable</label>
            <input type="text" id="me-assigned" value="${(issue.assigned_to ?? '').replace(/"/g, '&quot;')}" placeholder="Nombre / empresa">
          </div>
        </div>
        <div class="modal-footer" style="flex-wrap:wrap;gap:8px;">
          <button class="btn btn-outline" id="me-cancel">Cancelar</button>
          <button class="btn btn-primary" id="me-save">Guardar cambios</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.style.zIndex = '210';

    const close = () => {
      modal.remove();
      if (escHandler) document.removeEventListener('keydown', escHandler);
    };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
    modal.querySelector('#me-close').onclick = close;
    modal.querySelector('#me-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    setTimeout(() => modal.querySelector('#me-title')?.focus(), 80);

    modal.querySelector('#me-save').addEventListener('click', async () => {
      const title = modal.querySelector('#me-title').value.trim();
      if (!title) { showToast('Ingresá una descripción', 'warning'); return; }
      const saveBtn = modal.querySelector('#me-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
      try {
        const { error } = await this.db.from('maintenance_issues').update({
          title,
          description:  modal.querySelector('#me-notes').value.trim() || null,
          category:     modal.querySelector('#me-cat').value || null,
          priority:     modal.querySelector('#me-priority').value || 'medium',
          assigned_to:  modal.querySelector('#me-assigned').value.trim() || null,
        }).eq('id', issue.id);
        if (error) throw error;
        showToast('Incidencia actualizada ✓', 'success');
        close();
        panel.dataset.maintBound = '';
        await this._loadMaintenance(panel, header);
      } catch (err) {
        console.error('[Operations] maint edit:', err);
        showToast('Error: ' + (err?.message ?? String(err)), 'error');
        saveBtn.disabled = false; saveBtn.textContent = 'Guardar cambios';
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
      <div class="error-state" style="padding:32px;text-align:center">
        <div style="font-size:2rem;margin-bottom:12px">🗄️</div>
        <p style="font-weight:700;margin-bottom:6px">Tabla no encontrada: <code>${table}</code></p>
        <p style="font-size:.82rem;color:var(--color-text-3);max-width:380px;margin:0 auto 16px">
          Ejecutá <strong>migration_complete_v8.sql</strong> en el SQL Editor de Supabase para crear esta tabla.
        </p>
        <a href="https://supabase.com/dashboard/project/tuneeinpudlsezzmvaro/editor"
           target="_blank" rel="noopener"
           class="btn btn-primary btn-sm">
          Abrir SQL Editor →
        </a>
      </div>`;
  }

  // ══════════════════════════════════════════════════
  // GASTOS — movidos desde Estadísticas
  // ══════════════════════════════════════════════════
  async _loadExpenses(panel, header) {
    const canManage = can('manageExpenses');
    if (header) {
      header.innerHTML = canManage
        ? `<button class="btn btn-primary btn-sm" id="btn-ops-add-expense">+ Nuevo gasto</button>`
        : '';
      header.querySelector('#btn-ops-add-expense')?.addEventListener('click', () => {
        this._openExpenseModal(null, reload);
      });
    }

    // Selector de mes (con flechas, sin ocupar todo el ancho)
    const now = new Date();
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    // Estado del período actualmente visible (vive en el dataset del header para sobrevivir a re-renders)
    this._opsExpCursor = this._opsExpCursor ?? { month: now.getMonth(), year: now.getFullYear() };

    panel.innerHTML = `
      <div class="ops-expenses-header">
        <div class="ops-month-nav">
          <button type="button" class="ops-month-nav-btn" id="ops-exp-prev" title="Mes anterior">‹</button>
          <span class="ops-month-nav-label" id="ops-exp-month-label"></span>
          <button type="button" class="ops-month-nav-btn" id="ops-exp-next" title="Mes siguiente">›</button>
        </div>
        <div class="ops-month-nav ops-month-nav--year">
          <button type="button" class="ops-month-nav-btn" id="ops-exp-prev-year" title="Año anterior">‹</button>
          <span class="ops-month-nav-label" id="ops-exp-year-label"></span>
          <button type="button" class="ops-month-nav-btn" id="ops-exp-next-year" title="Año siguiente">›</button>
        </div>
      </div>
      <div id="ops-expenses-summary"></div>
      <div id="ops-expenses-list"><div class="loading-state">Cargando...</div></div>
    `;

    const monthLabel = panel.querySelector('#ops-exp-month-label');
    const yearLabel  = panel.querySelector('#ops-exp-year-label');

    const reload = async () => {
      const { month, year } = this._opsExpCursor;
      if (monthLabel) monthLabel.textContent = months[month];
      if (yearLabel)  yearLabel.textContent  = String(year);

      const first = `${year}-${String(month+1).padStart(2,'0')}-01`;
      const last  = new Date(year, month+1, 0).toISOString().slice(0,10);
      try {
        const { data: exps } = await this.db.from('expenses').select('*')
          .eq('hotel_id', this.ctx.hotelId)
          .or(`due_date.is.null,and(due_date.gte.${first},due_date.lte.${last})`)
          .order('description', { ascending: true });

        const finalExps = await this._ensureRecurringExpenses(month, year, exps ?? []);
        this._renderExpensesInOps(panel, finalExps);
      } catch (err) {
        panel.querySelector('#ops-expenses-list').innerHTML =
          `<div class="error-state"><p>Error al cargar gastos: ${err.message}</p></div>`;
      }
    };

    const shiftMonth = (delta) => {
      let { month, year } = this._opsExpCursor;
      month += delta;
      if (month < 0)  { month = 11; year--; }
      if (month > 11) { month = 0;  year++; }
      this._opsExpCursor = { month, year };
      reload();
    };
    const shiftYear = (delta) => {
      this._opsExpCursor = { ...this._opsExpCursor, year: this._opsExpCursor.year + delta };
      reload();
    };

    panel.querySelector('#ops-exp-prev')?.addEventListener('click', () => shiftMonth(-1));
    panel.querySelector('#ops-exp-next')?.addEventListener('click', () => shiftMonth(1));
    panel.querySelector('#ops-exp-prev-year')?.addEventListener('click', () => shiftYear(-1));
    panel.querySelector('#ops-exp-next-year')?.addEventListener('click', () => shiftYear(1));

    await reload();

    // ── FIX: remover listener anterior antes de agregar el nuevo ──
    // Evita acumulación de listeners al cambiar de tab o recargar.
    if (this._expenseChangedHandler) {
      document.removeEventListener('expense:changed', this._expenseChangedHandler);
    }
    this._expenseChangedHandler = reload;
    document.addEventListener('expense:changed', reload);
  }

  // Copia hacia el mes visible los gastos marcados como "recurrentes" (🔁)
  // del mes calendario inmediatamente anterior, si todavía no existen acá.
  // El usuario sólo tiene que ajustar monto/vencimiento; no vuelve a tipear la descripción.
  async _ensureRecurringExpenses(month, year, currentExps) {
    let prevMonth = month - 1, prevYear = year;
    if (prevMonth < 0) { prevMonth = 11; prevYear--; }
    const prevFirst = `${prevYear}-${String(prevMonth+1).padStart(2,'0')}-01`;
    const prevLast  = new Date(prevYear, prevMonth+1, 0).toISOString().slice(0,10);

    try {
      const { data: recurring } = await this.db.from('expenses').select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .eq('is_recurring', true)
        .gte('due_date', prevFirst)
        .lte('due_date', prevLast);

      if (!recurring?.length) return currentExps;

      const existingKey = (e) => `${e.category}::${e.description}`.toLowerCase();
      const already = new Set(currentExps.map(existingKey));
      const toInsert = recurring
        .filter(e => !already.has(existingKey(e)))
        .map(e => {
          const day = Math.min(new Date(e.due_date).getUTCDate(), new Date(year, month+1, 0).getDate());
          const due = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          return {
            hotel_id: this.ctx.hotelId,
            category: e.category,
            description: e.description,
            amount: null,
            due_date: due,
            paid: false,
            is_recurring: true,
          };
        });

      if (!toInsert.length) return currentExps;

      const { data: inserted, error } = await this.db.from('expenses').insert(toInsert).select('*');
      if (error) { console.warn('[Operations] recurring carry-forward:', error); return currentExps; }
      return [...currentExps, ...(inserted ?? [])]
        .sort((a, b) => a.description.localeCompare(b.description, 'es', { sensitivity: 'base' }));
    } catch (err) {
      console.warn('[Operations] recurring carry-forward failed:', err);
      return currentExps;
    }
  }

  _renderExpensesInOps(panel, expenses) {
    const summary = panel.querySelector('#ops-expenses-summary');
    const list    = panel.querySelector('#ops-expenses-list');
    if (!list) return;

    const total   = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
    const paid    = expenses.filter(e => e.paid).reduce((s, e) => s + (e.amount ?? 0), 0);
    const pending = total - paid;

    if (summary) {
      summary.innerHTML = `
        <div class="ops-exp-summary">
          <div class="ops-exp-kpi"><label>Total</label><strong>${formatARS(total)}</strong></div>
          <div class="ops-exp-kpi" style="color:#16a34a"><label>Pagados</label><strong>${formatARS(paid)}</strong></div>
          <div class="ops-exp-kpi" style="color:#f59e0b"><label>Pendientes</label><strong>${formatARS(pending)}</strong></div>
        </div>`;
    }

    if (!expenses.length) {
      list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">💰</span><p>Sin gastos en este período.</p></div>`;
      return;
    }

    list.innerHTML = expenses.map(e => `
      <div class="expense-row ${e.paid ? 'paid' : ''} ${e.amount == null ? 'needs-amount' : ''}" id="ops-exp-${e.id}">
        <div class="expense-category-dot" style="background:${categoryColor(e.category)}"></div>
        <div class="expense-info">
          <span class="expense-desc">${e.description}</span>
          <span class="expense-meta">· ${e.category}${e.due_date ? ` · Vence: ${e.due_date}` : ''}${e.paid && e.paid_at ? ` · Pagado: ${e.paid_at.slice(0,10)}` : ''}</span>
        </div>
        <strong class="expense-amount" style="color:${e.paid ? 'var(--color-success)' : 'var(--color-text)'}">${e.amount == null ? '<span class="badge-no-amount">Sin cargar</span>' : formatARS(e.amount)}</strong>
        <button type="button" class="expense-paid-pill ${e.paid ? 'is-paid' : ''}" data-exp-id="${e.id}" title="${e.paid ? 'Marcar pendiente' : 'Marcar pagado'}">
          ${e.paid ? '✓ Pagado' : 'Pendiente'}
        </button>
        <div class="expense-actions">
          <button class="expense-action-btn ops-exp-recurring ${e.is_recurring ? 'active' : ''}" data-exp-id="${e.id}" data-recurring="${e.is_recurring ? '1' : '0'}" title="${e.is_recurring ? 'Repetición mensual activada (se va a cargar solo el mes que viene)' : 'Repetir todos los meses'}">🔁</button>
          <button class="expense-action-btn ops-exp-edit" data-exp-id="${e.id}" title="Editar">✏️</button>
          <button class="expense-action-btn ops-exp-del" data-exp-id="${e.id}" title="Eliminar">🗑️</button>
        </div>
      </div>
    `).join('');

    // Bind actions
    list.querySelectorAll('.expense-paid-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        const id   = pill.dataset.expId;
        const paid = !pill.classList.contains('is-paid');
        pill.disabled = true;
        const { error } = await this.db.from('expenses')
          .update({ paid, paid_at: paid ? new Date().toISOString() : null }).eq('id', id);
        pill.disabled = false;
        if (error) { showToast('Error', 'error'); return; }
        pill.classList.toggle('is-paid', paid);
        pill.textContent = paid ? '✓ Pagado' : 'Pendiente';
        pill.title = paid ? 'Marcar pendiente' : 'Marcar pagado';
        document.getElementById(`ops-exp-${id}`)?.classList.toggle('paid', paid);
        showToast(paid ? 'Marcado como pagado ✓' : 'Marcado como pendiente', 'success');
      });
    });
    list.querySelectorAll('.ops-exp-recurring').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.expId;
        const next = btn.dataset.recurring !== '1';
        const { error } = await this.db.from('expenses').update({ is_recurring: next }).eq('id', id);
        if (error) { showToast('Error', 'error'); return; }
        btn.dataset.recurring = next ? '1' : '0';
        btn.classList.toggle('active', next);
        btn.title = next ? 'Repetición mensual activada (se va a cargar solo el mes que viene)' : 'Repetir todos los meses';
        showToast(next ? 'Se va a repetir todos los meses 🔁' : 'Repetición mensual desactivada', 'success');
      });
    });
    list.querySelectorAll('.ops-exp-edit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.expId;
        const { data: e } = await this.db.from('expenses').select('*').eq('id', id).single();
        if (!e) return;
        // Pasar _reload para refrescar la lista al guardar
        const _reload = async () => {
          const panel = document.getElementById('ops-panel');
          const hdr   = document.getElementById('ops-header-actions');
          if (panel && hdr) await this._loadExpenses(panel, hdr);
        };
        this._openExpenseModal(e, _reload);
      });
    });
    list.querySelectorAll('.ops-exp-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este gasto?')) return;
        const id = btn.dataset.expId;
        await this.db.from('expenses').delete().eq('id', id);
        document.getElementById(`ops-exp-${id}`)?.remove();
        showToast('Gasto eliminado', 'success');
      });
    });
  }

  // ══════════════════════════════════════════════════
  // MODAL DE GASTO (auto-contenido, no depende de HTML estático)
  // ══════════════════════════════════════════════════
  _openExpenseModal(expense = null, onSaved = null) {
    const existing = document.getElementById('overlay-ops-expense');
    if (existing) existing.remove();

    const isEdit = !!expense;
    const CATEGORIES = EXPENSE_CATEGORIES;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-ops-expense';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">${isEdit ? 'Editar Gasto' : 'Nuevo Gasto'}</h3>
          <button class="modal-close" id="oe-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid-2">
            <div class="form-group">
              <label>Categoría</label>
              <select id="oe-category" class="filter-select">
                ${CATEGORIES.map(c => `<option value="${c}" ${expense?.category === c ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Fecha de vencimiento</label>
              <input type="date" id="oe-due" value="${expense?.due_date ?? ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Descripción <span class="req">*</span></label>
            <input type="text" id="oe-desc" placeholder="Ej: Factura de gas" value="${expense?.description ?? ''}">
          </div>
          <div class="form-group">
            <label>Monto (ARS) <span class="req">*</span></label>
            <input type="number" id="oe-amount" min="0" step="0.01" placeholder="0.00" value="${expense?.amount ?? ''}">
          </div>
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="oe-paid" ${expense?.paid ? 'checked' : ''}
                     style="width:16px;height:16px;accent-color:var(--color-primary)">
              Marcar como pagado
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="oe-cancel">Cancelar</button>
          <button class="btn btn-primary" id="oe-save">${isEdit ? 'Guardar cambios' : 'Registrar gasto'}</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.style.zIndex = '210';

    const close = () => {
      modal.remove();
      if (escHandler) document.removeEventListener('keydown', escHandler);
    };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
    modal.querySelector('#oe-close').onclick  = close;
    modal.querySelector('#oe-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    setTimeout(() => modal.querySelector('#oe-desc')?.focus(), 80);

    modal.querySelector('#oe-save').addEventListener('click', async () => {
      const desc   = modal.querySelector('#oe-desc').value.trim();
      const amount = parseFloat(modal.querySelector('#oe-amount').value);
      if (!desc || isNaN(amount) || amount < 0) {
        showToast('Descripción y monto son requeridos', 'warning');
        return;
      }
      const saveBtn = modal.querySelector('#oe-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';

      const payload = {
        hotel_id:    this.ctx.hotelId,
        category:    modal.querySelector('#oe-category').value,
        description: desc,
        amount,
        due_date:    modal.querySelector('#oe-due').value || null,
        paid:        modal.querySelector('#oe-paid').checked,
        paid_at:     modal.querySelector('#oe-paid').checked ? new Date().toISOString() : null,
      };

      try {
        let error;
        if (isEdit) {
          ({ error } = await this._withTimeout(this.db.from('expenses').update(payload).eq('id', expense.id), 'Actualizar gasto'));
        } else {
          ({ error } = await this._withTimeout(this.db.from('expenses').insert(payload), 'Crear gasto'));
        }
        if (error) throw error;
        showToast(isEdit ? 'Gasto actualizado ✓' : 'Gasto registrado ✓', 'success');
        close();
        // Notificar a cualquier listener de expense:changed
        document.dispatchEvent(new CustomEvent('expense:changed'));
        if (onSaved) await onSaved();
      } catch (err) {
        console.error('[Operations] expense save:', err);
        showToast('Error: ' + (err?.message ?? err), 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Guardar cambios' : 'Registrar gasto';
      }
    });
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
