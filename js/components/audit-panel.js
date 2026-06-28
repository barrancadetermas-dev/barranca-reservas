// ══════════════════════════════════════════════════
// audit-panel.js — Registro de Auditoría
// Paginación, agrupación por día, limpiar vista
// ══════════════════════════════════════════════════

import { can } from '../auth/permissions.js';

const ACTION_LABELS = {
  CREATE:              { label: 'Reserva creada',       icon: '➕', color: '#22c55e' },
  UPDATE:              { label: 'Reserva editada',      icon: '✏️', color: '#3b82f6' },
  DELETE:              { label: 'Reserva eliminada',    icon: '🗑️', color: '#ef4444' },
  CANCEL:              { label: 'Reserva cancelada',    icon: '🚫', color: '#f59e0b' },
  CHECKOUT:            { label: 'Check-out',            icon: '👋', color: '#8b5cf6' },
  CHECKIN:             { label: 'Check-in',             icon: '✅', color: '#0ea5e9' },
  booking_created:     { label: 'Reserva creada',       icon: '➕', color: '#22c55e' },
  booking_updated:     { label: 'Reserva editada',      icon: '✏️', color: '#3b82f6' },
  booking_deleted:     { label: 'Reserva eliminada',    icon: '🗑️', color: '#ef4444' },
  booking_cancelled:   { label: 'Reserva cancelada',    icon: '🚫', color: '#f59e0b' },
  checkout:            { label: 'Check-out',            icon: '👋', color: '#8b5cf6' },
  checkin:             { label: 'Check-in',             icon: '✅', color: '#0ea5e9' },
  payment_added:       { label: 'Pago registrado',      icon: '💰', color: '#22c55e' },
  payment_deleted:     { label: 'Pago eliminado',       icon: '💸', color: '#ef4444' },
  config_updated:      { label: 'Configuración',        icon: '⚙️', color: '#6366f1' },
  expense_added:       { label: 'Gasto registrado',     icon: '📊', color: '#f59e0b' },
  guest_flagged:       { label: 'Huésped marcado',      icon: '⚑',  color: '#dc2626' },
  operation_updated:   { label: 'Operación actualizada',icon: '🔧', color: '#0891b2' },
};

const PAGE_SIZE = 20;

export class AuditPanel {
  constructor(supabase, ctx) {
    this.db      = supabase;
    this.ctx     = ctx;
    this._page   = 0;
    this._filter = '';
    this._allLogs = [];
    this._displayed = 0;
  }

  async load() {
    const container = document.getElementById('audit-container');
    if (!container) return;

    if (!can('viewAuditLog')) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-state-icon">🔒</span>
        <p>Solo administradores pueden ver el registro de auditoría.</p>
      </div>`;
      return;
    }

    container.innerHTML = this._renderShell();
    this._bindEvents(container);
    await this._loadLogs(container, true);
  }

  _renderShell() {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <p style="font-size:.78rem;color:var(--color-text-3);margin:0">
            🔒 Solo administradores
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select id="audit-filter-action" class="filter-select" style="min-width:160px">
            <option value="">Todas las acciones</option>
            ${[...new Set(Object.entries(ACTION_LABELS).map(([,v]) => v.label))]
              .map(label => {
                const key = Object.entries(ACTION_LABELS).find(([,v]) => v.label === label)?.[0] ?? '';
                return `<option value="${key}">${label}</option>`;
              }).join('')}
          </select>
          <button class="btn btn-outline btn-sm" id="audit-refresh" title="Actualizar">⟳ Actualizar</button>
          <button class="btn btn-outline btn-sm" id="audit-clear-view" title="Colapsar todo" style="color:var(--color-text-3)">
            Colapsar
          </button>
          <button class="btn btn-outline btn-sm" id="audit-clear-all" title="Borrar todo el registro (solo admin)"
            style="color:#ef4444;border-color:#fecaca;margin-left:auto">
            🗑 Limpiar registro
          </button>
        </div>
      </div>
      <div id="audit-log-list"></div>
      <div id="audit-load-more" style="text-align:center;padding:16px;display:none">
        <button class="btn btn-outline btn-sm" id="btn-audit-more">Cargar más registros</button>
      </div>`;
  }

  _bindEvents(container) {
    container.querySelector('#audit-refresh')?.addEventListener('click', () => this._loadLogs(container, true));
    container.querySelector('#audit-filter-action')?.addEventListener('change', (e) => {
      this._filter = e.target.value;
      this._loadLogs(container, true);
    });
    container.querySelector('#audit-clear-view')?.addEventListener('click', () => {
      // Colapsar todos los grupos abiertos
      container.querySelectorAll('.audit-day-body.open').forEach(b => {
        b.classList.remove('open');
        b.style.display = 'none';
        b.previousElementSibling?.querySelector('.audit-day-chevron')
          ?.style.setProperty('transform', '');
      });
    });
    container.querySelector('#btn-audit-more')?.addEventListener('click', () => {
      this._displayed += PAGE_SIZE;
      this._renderLogs(container);
    });

    // ── Limpiar todo el registro (solo admin) con contraseña ──
    container.querySelector('#audit-clear-all')?.addEventListener('click', async () => {
      const confirmed = confirm(
        '⚠️ ¿Borrar TODOS los registros de auditoría?\n\n' +
        'Esta acción no se puede deshacer.\n\n' +
        'Se eliminará el historial completo de actividad del sistema.'
      );
      if (!confirmed) return;

      const pass = prompt('Ingresá tu contraseña de sesión para confirmar:');
      if (!pass) return;

      try {
        // Verificar contraseña re-autenticando con Supabase
        const { data: { user } } = await this.db.auth.getUser();
        if (!user?.email) throw new Error('No hay sesión activa');

        const { error: authErr } = await this.db.auth.signInWithPassword({
          email: user.email,
          password: pass,
        });
        if (authErr) throw new Error('Contraseña incorrecta');

        // Borrar todos los registros del hotel
        const { error: delErr } = await this.db
          .from('audit_log')
          .delete()
          .eq('hotel_id', this.ctx.hotelId);

        if (delErr) throw delErr;

        document.dispatchEvent(new CustomEvent('show:toast', {
          detail: { msg: '🗑 Registro de auditoría eliminado', type: 'success' }
        }));
        await this._loadLogs(container, true);
      } catch (err) {
        document.dispatchEvent(new CustomEvent('show:toast', {
          detail: { msg: 'Error: ' + (err?.message ?? String(err)), type: 'error' }
        }));
      }
    });
  } // end _bindEvents

