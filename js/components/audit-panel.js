// ══════════════════════════════════════════════════
// audit-panel.js — Registro de Auditoría
// Carga datos reales desde tabla audit_log en Supabase
// ══════════════════════════════════════════════════

import { can } from '../auth/permissions.js';
import { formatDate } from '../supabase-config.js';

const ACTION_LABELS = {
  booking_created:   { label: 'Reserva creada',     icon: '➕', color: '#22c55e' },
  booking_updated:   { label: 'Reserva editada',    icon: '✏️', color: '#3b82f6' },
  booking_deleted:   { label: 'Reserva eliminada',  icon: '🗑️', color: '#ef4444' },
  booking_cancelled: { label: 'Reserva cancelada',  icon: '🚫', color: '#f59e0b' },
  checkout:          { label: 'Check-out',           icon: '👋', color: '#8b5cf6' },
  checkin:           { label: 'Check-in',            icon: '✅', color: '#0ea5e9' },
  payment_added:     { label: 'Pago registrado',     icon: '💰', color: '#22c55e' },
  payment_deleted:   { label: 'Pago eliminado',      icon: '💸', color: '#ef4444' },
  config_updated:    { label: 'Configuración',       icon: '⚙️', color: '#6366f1' },
  expense_added:     { label: 'Gasto registrado',    icon: '📊', color: '#f59e0b' },
  guest_flagged:     { label: 'Huésped marcado',     icon: '⚑',  color: '#dc2626' },
  operation_updated: { label: 'Operación',           icon: '🔧', color: '#0891b2' },
};

export class AuditPanel {
  constructor(supabase, ctx) {
    this.db      = supabase;
    this.ctx     = ctx;
    this._page   = 0;
    this._filter = '';
  }

  async load() {
    const container = document.getElementById('audit-container');
    if (!container) return;

    if (!can('viewAuditLog')) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">🔒</span>
          <p>Solo administradores pueden ver el registro de auditoría.</p>
        </div>`;
      return;
    }

    container.innerHTML = this._renderShell();
    this._bindEvents(container);
    await this._loadLogs(container);
  }

  _renderShell() {
    return `
      <div class="section-header-row" style="margin-bottom:20px">
        <div>
          <h3>Registro de Auditoría</h3>
          <p style="font-size:.825rem;color:var(--color-text-3);margin-top:4px">
            🔒 Solo administradores · Últimas 200 acciones
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <select id="audit-filter-action" class="filter-select" style="min-width:160px">
            <option value="">Todas las acciones</option>
            ${Object.entries(ACTION_LABELS).map(([k, v]) =>
              `<option value="${k}">${v.label}</option>`
            ).join('')}
          </select>
          <button class="btn btn-outline btn-sm" id="audit-refresh">⟳ Actualizar</button>
        </div>
      </div>
      <div id="audit-log-list" class="audit-log-list">
        <div class="loading-state">Cargando registros...</div>
      </div>
    `;
  }

  _bindEvents(container) {
    container.querySelector('#audit-refresh')?.addEventListener('click', () => this._loadLogs(container));
    container.querySelector('#audit-filter-action')?.addEventListener('change', (e) => {
      this._filter = e.target.value;
      this._loadLogs(container);
    });
  }

  async _loadLogs(container) {
    const list = container.querySelector('#audit-log-list');
    if (!list) return;
    list.innerHTML = '<div class="loading-state">Cargando...</div>';

    try {
      let query = this.db
        .from('audit_log')
        .select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (this._filter) query = query.eq('action', this._filter);

      const { data, error } = await query;

      if (error) throw error;

      if (!data?.length) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📋</span><p>Sin registros de auditoría aún.</p></div>`;
        return;
      }

      list.innerHTML = data.map(log => {
        const cfg = ACTION_LABELS[log.action] ?? { label: log.action, icon: '📌', color: '#64748b' };
        const dateStr = log.created_at
          ? new Date(log.created_at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
          : '—';
        const user = log.user_email ?? log.user_id ?? 'Sistema';
        const meta = log.meta ? JSON.stringify(log.meta) : '';

        return `
          <div class="audit-row">
            <div class="audit-icon" style="background:${cfg.color}20;color:${cfg.color}">${cfg.icon}</div>
            <div class="audit-info">
              <div class="audit-action">${cfg.label}
                ${log.entity_type ? `<span class="audit-entity">${log.entity_type} ${log.entity_id ? '#' + String(log.entity_id).slice(0,8) : ''}</span>` : ''}
              </div>
              <div class="audit-meta">
                <span class="audit-user">👤 ${user}</span>
                <span class="audit-date">📅 ${dateStr}</span>
                ${meta ? `<span class="audit-detail" title="${meta.replace(/"/g,"'")}">ℹ️ Ver detalle</span>` : ''}
              </div>
              ${log.description ? `<div class="audit-desc">${log.description}</div>` : ''}
            </div>
          </div>`;
      }).join('');

    } catch (err) {
      console.error('[AuditPanel] load error:', err);
      list.innerHTML = `
        <div class="error-state">
          <p>Error al cargar el registro de auditoría.</p>
          <p style="font-size:.78rem;color:var(--color-text-3);margin-top:4px">
            Verificá que exista la tabla <code>audit_log</code> en Supabase.
          </p>
          <button class="btn btn-outline btn-sm" onclick="location.reload()">Reintentar</button>
        </div>`;
    }
  }
}
