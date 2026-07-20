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

const EXPENSE_METHOD_LABELS = {
  efectivo:      '💵 Efectivo',
  debito:        '💳 Débito',
  transferencia: '🏦 Transf.',
  qr:            '📱 QR',
  cuenta:        '🏛️ Cta.',
};
function _expenseMethodLabel(m) {
  return EXPENSE_METHOD_LABELS[m] ?? m;
}

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

    // Si el shell ya está renderizado (el usuario ya navegó a Operaciones antes),
    // solo refrescar el tab activo sin resetear — evita volver a "Recordatorios"
    // después de cada acción (booking:changed / debouncedCalendarLoad lo llama).
    if (container.querySelector('.ops-tabs')) {
      const panel  = container.querySelector('#ops-panel');
      const header = container.querySelector('#ops-header-actions');
      if (panel && header) {
        await this._loadTab(this._tab, container);
        return;
      }
    }

    container.innerHTML = this._renderShell();
    this._bindTabs(container);
    await this._loadTab('reminders', container);
  }

  _renderShell() {
    return `
      <div class="tabs-bar ops-tabs">
        <button class="tab active" data-ops-tab="reminders">🔔 Recordatorios<span class="ops-tab-badge" id="badge-reminders" style="display:none;margin-left:5px;font-size:.6rem;padding:1px 5px;border-radius:8px;background:#ef4444;color:#fff;font-weight:700;vertical-align:middle"></span></button>
        <button class="tab" data-ops-tab="cleaning">🧹 Limpieza<span class="ops-tab-badge" id="badge-cleaning" style="display:none;margin-left:5px;font-size:.6rem;padding:1px 5px;border-radius:8px;background:#f59e0b;color:#fff;font-weight:700;vertical-align:middle"></span></button>
        <button class="tab" data-ops-tab="maintenance">🔧 Mantenimiento<span class="ops-tab-badge" id="badge-maintenance" style="display:none;margin-left:5px;font-size:.6rem;padding:1px 5px;border-radius:8px;background:#ef4444;color:#fff;font-weight:700;vertical-align:middle"></span></button>
        <button class="tab" data-ops-tab="expenses">💰 Gastos</button>
        <button class="tab" data-ops-tab="tenencias">💼 Tenencias</button>
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

  _setTabBadge(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.style.display = 'inline'; }
    else           { el.style.display = 'none'; }
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
    if (tab === 'tenencias')    await this._loadTenencias(panel, header);
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
      window.populateReminderUnitSelect?.();
      overlay?.classList.remove('hidden');
    });

    const { data: reminders, error } = await this.db
      .from('reminders')
      .select('*')
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
      // Nota (📌): es información para tener en cuenta, no una tarea — sin
      // checkbox de completado y sin el semáforo de urgencia rojo/amarillo,
      // porque una nota no "se atrasa" como sí lo hace una tarea operativa.
      if (r.is_note) {
        return `<div class="reminder-card" data-id="${r.id}">
          <div class="reminder-dot" style="background:transparent;display:flex;align-items:center;justify-content:center;font-size:.85rem">${r.icon || '📌'}</div>
          <div class="reminder-body">
            <div class="reminder-title">${r.title}</div>
            <div class="reminder-meta">
              📅 ${fmtD(r.scheduled_date)}${window.reminderUnitsLabel(r.unit_ids)}
              ${r.description ? ` · ${r.description}` : ''}
            </div>
          </div>
          <div class="reminder-actions">
            <button class="btn btn-ghost btn-xs reminder-edit-btn"
              data-id="${r.id}" data-title="${r.title.replace(/"/g,'&quot;')}"
              data-date="${r.scheduled_date}" data-desc="${(r.description??'').replace(/"/g,'&quot;')}"
              data-units="${(r.unit_ids ?? []).join(',')}" data-is-note="1" data-icon="${r.icon ?? '📌'}" title="Editar" aria-label="Editar">✏️</button>
            <button class="btn btn-ghost btn-xs reminder-del-ops-btn" data-id="${r.id}" title="Eliminar" aria-label="Eliminar">🗑️</button>
          </div>
        </div>`;
      }
      return `<div class="reminder-card ${r.completed?'reminder-done':''} ${isPast?'reminder-overdue':''}" data-id="${r.id}">
        <div class="reminder-dot" style="background:${dotColor}"></div>
        <div class="reminder-body">
          <div class="reminder-title ${r.completed?'line-through':''}">${r.title}</div>
          <div class="reminder-meta">
            📅 ${fmtD(r.scheduled_date)}${window.reminderUnitsLabel(r.unit_ids)}
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
            data-units="${(r.unit_ids ?? []).join(',')}" data-is-note="0" title="Editar" aria-label="Editar">✏️</button>
          <button class="btn btn-ghost btn-xs reminder-del-ops-btn" data-id="${r.id}" title="Eliminar" aria-label="Eliminar">🗑️</button>
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

          const noteEl  = document.getElementById('r-is-note');
          if (titleEl) titleEl.value = editBtn.dataset.title;
          if (dateEl)  dateEl.value  = editBtn.dataset.date;
          if (descEl)  descEl.value  = editBtn.dataset.desc;
          if (noteEl)  noteEl.checked = editBtn.dataset.isNote === '1';
          window.setReminderIcon?.(editBtn.dataset.icon || '📌');
          document.getElementById('r-icon-container')?.classList.toggle('hidden', editBtn.dataset.isNote !== '1');
          window.populateReminderUnitSelect?.();
          setTimeout(() => window.setReminderCheckedUnitIds?.((editBtn.dataset.units ?? '').split(',').filter(Boolean)), 60);
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
              .update({ title, description: descEl?.value.trim()||null, scheduled_date: date, unit_ids: window.getReminderCheckedUnitIds?.() ?? [], is_note: noteEl?.checked||false, icon: document.getElementById('r-icon-value')?.value || null })
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

    // Update badge — las notas (📌) no cuentan como pendientes, no son tareas
    const pending = reminders.filter(r => !r.is_note && !r.completed && r.scheduled_date <= today).length;
    document.dispatchEvent(new CustomEvent('reminders:badge', { detail: { count: pending } }));
    this._setTabBadge('badge-reminders', pending);
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

      // NUEVO (aditivo): re-ordenar en memoria por urgencia operativa —
      // 1° check-outs de HOY pendientes, 2° atrasadas de días anteriores,
      // 3° pendientes futuras, 4° completadas al final. Dentro de cada
      // grupo, por fecha. No cambia la query ni los datos, solo el orden.
      const _prio = (t) => {
        const isDone = t.status === 'completed';
        if (isDone) return 4;
        if (t.scheduled_date === today) return 1;
        if (t.scheduled_date <  today)  return 2;
        return 3;
      };
      data.sort((a, b) => (_prio(a) - _prio(b)) || String(a.scheduled_date ?? '').localeCompare(String(b.scheduled_date ?? '')));

      const pending  = data.filter(t => t.status === 'pending'   && t.scheduled_date === today).length;
      const done     = data.filter(t => t.status === 'completed' && t.scheduled_date === today).length;
      const overdue  = data.filter(t => t.status !== 'completed' && t.scheduled_date < today).length;
      this._setTabBadge('badge-cleaning', pending + overdue);

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

      this._lastCleaningData = data;

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
              document.dispatchEvent(new CustomEvent('booking:changed')); // refresca campana de notificaciones
            } catch (err) {
              showToast('Error: ' + (err?.message ?? err), 'error');
              btn.disabled = false; btn.textContent = newStatus === 'in_progress' ? 'Iniciar' : '✓ Listo';
            }
          }

          if (btn.classList.contains('cleaning-edit-btn') && !btn.disabled) {
            const task = (this._lastCleaningData ?? []).find(t => String(t.id) === String(btn.dataset.id));
            if (task) this._openCleaningModal(task);
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
          <button class="btn btn-ghost btn-xs cleaning-edit-btn"
                  data-id="${task.id}" title="Editar" aria-label="Editar">✏️</button>
          <button class="btn btn-ghost btn-xs cleaning-delete-btn"
                  data-id="${task.id}" title="Eliminar" aria-label="Eliminar">🗑️</button>
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
  _openCleaningModal(task = null) {
    const units = this.ctx.units ?? [];
    const today = toISODate(new Date());
    const isEdit = !!task;

    // Modal inline simple
    const existing = document.getElementById('overlay-cleaning-task');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-cleaning-task';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">${isEdit ? 'Editar Tarea de Limpieza' : 'Nueva Tarea de Limpieza'}</h3>
          <button class="modal-close" id="cleaning-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Unidad</label>
            <select id="ct-unit" class="filter-select">
              <option value="">General</option>
              ${units.map(u => `<option value="${u.id}" ${task?.unit_id === u.id ? 'selected' : ''}>#${u.sort_order} · ${u.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Título <span class="req">*</span></label>
            <input type="text" id="ct-title" placeholder="Limpieza profunda, cambio de sábanas..." value="${task?.title ? task.title.replace(/"/g,'&quot;') : ''}">
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label>Fecha <span class="req">*</span></label>
              <input type="date" id="ct-date" value="${task?.scheduled_date ?? today}">
            </div>
            <div class="form-group">
              <label>Responsable</label>
              <input type="text" id="ct-assigned" placeholder="Nombre" value="${task?.assigned_to ? task.assigned_to.replace(/"/g,'&quot;') : ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Observaciones</label>
            <textarea id="ct-notes" rows="2">${task?.notes ?? ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="ct-cancel">Cancelar</button>
          <button class="btn btn-primary" id="ct-save">${isEdit ? 'Guardar cambios' : 'Guardar'}</button>
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
        const payload = {
          unit_id:      modal.querySelector('#ct-unit').value || null,
          title, scheduled_date: date,
          assigned_to:  modal.querySelector('#ct-assigned').value.trim() || null,
          notes:        modal.querySelector('#ct-notes').value.trim() || null,
        };
        const { error } = isEdit
          ? await this._withTimeout(this.db.from('cleaning_tasks').update(payload).eq('id', task.id), 'Editar tarea de limpieza')
          : await this._withTimeout(this.db.from('cleaning_tasks').insert({ ...payload, hotel_id: this.ctx.hotelId, status: 'pending' }), 'Crear tarea de limpieza');
        if (error) throw error;
        showToast(isEdit ? 'Tarea actualizada ✓' : 'Tarea de limpieza creada ✓', 'success');
        close();
        const panel = document.getElementById('ops-panel');
        const hdrEl = document.getElementById('ops-header-actions');
        if (panel && hdrEl) await this._loadCleaning(panel, hdrEl);
        if (typeof updateOperationsBadge === 'function') updateOperationsBadge();
      } catch (err) {
        console.error('[Operations] cleaning save:', err);
        showToast('Error: ' + (err?.message ?? 'Verificá que hayas corrido migration_complete_v8.sql en Supabase'), 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Guardar cambios' : 'Guardar'; }
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
      this._setTabBadge('badge-maintenance', open);

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
            document.dispatchEvent(new CustomEvent('booking:changed')); // refresca campana de notificaciones
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
                  data-booking-id="${block.id}" title="Eliminar bloqueo" aria-label="Eliminar bloqueo">🗑️</button>
        </div>
      </div>`;
  }

  _maintenanceRowHTML(issue) {
    const pr       = PRIORITY_CONFIG[issue.priority ?? 'medium'];
    const unitName = issue.unit_name ?? issue.units?.name ??
                     this.ctx.units?.find(u => String(u.id) === String(issue.unit_id))?.name ??
                     'General';
    const isOpen   = issue.status !== 'resolved';

    // Borde izquierdo y fondo tenue según prioridad (solo para issues abiertos)
    const priorityStyle = isOpen
      ? `border-left:3px solid ${pr.color};background:${pr.bg}08`
      : 'border-left:3px solid var(--color-border);opacity:.6';

    return `
      <div class="ops-row ${!isOpen ? 'ops-done' : ''}" data-id="${issue.id}"
           style="${priorityStyle}">
        <div class="ops-row-left">
          <div class="ops-row-info">
            <div class="ops-row-title">
              <span class="ops-unit-badge" style="margin-right:6px">${unitName}</span>
              ${issue.category ?? 'General'} — ${issue.title ?? issue.description ?? ''}
            </div>
            <div class="ops-row-meta">
              <span class="ops-badge" style="background:${pr.bg};color:${pr.color};font-weight:700">${pr.label}</span>
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
          <button class="btn btn-ghost btn-xs maint-edit-btn" data-id="${issue.id}" title="Editar" aria-label="Editar" style="font-size:.85rem;">✏️</button>
          <button class="btn btn-ghost btn-xs maint-delete-btn" data-id="${issue.id}" title="Eliminar" aria-label="Eliminar">🗑️</button>
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
  // ── Saldo en cuenta (carga manual) ──────────────────
  // No calcula nada (no cruza ingresos con gastos) — es solo un número
  // que vos actualizás a mano cuando quieras, para tener a la vista
  // "cuánta plata hay hoy en la cuenta del complejo" sin salir de la app.
  // Se guarda en hotel_config, mismo esquema clave/valor de siempre.
  async _renderBalanceBox(panel) {
    const box = panel.querySelector('#ops-balance-box');
    if (!box) return;

    const { data } = await this.db.from('hotel_config')
      .select('value, updated_at').eq('hotel_id', this.ctx.hotelId).eq('key', 'account_balance').maybeSingle();
    const balance = parseFloat(data?.value ?? 0) || 0;
    const updatedAt = data?.updated_at
      ? new Date(data.updated_at).toLocaleDateString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : null;

    box.innerHTML = `
      <div class="card" style="margin-bottom:16px;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="font-size:.7rem;color:var(--color-text-3);font-weight:600;text-transform:uppercase;letter-spacing:.04em">💰 Saldo en cuenta</div>
          <div id="ops-balance-display" style="font-size:1.6rem;font-weight:800;color:var(--color-text);margin-top:2px">${formatARS(balance)}</div>
          ${updatedAt ? `<div style="font-size:.68rem;color:var(--color-text-3);margin-top:2px">Actualizado: ${updatedAt}</div>` : `<div style="font-size:.68rem;color:var(--color-text-3);margin-top:2px">Todavía no lo cargaste</div>`}
        </div>
        <div id="ops-balance-edit-area">
          <button class="btn btn-outline btn-sm" id="ops-balance-edit-btn">✏️ Actualizar saldo</button>
        </div>
      </div>`;

    box.querySelector('#ops-balance-edit-btn')?.addEventListener('click', () => {
      const editArea = box.querySelector('#ops-balance-edit-area');
      editArea.innerHTML = `
        <div style="display:flex;gap:6px;align-items:center">
          <input type="number" id="ops-balance-input" value="${balance}" step="1000"
            style="width:150px;padding:8px 10px;border:1px solid var(--color-border);border-radius:var(--r-sm);background:var(--color-surface);color:var(--color-text);font-size:.9rem">
          <button class="btn btn-primary btn-sm" id="ops-balance-save">Guardar</button>
          <button class="btn btn-ghost btn-sm" id="ops-balance-cancel">Cancelar</button>
        </div>`;
      document.getElementById('ops-balance-input')?.focus();
      document.getElementById('ops-balance-input')?.select();

      editArea.querySelector('#ops-balance-cancel')?.addEventListener('click', () => this._renderBalanceBox(panel));
      editArea.querySelector('#ops-balance-save')?.addEventListener('click', async () => {
        const newVal = parseFloat(document.getElementById('ops-balance-input')?.value) || 0;
        const saveBtn = document.getElementById('ops-balance-save');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }
        const { error } = await this.db.from('hotel_config')
          .upsert({ hotel_id: this.ctx.hotelId, key: 'account_balance', value: String(newVal), updated_at: new Date().toISOString() }, { onConflict: 'hotel_id,key' });
        if (error) { showToast('Error al guardar: ' + error.message, 'error'); return; }
        showToast('✓ Saldo actualizado', 'success');
        await logAction('UPDATE', 'hotel_config', null, `Saldo en cuenta actualizado a ${formatARS(newVal)}`);
        await this._renderBalanceBox(panel);
      });
    });
  }

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
      <div id="ops-balance-box"></div>
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
        <button type="button" class="btn btn-outline btn-sm" id="ops-exp-export" style="margin-left:auto;gap:5px">📤 Exportar rango…</button>
      </div>
      <div id="ops-expenses-summary"></div>
      <div id="ops-expenses-list"><div class="loading-state">Cargando...</div></div>
    `;

    this._renderBalanceBox(panel);

    panel.querySelector('#ops-exp-export')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const { data: allExpenses } = await this.db.from('expenses').select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .order('due_date', { ascending: false });
      const { showExportDropdown, exportExpensesCSV, exportExpensesExcel } = await import('../services/export-service.js');
      showExportDropdown({
        anchorEl: btn,
        type: 'expenses',
        data: allExpenses ?? [],
        onExport: ({ fmt, data, from, to }) => {
          const range = from && to ? `${from}_a_${to}` : '';
          if (fmt === 'excel') exportExpensesExcel(data, 'gastos', range);
          else exportExpensesCSV(data, 'gastos', range);
        },
      });
    });

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

    // ── NUEVO (aditivo): chips de filtro rápido por categoría ──────────────
    // Guarda la lista completa, renderiza los chips con conteo, y si hay un
    // filtro activo pasa la lista filtrada al resto del método (que queda
    // intacto). Al no haber filtro, todo funciona exactamente igual que antes.
    try {
      this._opsExpAll = expenses;
      let chipsBar = panel.querySelector('#ops-exp-cat-chips');
      if (!chipsBar) {
        chipsBar = document.createElement('div');
        chipsBar.id = 'ops-exp-cat-chips';
        chipsBar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
        list.insertAdjacentElement('beforebegin', chipsBar);
      }
      const catCounts = {};
      expenses.forEach(e => {
        const c = (e.category ?? 'otros').toLowerCase();
        catCounts[c] = (catCounts[c] ?? 0) + 1;
      });
      const activeCat = this._opsExpCatFilter ?? '';
      const chip = (val, label, count) => {
        const on = activeCat === val;
        return '<button type="button" class="ops-exp-cat-chip" data-cat="'+val+'" '
          + 'style="font-size:.7rem;font-weight:600;padding:3px 10px;border-radius:999px;cursor:pointer;'
          + 'border:1px solid '+(on ? 'var(--color-primary)' : 'var(--color-border)')+';'
          + 'background:'+(on ? 'var(--color-primary)' : 'var(--color-surface-2)')+';'
          + 'color:'+(on ? '#fff' : 'var(--color-text-2)')+'">'
          + label + (count != null ? ' <span style="opacity:.7">('+count+')</span>' : '') + '</button>';
      };
      chipsBar.innerHTML = chip('', 'Todos', expenses.length)
        + Object.keys(catCounts).sort()
            .map(c => chip(c, c.charAt(0).toUpperCase()+c.slice(1), catCounts[c])).join('');
      chipsBar.querySelectorAll('.ops-exp-cat-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          this._opsExpCatFilter = btn.dataset.cat || '';
          this._renderExpensesInOps(panel, this._opsExpAll);
        });
      });
      if (activeCat) expenses = expenses.filter(e => (e.category ?? 'otros').toLowerCase() === activeCat);
    } catch (e2) { console.warn('[Operations] cat chips:', e2); }
    // ── fin chips ──────────────────────────────────────────────────────────

    const total   = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
    const paid    = expenses.filter(e => e.paid).reduce((s, e) => s + (e.amount ?? 0), 0);
    const pending = total - paid;

    if (summary) {
      // ── Totales por destinatario ───────────────────────────────
      const byBenef = {};
      expenses.forEach(e => {
        const key = e.beneficiary?.trim() || '(sin destinatario)';
        byBenef[key] = (byBenef[key] ?? 0) + (e.amount ?? 0);
      });
      const benefEntries = Object.entries(byBenef)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

      const benefHTML = benefEntries.length > 1
        ? `<details class="ops-benef-details" style="margin-top:12px;border-top:1px solid var(--color-border);padding-top:10px">
            <summary style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3);cursor:pointer;user-select:none">
              👤 Por destinatario
            </summary>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
              ${benefEntries.map(([name, amt]) => `
                <div style="display:flex;justify-content:space-between;font-size:.78rem;padding:3px 0">
                  <span style="color:var(--color-text-2)">${name}</span>
                  <strong style="color:var(--color-text)">${formatARS(amt)}</strong>
                </div>`).join('')}
            </div>
          </details>`
        : '';

      summary.innerHTML = `
        <div class="ops-exp-summary">
          <div class="ops-exp-kpi"><label>Total</label><strong>${formatARS(total)}</strong></div>
          <div class="ops-exp-kpi" style="color:#16a34a"><label>Pagados</label><strong>${formatARS(paid)}</strong></div>
          <div class="ops-exp-kpi" style="color:#f59e0b"><label>Pendientes</label><strong>${formatARS(pending)}</strong></div>
        </div>${benefHTML}`;
    }

    if (!expenses.length) {
      list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">💰</span><p>Sin gastos en este período.</p></div>`;
      return;
    }

    list.innerHTML = expenses.map(e => `
      <div class="expense-row ${e.paid ? 'paid' : ''} ${e.amount == null ? 'needs-amount' : ''}" id="ops-exp-${e.id}">
        <div class="expense-category-dot" style="background:${categoryColor(e.category)}"></div>
        <div class="expense-info">
          <span class="expense-desc">${e.description}${e.beneficiary ? ` <span style="font-size:.7rem;color:var(--color-text-3);font-weight:600">→ ${e.beneficiary}</span>` : ''}</span>
          <span class="expense-meta">· ${e.category}${e.payment_method ? ` · ${_expenseMethodLabel(e.payment_method)}` : ''}${e.due_date ? ` · Vence: ${e.due_date}` : ''}${e.paid && e.paid_at ? ` · Pagado: ${e.paid_at.slice(0,10)}` : ''}</span>
        </div>
        <strong class="expense-amount" style="color:${e.paid ? 'var(--color-success)' : 'var(--color-text)'}">${e.amount == null ? '<span class="badge-no-amount">Sin cargar</span>' : formatARS(e.amount)}</strong>
        <button type="button" class="expense-paid-pill ${e.paid ? 'is-paid' : ''}" data-exp-id="${e.id}" title="${e.paid ? 'Marcar pendiente' : 'Marcar pagado'}">
          ${e.paid ? '✓ Pagado' : 'Pendiente'}
        </button>
        <div class="expense-actions">
          <button class="expense-action-btn ops-exp-recurring ${e.is_recurring ? 'active' : ''}" data-exp-id="${e.id}" data-recurring="${e.is_recurring ? '1' : '0'}" title="${e.is_recurring ? 'Repetición mensual activada (se va a cargar solo el mes que viene)' : 'Repetir todos los meses'}">🔁</button>
          <button class="expense-action-btn ops-exp-edit" data-exp-id="${e.id}" title="Editar" aria-label="Editar">✏️</button>
          <button class="expense-action-btn ops-exp-del" data-exp-id="${e.id}" title="Eliminar" aria-label="Eliminar">🗑️</button>
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
          <div class="form-group" style="position:relative">
            <label>Descripción <span class="req">*</span></label>
            <input type="text" id="oe-desc" placeholder="Ej: Factura de gas" value="${expense?.description ?? ''}" autocomplete="off">
            <div id="oe-desc-suggestions" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:300;
                 background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;
                 box-shadow:0 4px 16px rgba(0,0,0,.12);max-height:180px;overflow-y:auto;margin-top:2px"></div>
          </div>
          <div class="form-group">
            <label>Monto (ARS) <span class="req">*</span></label>
            <input type="number" id="oe-amount" min="0" step="0.01" placeholder="0.00" value="${expense?.amount ?? ''}">
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label>Forma de pago</label>
              <select id="oe-payment-method" class="filter-select">
                <option value="">— Sin especificar —</option>
                <option value="efectivo"      ${expense?.payment_method === 'efectivo'      ? 'selected' : ''}>💵 Efectivo</option>
                <option value="debito"        ${expense?.payment_method === 'debito'        ? 'selected' : ''}>💳 Débito</option>
                <option value="transferencia" ${expense?.payment_method === 'transferencia' ? 'selected' : ''}>🏦 Transferencia</option>
                <option value="qr"            ${expense?.payment_method === 'qr'            ? 'selected' : ''}>📱 QR</option>
                <option value="cuenta"        ${expense?.payment_method === 'cuenta'        ? 'selected' : ''}>🏛️ Dinero a cuenta</option>
              </select>
            </div>
            <div class="form-group">
              <label>Destinatario</label>
              <input type="text" id="oe-beneficiary" list="oe-beneficiary-list"
                     placeholder="Ej: Alicia, Municipalidad…"
                     value="${expense?.beneficiary ?? ''}">
              <datalist id="oe-beneficiary-list">
                <option value="Alicia">
                <option value="Turismo Entre Ríos">
                <option value="Municipal">
                <option value="AFIP">
                <option value="ARBA">
                <option value="Gas">
                <option value="Luz">
                <option value="Agua">
              </datalist>
            </div>
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

    // ── Autocomplete de descripción basado en historial de gastos ─────────
    const descInput = modal.querySelector('#oe-desc');
    const suggBox   = modal.querySelector('#oe-desc-suggestions');
    let _suggTimer  = null;
    descInput?.addEventListener('input', () => {
      clearTimeout(_suggTimer);
      const val = descInput.value.trim();
      if (val.length < 5) { suggBox.style.display = 'none'; return; }
      _suggTimer = setTimeout(async () => {
        try {
          const { data } = await this.db.from('expenses')
            .select('description')
            .eq('hotel_id', this.ctx.hotelId)
            .ilike('description', '%' + val + '%')
            .limit(30);
          if (!data?.length) { suggBox.style.display = 'none'; return; }
          // Dedup + excluir el valor exacto actual
          const uniq = [...new Set(data.map(r => r.description))]
            .filter(d => d && d.toLowerCase() !== val.toLowerCase())
            .slice(0, 6);
          if (!uniq.length) { suggBox.style.display = 'none'; return; }
          suggBox.innerHTML = uniq.map(d =>
            '<div style="padding:8px 12px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--color-border);' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis" data-val="' + d.replace(/"/g,'&quot;') + '">' +
            d.replace(new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'), m => '<strong>' + m + '</strong>') +
            '</div>'
          ).join('');
          suggBox.style.display = 'block';
          suggBox.querySelectorAll('[data-val]').forEach(item => {
            item.addEventListener('mousedown', e => {
              e.preventDefault();
              descInput.value = item.dataset.val;
              suggBox.style.display = 'none';
            });
            item.addEventListener('mouseover', () => item.style.background = 'var(--color-surface-2)');
            item.addEventListener('mouseout',  () => item.style.background = '');
          });
        } catch { suggBox.style.display = 'none'; }
      }, 300);
    });
    descInput?.addEventListener('blur', () => { setTimeout(() => { suggBox.style.display = 'none'; }, 150); });
    // ─────────────────────────────────────────────────────────────────────────

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
        hotel_id:       this.ctx.hotelId,
        category:       modal.querySelector('#oe-category').value,
        description:    desc,
        amount,
        due_date:       modal.querySelector('#oe-due').value || null,
        paid:           modal.querySelector('#oe-paid').checked,
        paid_at:        modal.querySelector('#oe-paid').checked ? new Date().toISOString() : null,
        payment_method: modal.querySelector('#oe-payment-method').value || null,
        beneficiary:    modal.querySelector('#oe-beneficiary').value.trim() || null,
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

// ─────────────────────────────────────────────────────────────────────────────
// TENENCIAS
// Dos tipos de posiciones:
//  · Con rendimiento  (frasco/fci/pf)  — tienen monto + intereses + fecha acreditación
//  · Saldos estáticos (usd/cuenta)     — solo monto, sin vencimiento ni intereses
// ─────────────────────────────────────────────────────────────────────────────

const TEN_CFG = {
  frasco:  { icon: '🫙', label: 'Naranja X',          color: '#f97316', prefix: '',       tipo: 'rendimiento' },
  fci:     { icon: '📈', label: 'FCI Cocos Capital',  color: '#3b82f6', prefix: '[FCI] ', tipo: 'rendimiento' },
  pf:      { icon: '🏦', label: 'PF Santander',       color: '#dc2626', prefix: '[PF] ',  tipo: 'rendimiento' },
  usd:     { icon: '💵', label: 'Dólares',             color: '#16a34a', prefix: '[USD] ', tipo: 'estatico'    },
  cuenta:  { icon: '🏛️', label: 'En cuenta',           color: '#64748b', prefix: '[CTA] ', tipo: 'estatico'    },
};

function tenCfgFromNotes(notes) {
  if (!notes || notes === '') return TEN_CFG.frasco;
  if (notes.startsWith('[FCI]'))  return TEN_CFG.fci;
  if (notes.startsWith('[PF]'))   return TEN_CFG.pf;
  if (notes.startsWith('[USD]'))  return TEN_CFG.usd;
  if (notes.startsWith('[CTA]'))  return TEN_CFG.cuenta;
  return TEN_CFG.frasco;
}

OperationsModule.prototype._loadTenencias = async function(panel, header) {
  const RATES_KEY = 'mila_tenencias_rates';
  const getRates  = () => { try { return JSON.parse(localStorage.getItem(RATES_KEY) ?? '{}'); } catch { return {}; } };
  const rates     = { tna_cocos: 19, tea_santander: 16, ...getRates() };
  const today     = new Date().toISOString().slice(0, 10);
  const fmt       = n => '$' + (n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  header.innerHTML = '<button class="btn btn-outline btn-sm" id="ten-config-btn">⚙️ Tasas</button>';

  const { data: all = [] } = await this.db.from('frasco_items')
    .select('id, original_amount, interest_amount, frasco_date, notes, credited, credited_at, credited_amount, created_at, booking_id')
    .eq('hotel_id', this.ctx.hotelId)
    .order('created_at', { ascending: false })
    .limit(300);

  const pending  = all.filter(i => !i.credited);
  const credited = all.filter(i =>  i.credited);

  // Separar por lógica
  const conRend = pending.filter(i => tenCfgFromNotes(i.notes).tipo === 'rendimiento');
  const estatic = pending.filter(i => tenCfgFromNotes(i.notes).tipo === 'estatico');

  // Totales resumen
  const totalRend   = conRend.reduce((s,i) => s + (i.original_amount??0), 0);
  const totalIntereses = conRend.reduce((s,i) => s + (i.interest_amount??0), 0);
  const totalEstat  = estatic.reduce((s,i) => s + (i.original_amount??0), 0);

  // Gastos pagados "en cuenta" → se deducen automáticamente del saldo CTA
  const { data: gastosCtaRaw = [] } = await this.db
    .from('expenses')
    .select('amount, description, date')
    .eq('hotel_id', this.ctx.hotelId)
    .eq('payment_method', 'cuenta')
    .order('date', { ascending: false })
    .limit(200);
  const gastosEnCuenta      = gastosCtaRaw ?? [];
  const totalGastosEnCuenta = gastosEnCuenta.reduce((s,g) => s + (g.amount??0), 0);
  const totalCtaBase        = estatic.filter(i => i.notes?.startsWith('[CTA]')).reduce((s,i) => s + (i.original_amount??0), 0);
  const saldoEnCuenta       = totalCtaBase - totalGastosEnCuenta;

  // ── Fila de inversión con rendimiento ────────────────────────────────────
  const rendRow = item => {
    const cfg   = tenCfgFromNotes(item.notes);
    const base  = item.original_amount ?? 0;
    const int   = item.interest_amount  ?? 0;
    const total = base + int;
    const desc  = (item.notes ?? '').replace(/^\[(FCI|PF|GASTOS)\] /, '').split(' · ')[0] || '—';
    const dias  = item.frasco_date
      ? Math.round((new Date(item.frasco_date+'T00:00:00') - new Date(today+'T00:00:00')) / 86400000)
      : null;
    const countdown = dias === null ? ''
      : dias < 0  ? '<span style="color:#dc2626;font-size:.68rem"> · ⚠️ vencido hace '+Math.abs(dias)+'d</span>'
      : dias === 0 ? '<span style="color:#f97316;font-size:.68rem;font-weight:700"> · ⚠️ hoy</span>'
      : '<span style="color:#94a3b8;font-size:.68rem"> · en '+dias+'d</span>';
    const vencido = dias !== null && dias < 0;
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;
                        margin-bottom:6px;background:${vencido?'#fef9c3':'var(--color-surface-2)'};
                        border:1px solid ${vencido?'#fde047':'var(--color-border)'}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          <span style="font-size:.62rem;font-weight:700;padding:1px 7px;border-radius:4px;
                       background:${cfg.color}22;color:${cfg.color}">${cfg.icon} ${cfg.label}</span>
          <span style="font-size:.8rem;font-weight:600;color:var(--color-text)">${desc}</span>
          ${item.booking_id ? '<span style="font-size:.62rem;padding:1px 7px;border-radius:4px;background:#6366f111;color:#6366f1;font-weight:600">🔗 con reserva</span>' : ''}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <span style="font-size:.72rem;color:var(--color-text-3)">Base: <strong>${fmt(base)}</strong></span>
          ${int>0?`<span style="font-size:.72rem;color:#16a34a">+${fmt(int)} intereses</span>`:''}
          <span style="font-size:.72rem;color:#ea580c;font-weight:700">= ${fmt(total)}</span>
          ${item.frasco_date?`<span style="font-size:.68rem;color:var(--color-text-3)">${item.frasco_date}${countdown}</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <button class="btn btn-primary btn-xs ten-credit-btn" data-id="${item.id}"
                style="background:#fb923c;border-color:#fb923c;font-size:.7rem">💸 Acreditar</button>
        <button class="btn btn-outline btn-xs ten-edit-btn" data-id="${item.id}" style="padding:3px 8px;font-size:.7rem">✏️</button>
        <button class="btn btn-ghost btn-xs ten-delete-btn" data-id="${item.id}" style="padding:3px 8px;color:#ef4444;font-size:.7rem">🗑️</button>
      </div>
    </div>`;
  };

  // ── Fila de saldo estático ────────────────────────────────────────────────
  const estatRow = item => {
    const cfg    = tenCfgFromNotes(item.notes);
    const isCTA  = item.notes?.startsWith('[CTA]');
    const base   = item.original_amount ?? 0;
    const desc2  = (item.notes ?? '').replace(/^\[(USD|CTA)\] /, '').split(' · ')[0] || '—';
    const saldo  = isCTA ? (base - totalGastosEnCuenta) : base;
    const hasDed = isCTA && totalGastosEnCuenta > 0;
    const deducHTML = hasDed
      ? '<div style="font-size:.68rem;color:var(--color-text-3);margin-top:4px">'
        + 'Ingresado: <strong>' + fmt(base) + '</strong>'
        + ' · <span style="color:#f59e0b">Gastos débito: −' + fmt(totalGastosEnCuenta) + '</span>'
        + gastosEnCuenta.slice(0,2).map(g => ' · ' + (g.date||'').slice(5) + ' ' + (g.description||'').slice(0,15) + ': −' + fmt(g.amount)).join('')
        + (gastosEnCuenta.length > 2 ? ' · y ' + (gastosEnCuenta.length-2) + ' más…' : '')
        + '</div>'
      : '';
    // override cfg fields for rendering
    const _cfg = cfg;
    const monto = item.original_amount ?? 0;
    const desc  = desc2;
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-radius:10px;
                        margin-bottom:6px;background:var(--color-surface-2);
                        border:1px solid var(--color-border);border-left:3px solid ${cfg.color}">
      <div style="width:36px;height:36px;border-radius:8px;background:${cfg.color}18;color:${cfg.color};
                  display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${cfg.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:.8rem;font-weight:600;color:var(--color-text)">${desc}</span>
            <span style="font-size:.6rem;padding:1px 6px;border-radius:4px;background:${cfg.color}18;color:${cfg.color};font-weight:700">${cfg.label}</span>
          </div>
          <span style="font-size:.9rem;font-weight:700;color:${saldo < 0 ? '#ef4444' : cfg.color}">${fmt(saldo)}</span>
        </div>
        ${deducHTML}
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <button class="btn btn-outline btn-xs ten-edit-btn" data-id="${item.id}" style="padding:3px 8px;font-size:.7rem">✏️</button>
        <button class="btn btn-ghost btn-xs ten-delete-btn" data-id="${item.id}" style="padding:3px 8px;color:#ef4444;font-size:.7rem">🗑️</button>
      </div>
    </div>`;
  };

  // ── Botones agregar ────────────────────────────────────────────────────────
  const addBtns = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
    ${Object.entries(TEN_CFG).map(([key, cfg]) =>
      `<button class="btn btn-outline btn-sm ten-add-btn" data-type="${key}"
               style="font-size:.72rem;border-color:${cfg.color};color:${cfg.color}">
         ${cfg.icon} ${cfg.label}
       </button>`
    ).join('')}
  </div>`;

  // ── Acreditados ────────────────────────────────────────────────────────────
  const creditedHTML = credited.length > 0 ? `
    <details style="margin-top:12px">
      <summary style="font-size:.72rem;color:var(--color-text-3);cursor:pointer;font-weight:600;padding:6px 0">
        ✅ Acreditados / cerrados (${credited.length})
      </summary>
      <div style="margin-top:8px;opacity:.75">
        ${credited.map(i => {
          const cfg   = tenCfgFromNotes(i.notes);
          const total = i.credited_amount ?? ((i.original_amount??0)+(i.interest_amount??0));
          const int   = total - (i.original_amount??0);
          const desc  = (i.notes??'').replace(/^\[(FCI|PF|USD|CTA|GASTOS)\] /,'').split(' · ')[0]||'—';
          return `<div style="display:flex;justify-content:space-between;font-size:.76rem;padding:5px 0;border-top:1px solid var(--color-border)">
            <span style="color:var(--color-text-2)">${cfg.icon} ${desc} · ${i.credited_at??''}</span>
            <span style="color:#16a34a;font-weight:700">${fmt(total)}${int>0?` <span style="color:var(--color-text-3);font-size:.7rem">(+${fmt(int)})</span>`:''}</span>
          </div>`;
        }).join('')}
      </div>
    </details>` : '';

  // ── NUEVO (aditivo): gráfico de evolución de acreditaciones ──────────────
  // Línea acumulada usando credited_at + credited_amount. Solo se muestra
  // si hay 2+ acreditaciones; si no, no aparece nada y todo sigue igual.
  let evolutionHTML = '';
  try {
    const credOrdered = credited
      .filter(i => i.credited_at)
      .map(i => ({
        date: String(i.credited_at).slice(0, 10),
        amt:  i.credited_amount ?? ((i.original_amount??0)+(i.interest_amount??0)),
        int:  (i.credited_amount ?? ((i.original_amount??0)+(i.interest_amount??0))) - (i.original_amount??0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (credOrdered.length >= 2) {
      let acc = 0, accInt = 0;
      const pts = credOrdered.map(c => { acc += c.amt; accInt += Math.max(0, c.int); return { ...c, acc, accInt }; });
      const evW = 560, evH = 120, padL = 10, padR = 10, padT = 14, padB = 22;
      const maxAcc = pts[pts.length-1].acc || 1;
      const n2 = pts.length;
      const px2 = i => padL + (i / Math.max(n2-1, 1)) * (evW - padL - padR);
      const py2 = v => (evH - padB) - (v / maxAcc) * (evH - padT - padB);
      const line = pts.map((p, i) => px2(i).toFixed(1) + ',' + py2(p.acc).toFixed(1)).join(' ');
      const dots = pts.map((p, i) =>
        '<circle cx="'+px2(i).toFixed(1)+'" cy="'+py2(p.acc).toFixed(1)+'" r="3.5" fill="#f97316">'
        + '<title>'+p.date+' · +'+fmt(p.amt)+' · acumulado '+fmt(p.acc)+'</title></circle>'
      ).join('');
      const labels = pts.map((p, i) => {
        if (n2 > 6 && i % Math.ceil(n2/6) !== 0 && i !== n2-1) return '';
        return '<text x="'+px2(i).toFixed(1)+'" y="'+(evH-6)+'" text-anchor="middle" font-size="8" fill="var(--color-text-3)">'+p.date.slice(5)+'</text>';
      }).join('');
      evolutionHTML = `
        <div style="margin-top:16px;background:var(--color-surface-2);border-radius:10px;padding:12px 14px;border:1px solid var(--color-border)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:.7rem;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em">📈 Evolución de acreditaciones</span>
            <span style="font-size:.7rem;color:var(--color-text-3)">Total acreditado: <strong style="color:#f97316">${fmt(pts[pts.length-1].acc)}</strong>${pts[pts.length-1].accInt > 0 ? ' · intereses <strong style="color:#16a34a">+'+fmt(pts[pts.length-1].accInt)+'</strong>' : ''}</span>
          </div>
          <svg width="100%" viewBox="0 0 ${evW} ${evH}" style="font-family:inherit;overflow:visible">
            <line x1="${padL}" y1="${evH-padB}" x2="${evW-padR}" y2="${evH-padB}" stroke="var(--color-border)" stroke-width="1"/>
            <polyline points="${line}" fill="none" stroke="#f97316" stroke-width="2" stroke-linejoin="round"/>
            ${dots}${labels}
          </svg>
        </div>`;
    }
  } catch (e2) { console.warn('[Operations] tenencias chart:', e2); }
  // ── fin gráfico evolución ──────────────────────────────────────────────────

  panel.innerHTML = `<div style="padding:16px">
    ${addBtns}

    ${(conRend.length + estatic.length) > 0 ? `
    <div style="display:flex;gap:16px;margin-bottom:16px;padding:10px 14px;border-radius:10px;
                background:var(--color-surface-2);flex-wrap:wrap">
      ${totalRend > 0 ? `
        <div><div style="font-size:.65rem;color:var(--color-text-3);text-transform:uppercase;font-weight:700">Invertido</div>
             <div style="font-size:1rem;font-weight:800;color:var(--color-text)">${fmt(totalRend)}</div></div>
        <div><div style="font-size:.65rem;color:var(--color-text-3);text-transform:uppercase;font-weight:700">Intereses</div>
             <div style="font-size:1rem;font-weight:800;color:#16a34a">+${fmt(totalIntereses)}</div></div>` : ''}
      ${totalEstat > 0 ? `
        <div><div style="font-size:.65rem;color:var(--color-text-3);text-transform:uppercase;font-weight:700">Disponible</div>
             <div style="font-size:1rem;font-weight:800;color:#64748b">${fmt(totalEstat)}</div></div>` : ''}
    </div>` : ''}

    ${conRend.length > 0 ? `
    <div style="font-size:.7rem;font-weight:700;color:var(--color-text-3);text-transform:uppercase;
                letter-spacing:.05em;margin-bottom:8px">Con rendimiento</div>
    ${conRend.map(rendRow).join('')}` : ''}

    ${estatic.length > 0 ? `
    <div style="font-size:.7rem;font-weight:700;color:var(--color-text-3);text-transform:uppercase;
                letter-spacing:.05em;margin:${conRend.length?'16px':0} 0 8px">Saldos disponibles</div>
    ${estatic.map(estatRow).join('')}` : ''}

    ${(conRend.length + estatic.length) === 0 ? `
    <div style="text-align:center;padding:30px;color:var(--color-text-3);font-size:.82rem">
      Sin posiciones activas · usá los botones de arriba para agregar
    </div>` : ''}

    ${evolutionHTML}

    ${creditedHTML}
  </div>`;

  // ── Eventos ────────────────────────────────────────────────────────────────
  header.querySelector('#ten-config-btn')?.addEventListener('click', () => this._openTasasModal(rates));

  panel.querySelectorAll('.ten-add-btn').forEach(btn =>
    btn.addEventListener('click', () => this._openTenenciaModal(btn.dataset.type, rates))
  );
  panel.querySelectorAll('.ten-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const item = all.find(i => i.id === btn.dataset.id);
      if (item) {
        const key = Object.entries(TEN_CFG).find(([,cfg]) => item.notes?.startsWith(cfg.prefix))?.[0] ?? 'frasco';
        this._openTenenciaModal(key, rates, item);
      }
    })
  );
  panel.querySelectorAll('.ten-credit-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const item = all.find(i => i.id === btn.dataset.id);
      if (item) this._openTenenciaCreditModal(item);
    })
  );
  panel.querySelectorAll('.ten-delete-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta posición?')) return;
      const { error } = await this.db.from('frasco_items').delete().eq('id', btn.dataset.id);
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      showToast('Eliminado ✓', 'success');
      const p2 = document.getElementById('ops-panel');
      const h2 = document.getElementById('ops-header-actions');
      if (p2 && h2) await this._loadTenencias(p2, h2);
    })
  );
};

// ── Modal: agregar / editar tenencia ─────────────────────────────────────────
OperationsModule.prototype._openTenenciaModal = function(tipo, rates, item = null) {
  const ex = document.getElementById('overlay-tenencia-modal');
  if (ex) ex.remove();

  const cfg    = TEN_CFG[tipo] ?? TEN_CFG.frasco;
  const isEdit = !!item;
  const today2 = new Date().toISOString().slice(0, 10);
  const isEstat = cfg.tipo === 'estatico';

  const existingDesc    = isEdit ? (item.notes??'').replace(/^\[(FCI|PF|USD|CTA|GASTOS)\] /,'').split(' · ')[0] : '';
  const existingNotes   = isEdit ? (item.notes??'').split(' · ').slice(1).join(' · ') : '';
  const existingBooking = isEdit ? (item.booking_id ?? null) : null;

  const isFrasco = tipo === 'frasco';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'overlay-tenencia-modal';
  modal.innerHTML = `
    <div class="modal modal-sm">
      <div class="modal-header" style="background:linear-gradient(135deg,${cfg.color}11,${cfg.color}22)">
        <h3 class="modal-title">${cfg.icon} ${isEdit?'Editar':'Agregar'} — ${cfg.label}</h3>
        <button class="modal-close" id="tm-close">✕</button>
      </div>
      <div class="modal-body">

        ${isFrasco ? `
        <div id="tm-booking-section" style="background:var(--color-surface-2);border-radius:10px;padding:12px 14px;margin-bottom:14px;border:1px solid var(--color-border)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <label style="font-size:.78rem;font-weight:600;color:var(--color-text-2);margin:0">
              🔗 Asociar a reserva <span style="font-weight:400;color:var(--color-text-3)">(opcional)</span>
            </label>
            <button type="button" id="tm-booking-clear" style="display:none;font-size:.7rem;color:var(--color-text-3);background:none;border:none;cursor:pointer;padding:0">✕ Quitar</button>
          </div>
          <div id="tm-booking-selected" style="display:none;background:${cfg.color}11;border:1px solid ${cfg.color}33;border-radius:8px;padding:8px 12px;font-size:.8rem;margin-bottom:8px">
            <div id="tm-booking-info" style="font-weight:600;color:var(--color-text)"></div>
            <div id="tm-booking-dates" style="font-size:.7rem;color:var(--color-text-3);margin-top:2px"></div>
          </div>
          <div style="display:flex;gap:6px">
            <input type="text" id="tm-booking-search" class="form-input" placeholder="Buscar por huésped o fecha…" style="font-size:.8rem;flex:1" autocomplete="off">
            <button type="button" id="tm-booking-search-btn" class="btn btn-outline btn-sm" style="white-space:nowrap">🔍 Buscar</button>
          </div>
          <div id="tm-booking-results" style="display:none;max-height:160px;overflow-y:auto;margin-top:6px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface)"></div>
          <input type="hidden" id="tm-booking-id" value="${existingBooking ?? ''}">
        </div>` : ''}

        <div class="form-group">
          <label>Descripción <span class="req">*</span></label>
          <input type="text" id="tm-desc" class="form-input"
                 placeholder="${tipo==='usd'?'Ej: dólares en caja':tipo==='cuenta'?'Ej: caja de ahorro Santander':'Ej: seña García julio'}"
                 value="${existingDesc}">
        </div>
        <div class="form-group">
          <label>Monto ${tipo==='usd'?'(USD)':'(ARS)'} <span class="req">*</span></label>
          <div style="position:relative">
            <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:${cfg.color};font-size:.78rem;font-weight:600;letter-spacing:-.02em">${tipo==='usd'?'USD':'$'}</span>
            <input type="number" id="tm-base" min="0" step="0.01" class="form-input"
                   placeholder="0.00"
                   style="padding-left:${tipo==='usd'?'38':'22'}px" value="${item?.original_amount??''}">
          </div>
        </div>

        ${!isEstat ? `
        <div class="form-grid-2">
          <div class="form-group">
            <label>Intereses (${tipo==='usd'?'USD':'ARS'})</label>
            <div style="position:relative">
              <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#16a34a">+${tipo==='usd'?'U$S':'$'}</span>
              <input type="number" id="tm-interest" min="0" step="0.01" class="form-input"
                     style="padding-left:34px" value="${item?.interest_amount??0}">
            </div>
          </div>
          <div class="form-group">
            <label>Fecha acreditación <span class="req">*</span></label>
            <input type="date" id="tm-date" class="form-input" value="${item?.frasco_date??today2}">
          </div>
        </div>
        <div style="background:#f0fdf4;border-radius:8px;padding:8px 14px;margin-bottom:12px;
                    display:flex;justify-content:space-between">
          <span style="font-size:.78rem;color:#166534;font-weight:600">Total al acreditar</span>
          <span id="tm-total" style="font-size:1rem;font-weight:800;color:#16a34a">$0</span>
        </div>
        <div id="tm-pct" style="text-align:right;font-size:.7rem;color:#16a34a;margin-top:-8px;margin-bottom:12px;min-height:14px"></div>
        ` : ''}

        <div class="form-group">
          <label>Notas <span style="font-size:.72rem;color:var(--color-text-3)">(opcional)</span></label>
          <input type="text" id="tm-notes" class="form-input" placeholder="Observaciones" value="${existingNotes}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="tm-cancel">Cancelar</button>
        <button class="btn btn-primary" id="tm-save"
                style="background:${cfg.color};border-color:${cfg.color}">
          💾 ${isEdit?'Guardar cambios':'Agregar'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.style.zIndex = '210';
  const close = () => { modal.remove(); if (escH) document.removeEventListener('keydown', escH); };
  const escH  = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escH);
  modal.querySelector('#tm-close').onclick  = close;
  modal.querySelector('#tm-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  if (!isEstat) {
    const baseI  = modal.querySelector('#tm-base');
    const intI   = modal.querySelector('#tm-interest');
    const totEl  = modal.querySelector('#tm-total');
    const pctEl  = modal.querySelector('#tm-pct');
    const dateEl = modal.querySelector('#tm-date');
    const fmt2   = n => '$'+(n||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const updateT = () => {
      const b = parseFloat(baseI.value)||0, i = parseFloat(intI.value)||0;
      totEl.textContent = fmt2(b+i);
      if (b>0&&i>0&&dateEl?.value) {
        const dias = Math.round((new Date(dateEl.value+'T00:00:00')-new Date(today2+'T00:00:00'))/86400000);
        if (pctEl) pctEl.textContent = (i/b*100).toFixed(2).replace('.',',')+'% de rendimiento'+(dias>0?' en '+dias+'d':'');
      } else if (pctEl) pctEl.textContent = '';
    };
    [baseI,intI,dateEl].forEach(el=>el?.addEventListener('input',updateT));
    updateT();
    setTimeout(()=>baseI?.focus(),80);
  }

  // ── Booking picker para Naranja X (frasco) ────────────────────────────────
  if (isFrasco) {
    const searchInput   = modal.querySelector('#tm-booking-search');
    const searchBtn     = modal.querySelector('#tm-booking-search-btn');
    const resultsBox    = modal.querySelector('#tm-booking-results');
    const selectedBox   = modal.querySelector('#tm-booking-selected');
    const clearBtn      = modal.querySelector('#tm-booking-clear');
    const bookingIdInp  = modal.querySelector('#tm-booking-id');
    const bookingInfo   = modal.querySelector('#tm-booking-info');
    const bookingDates  = modal.querySelector('#tm-booking-dates');

    const _applyBooking = (b) => {
      const guest = b.guests ? (b.guests.first_name + ' ' + b.guests.last_name).trim() : 'Huésped';
      const desc  = modal.querySelector('#tm-desc');
      const dateF = modal.querySelector('#tm-date');
      bookingIdInp.value  = b.id;
      bookingInfo.textContent  = guest;
      bookingDates.textContent = 'Check-in: ' + b.check_in + ' → ' + b.check_out;
      selectedBox.style.display = 'block';
      clearBtn.style.display    = 'inline';
      resultsBox.style.display  = 'none';
      // Pre-fill description y fecha si están vacíos
      if (!desc?.value.trim()) desc.value = 'Seña ' + guest;
      if (dateF && !dateF.value) dateF.value = b.check_in;
    };

    // Si hay booking previo (edit), cargarlo
    if (existingBooking) {
      this.db.from('bookings')
        .select('id, check_in, check_out, guests!bookings_guest_id_fkey(first_name,last_name)')
        .eq('id', existingBooking).single()
        .then(({ data }) => { if (data) _applyBooking(data); });
    }

    const _doSearch = async () => {
      const q = searchInput.value.trim();
      resultsBox.innerHTML = '<div style="padding:10px;font-size:.78rem;color:var(--color-text-3)">Buscando…</div>';
      resultsBox.style.display = 'block';
      try {
        let query = this.db.from('bookings')
          .select('id, check_in, check_out, guests!bookings_guest_id_fkey(first_name,last_name)')
          .eq('hotel_id', this.ctx.hotelId)
          .not('status','in','(cancelled)')
          .order('check_in', { ascending: false })
          .limit(20);
        if (q) {
          // Filtro aproximado por fecha o nombre (side-filter en cliente)
          query = query.gte('check_in', q.match(/^\d{4}/) ? q : '2020-01-01');
        }
        const { data } = await query;
        const rows = (data ?? []).filter(b => {
          if (!q) return true;
          const name = b.guests ? (b.guests.first_name+' '+b.guests.last_name).toLowerCase() : '';
          return name.includes(q.toLowerCase()) || b.check_in.includes(q) || b.check_out.includes(q);
        }).slice(0,8);
        if (!rows.length) {
          resultsBox.innerHTML = '<div style="padding:10px;font-size:.78rem;color:var(--color-text-3)">Sin resultados</div>';
          return;
        }
        resultsBox.innerHTML = rows.map(b => {
          const gName = b.guests ? (b.guests.first_name+' '+b.guests.last_name).trim() : 'Huésped';
          return '<div data-bid="'+b.id+'" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--color-border);font-size:.8rem">'
            +'<strong>'+gName+'</strong>'
            +'<span style="color:var(--color-text-3);margin-left:8px;font-size:.72rem">'+b.check_in+' → '+b.check_out+'</span>'
            +'</div>';
        }).join('');
        resultsBox.querySelectorAll('[data-bid]').forEach(row => {
          row.addEventListener('mouseover', () => row.style.background = 'var(--color-surface-2)');
          row.addEventListener('mouseout',  () => row.style.background = '');
          row.addEventListener('click', () => {
            const found = rows.find(b => b.id === row.dataset.bid);
            if (found) _applyBooking(found);
          });
        });
      } catch { resultsBox.innerHTML = '<div style="padding:10px;font-size:.78rem;color:var(--color-text-3)">Error al buscar</div>'; }
    };

    searchBtn.addEventListener('click', _doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _doSearch(); } });
    clearBtn.addEventListener('click', () => {
      bookingIdInp.value        = '';
      selectedBox.style.display = 'none';
      clearBtn.style.display    = 'none';
      searchInput.value         = '';
      resultsBox.style.display  = 'none';
    });
    // Cerrar resultados al clickear fuera
    modal.addEventListener('click', e => {
      if (!e.target.closest('#tm-booking-section')) resultsBox.style.display = 'none';
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  modal.querySelector('#tm-save').addEventListener('click', async () => {
    const base  = parseFloat(modal.querySelector('#tm-base').value);
    const desc  = modal.querySelector('#tm-desc').value.trim();
    const notes = modal.querySelector('#tm-notes')?.value.trim()||null;
    if (!base||base<=0){ showToast('Ingresá el monto','warning'); return; }
    if (!desc)         { showToast('Ingresá una descripción','warning'); return; }

    let interest = 0, frasco_date = null;
    if (!isEstat) {
      interest     = parseFloat(modal.querySelector('#tm-interest')?.value)||0;
      frasco_date  = modal.querySelector('#tm-date')?.value || null;
      if (!frasco_date){ showToast('Elegí la fecha de acreditación','warning'); return; }
    }

    const notesFinal = cfg.prefix + desc + (notes?' · '+notes:'');
    const saveBtn = modal.querySelector('#tm-save');
    saveBtn.disabled = true;

    const bookingIdVal = modal.querySelector('#tm-booking-id')?.value?.trim() || null;
    const payload = { original_amount:base, interest_amount:interest, frasco_date, notes:notesFinal, credited:false,
                      ...(bookingIdVal ? { booking_id: bookingIdVal } : { booking_id: null }) };
    let error;
    if (isEdit) {
      ({error} = await this.db.from('frasco_items').update(payload).eq('id',item.id));
    } else {
      ({error} = await this.db.from('frasco_items').insert({...payload, hotel_id:this.ctx.hotelId}));
    }
    if (error){ showToast('Error: '+error.message,'error'); saveBtn.disabled=false; return; }
    showToast(isEdit?'Actualizado ✓':'Posición agregada ✓','success');
    close();
    const p2=document.getElementById('ops-panel'),h2=document.getElementById('ops-header-actions');
    if (p2&&h2) await this._loadTenencias(p2,h2);
  });
};


OperationsModule.prototype._openTenenciaCreditModal = function(item) {
  const ex = document.getElementById('overlay-ten-credit');
  if (ex) ex.remove();

  const today2 = new Date().toISOString().slice(0, 10);
  const base   = item.original_amount ?? 0;
  const expInt = item.interest_amount  ?? 0;
  const expTotal = base + expInt;
  const fmt2   = n => '$' + (n||0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'overlay-ten-credit';
  modal.innerHTML = `
    <div class="modal modal-sm">
      <div class="modal-header" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7)">
        <h3 class="modal-title">💸 Acreditar posición</h3>
        <button class="modal-close" id="tc-close">✕</button>
      </div>
      <div class="modal-body">
        <div style="background:#fff7ed;border-radius:8px;padding:10px 14px;margin-bottom:14px">
          <div style="font-size:.72rem;color:#9a3412;font-weight:700;margin-bottom:6px">Posición original</div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:.76rem">
            <span>Base: <strong>${fmt2(base)}</strong></span>
            ${expInt > 0 ? `<span style="color:#16a34a">+${fmt2(expInt)} intereses</span>` : ''}
            <span>Total esperado: <strong>${fmt2(expTotal)}</strong></span>
            <span style="color:var(--color-text-3)">Acredita: ${item.frasco_date}</span>
          </div>
        </div>
        <div class="form-group">
          <label>Monto real acreditado <span class="req">*</span></label>
          <div style="position:relative">
            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#16a34a">$</span>
            <input type="number" id="tc-amount" min="0" step="0.01" class="form-input"
                   style="padding-left:22px" value="${expTotal}">
          </div>
        </div>
        <div style="background:#f0fdf4;border-radius:8px;padding:8px 14px;margin-bottom:12px;
                    display:flex;justify-content:space-between">
          <span style="font-size:.78rem;color:#166534;font-weight:600">Intereses reales</span>
          <span id="tc-int" style="font-size:1rem;font-weight:800;color:#16a34a">+${fmt2(expInt)}</span>
        </div>
        <div class="form-group">
          <label>Fecha de acreditación real</label>
          <input type="date" id="tc-date" class="form-input" value="${today2}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="tc-cancel">Cancelar</button>
        <button class="btn btn-primary" id="tc-save" style="background:#16a34a;border-color:#16a34a">✅ Registrar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.style.zIndex = '210';

  const close = () => { modal.remove(); if (escH) document.removeEventListener('keydown', escH); };
  const escH  = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escH);
  modal.querySelector('#tc-close').onclick  = close;
  modal.querySelector('#tc-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  const amtI  = modal.querySelector('#tc-amount');
  const intEl = modal.querySelector('#tc-int');
  const fmt3  = n => '$' + (n||0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  amtI.addEventListener('input', () => {
    const real = parseFloat(amtI.value) || 0;
    const int2 = real - base;
    intEl.textContent = (int2 >= 0 ? '+' : '') + fmt3(int2);
    intEl.style.color = int2 >= 0 ? '#16a34a' : '#ef4444';
  });
  setTimeout(() => { amtI.select(); }, 80);

  modal.querySelector('#tc-save').addEventListener('click', async () => {
    const credited_amount = parseFloat(amtI.value);
    const credited_at     = modal.querySelector('#tc-date').value;
    if (!credited_amount || credited_amount <= 0) { showToast('Ingresá el monto', 'warning'); return; }
    const saveBtn = modal.querySelector('#tc-save');
    saveBtn.disabled = true;
    const { error } = await this.db.from('frasco_items').update({
      credited: true, credited_amount, credited_at: credited_at || today2,
      interest_amount: credited_amount - base,
    }).eq('id', item.id);
    if (error) { showToast('Error: ' + error.message, 'error'); saveBtn.disabled = false; return; }
    showToast(`✅ Acreditado ${fmt3(credited_amount)}`, 'success');
    close();
    const panel2 = document.getElementById('ops-panel');
    const header2 = document.getElementById('ops-header-actions');
    if (panel2 && header2) await this._loadTenencias(panel2, header2);
  });
};

// ── Modal: configurar tasas ────────────────────────────────────────────────────
OperationsModule.prototype._openTasasModal = function(rates) {
  const ex = document.getElementById('overlay-tasas');
  if (ex) ex.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'overlay-tasas';
  modal.innerHTML = `
    <div class="modal modal-sm">
      <div class="modal-header">
        <h3 class="modal-title">⚙️ Configurar tasas de referencia</h3>
        <button class="modal-close" id="tr-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>📈 Cocos Capital — TNA (%)</label>
          <input type="number" id="tr-tna" class="form-input" min="0" step="0.01"
                 value="${rates.tna_cocos}" placeholder="19">
          <small style="color:var(--color-text-3);font-size:.7rem">Tasa Nominal Anual del fondo COCOA</small>
        </div>
        <div class="form-group">
          <label>🏦 Santander Río — TEA (%)</label>
          <input type="number" id="tr-tea" class="form-input" min="0" step="0.01"
                 value="${rates.tea_santander}" placeholder="16">
          <small style="color:var(--color-text-3);font-size:.7rem">Tasa Efectiva Anual del plazo fijo</small>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="tr-cancel">Cancelar</button>
        <button class="btn btn-primary" id="tr-save">💾 Guardar tasas</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.style.zIndex = '210';

  const close = () => { modal.remove(); if (escH) document.removeEventListener('keydown', escH); };
  const escH  = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escH);
  modal.querySelector('#tr-close').onclick  = close;
  modal.querySelector('#tr-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  modal.querySelector('#tr-save').addEventListener('click', async () => {
    const tna = parseFloat(modal.querySelector('#tr-tna').value);
    const tea = parseFloat(modal.querySelector('#tr-tea').value);
    if (isNaN(tna) || isNaN(tea)) { showToast('Valores inválidos', 'warning'); return; }
    localStorage.setItem('mila_tenencias_rates', JSON.stringify({ tna_cocos: tna, tea_santander: tea }));
    showToast('Tasas guardadas ✓', 'success');
    close();
    const panel2 = document.getElementById('ops-panel');
    const header2 = document.getElementById('ops-header-actions');
    if (panel2 && header2) await this._loadTenencias(panel2, header2);
  });
};