  async _loadLogs(container, reset = false) {
    const list = container.querySelector('#audit-log-list');
    if (!list) return;
    if (reset) {
      this._displayed = PAGE_SIZE;
      list.innerHTML = '<div class="loading-state" style="padding:24px;text-align:center">Cargando registros...</div>';
    }

    try {
      let query = this.db
        .from('audit_log')
        .select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .order('created_at', { ascending: false })
        .limit(500);

      if (this._filter) query = query.eq('action', this._filter);

      const { data, error } = await query;
      if (error) throw error;

      this._allLogs = data ?? [];
      this._renderLogs(container);

    } catch (err) {
      console.error('[AuditPanel]', err);
      list.innerHTML = `<div class="error-state">
        <span class="error-icon">⚠️</span>
        <p>Error al cargar el registro.</p>
        <p style="font-size:.75rem;color:var(--color-text-3);margin-top:4px">
          Verificá que exista la tabla <code>audit_log</code> en Supabase.
        </p>
      </div>`;
    }
  }

  _renderLogs(container) {
    const list = container.querySelector('#audit-log-list');
    const moreWrap = container.querySelector('#audit-load-more');
    if (!list) return;

    const logs = this._allLogs;

    if (!logs.length) {
      list.innerHTML = `<div class="empty-state">
        <span class="empty-state-icon">📋</span>
        <p>Sin registros de auditoría aún.</p>
      </div>`;
      if (moreWrap) moreWrap.style.display = 'none';
      return;
    }

    // Agrupar por día
    const byDay = {};
    logs.slice(0, this._displayed).forEach(log => {
      const day = log.created_at
        ? new Date(log.created_at).toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
        : 'Sin fecha';
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(log);
    });

    list.innerHTML = Object.entries(byDay).map(([day, entries], di) => {
      const isToday = day === new Date().toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
      const isFirst = di === 0;

      return `
        <div class="audit-day-group">
          <button class="audit-day-header ${isFirst ? 'open' : ''}" data-day="${di}">
            <span class="audit-day-label">
              ${isToday ? '📅 Hoy · ' : ''}<strong>${day}</strong>
              <span class="audit-day-count">${entries.length} acción${entries.length !== 1 ? 'es' : ''}</span>
            </span>
            <svg class="audit-day-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" width="14" height="14"
                 style="transform:${isFirst ? 'rotate(180deg)' : 'rotate(0)'}">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="audit-day-body ${isFirst ? 'open' : ''}" style="display:${isFirst ? 'block' : 'none'}">
            ${entries.map(log => this._renderRow(log)).join('')}
          </div>
        </div>`;
    }).join('');

    // Toggle de grupos
    list.querySelectorAll('.audit-day-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const body    = btn.nextElementSibling;
        const chevron = btn.querySelector('.audit-day-chevron');
        const isOpen  = body.style.display !== 'none';
        body.style.display  = isOpen ? 'none' : 'block';
        body.classList.toggle('open', !isOpen);
        btn.classList.toggle('open', !isOpen);
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    });

    // Mostrar/ocultar "Cargar más"
    if (moreWrap) {
      const hasMore = logs.length > this._displayed;
      moreWrap.style.display = hasMore ? 'block' : 'none';
      const moreBtn = moreWrap.querySelector('#btn-audit-more');
      if (moreBtn) moreBtn.textContent = `Cargar más (${logs.length - this._displayed} restantes)`;
    }
  }

  _renderRow(log) {
    const action = log.action ?? '';
    const cfg    = ACTION_LABELS[action] ?? ACTION_LABELS[action.toLowerCase()] ?? { label: action, icon: '📌', color: '#64748b' };
    const time   = log.created_at
      ? new Date(log.created_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })
      : '—';
    const user   = log.user_email ?? log.user_id?.slice(0,8) ?? 'Sistema';
    const entity = log.entity_type && log.entity_id
      ? `${log.entity_type} #${String(log.entity_id).slice(0,8)}`
      : log.entity_type ?? '';

    return `
      <div class="audit-row">
        <div class="audit-icon" style="background:${cfg.color}18;color:${cfg.color}">${cfg.icon}</div>
        <div class="audit-info">
          <div class="audit-action">
            <span style="font-weight:600">${cfg.label}</span>
            ${entity ? `<span class="audit-entity">${entity}</span>` : ''}
          </div>
          <div class="audit-meta">
            <span class="audit-user">👤 ${user}</span>
            <span class="audit-time">🕐 ${time}</span>
            ${log.description ? `<span style="color:var(--color-text-3);font-size:.7rem">· ${log.description}</span>` : ''}
          </div>
        </div>
      </div>`;
  }
}
