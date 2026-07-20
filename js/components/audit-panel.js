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
      <!-- Barra de herramientas -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:.78rem;color:var(--color-text-3)">🔒 Solo admin</span>
          <button class="btn btn-outline btn-sm" id="audit-refresh" title="Actualizar">⟳</button>
          <button class="btn btn-outline btn-sm" id="audit-clear-view" style="color:var(--color-text-3)" title="Colapsar todo">Colapsar</button>
        </div>
        <button class="btn btn-outline btn-sm" id="audit-clear-all" style="color:#ef4444;border-color:#fecaca">🗑 Limpiar registro</button>
      </div>

      <!-- Stats rápidas -->
      <div id="audit-stats-bar" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px"></div>

      <!-- Filtros: pills + búsqueda + fechas -->
      <div style="background:var(--color-surface-2);border-radius:10px;padding:10px 12px;margin-bottom:14px;display:flex;flex-direction:column;gap:8px">
        <div id="audit-filter-pills" style="display:flex;gap:5px;flex-wrap:wrap">
          <button class="audit-pill audit-pill-active" data-filter="" data-filter-multi="">Todas</button>
          <button class="audit-pill" data-filter="booking_created"   data-filter-multi="CREATE">➕ Creadas</button>
          <button class="audit-pill" data-filter="payment_added"     data-filter-multi="payment_added">💰 Pagos</button>
          <button class="audit-pill" data-filter="booking_cancelled" data-filter-multi="CANCEL">🚫 Canceladas</button>
          <button class="audit-pill" data-filter="checkin"           data-filter-multi="CHECKIN">✅ Check-ins</button>
          <button class="audit-pill" data-filter="checkout"          data-filter-multi="CHECKOUT">👋 Check-outs</button>
          <button class="audit-pill" data-filter="expense_added"     data-filter-multi="expense_added">📊 Gastos</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <div style="position:relative;flex:1;min-width:160px">
            <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--color-text-3);font-size:.82rem">🔍</span>
            <input id="audit-search" type="text" placeholder="Buscar por usuario, descripción…"
                   style="width:100%;padding:5px 10px 5px 28px;border:1px solid var(--color-border);border-radius:7px;
                          background:var(--color-surface);font-size:.78rem;color:var(--color-text);box-sizing:border-box">
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:.75rem;color:var(--color-text-3)">
            <span>Del</span>
            <input id="audit-date-from" type="date" style="font-size:.75rem;border:1px solid var(--color-border);border-radius:6px;padding:3px 6px;background:var(--color-surface);color:var(--color-text)">
            <span>al</span>
            <input id="audit-date-to"   type="date" style="font-size:.75rem;border:1px solid var(--color-border);border-radius:6px;padding:3px 6px;background:var(--color-surface);color:var(--color-text)">
            <button id="audit-date-clear" class="btn btn-ghost btn-xs" style="font-size:.7rem;color:var(--color-text-3)" title="Limpiar fechas">✕</button>
          </div>
          <select id="audit-user-filter" style="font-size:.75rem;border:1px solid var(--color-border);border-radius:6px;padding:3px 6px;background:var(--color-surface);color:var(--color-text);max-width:180px">
            <option value="">👤 Todos los usuarios</option>
          </select>
        </div>
      </div>

      <!-- Resultado del filtro activo -->
      <div id="audit-filter-info" style="font-size:.72rem;color:var(--color-text-3);margin-bottom:8px;min-height:16px"></div>

      <div id="audit-log-list"></div>
      <div id="audit-load-more" style="text-align:center;padding:16px;display:none">
        <button class="btn btn-outline btn-sm" id="btn-audit-more">Cargar más registros</button>
      </div>`;
  }

  _bindEvents(container) {
    // Inject pill styles once
    if (!document.getElementById('audit-pill-styles')) {
      const s = document.createElement('style');
      s.id = 'audit-pill-styles';
      s.textContent = `.audit-pill{font-size:.7rem;padding:3px 10px;border-radius:999px;border:0.5px solid var(--color-border);background:var(--color-surface-2);color:var(--color-text-2);cursor:pointer;font-weight:500;transition:all .15s}
      .audit-pill:hover{background:var(--color-surface);border-color:var(--color-border-strong)}
      .audit-pill-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
      .audit-timeline{border-left:2px solid var(--color-border);padding-left:12px;margin-left:14px}`;
      document.head.appendChild(s);
    }

    this._searchText = '';
    this._dateFrom   = '';
    this._dateTo     = '';
    this._userFilter = '';

    container.querySelector('#audit-refresh')?.addEventListener('click', () => this._loadLogs(container, true));

    // NUEVO (aditivo): filtro por usuario específico
    container.querySelector('#audit-user-filter')?.addEventListener('change', (e) => {
      this._userFilter = e.target.value;
      this._displayed  = PAGE_SIZE;
      this._renderLogs(container);
    });

    // Filter pills — client-side sobre _allLogs
    container.querySelectorAll('.audit-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        container.querySelectorAll('.audit-pill').forEach(p => p.classList.remove('audit-pill-active'));
        pill.classList.add('audit-pill-active');
        this._filter   = pill.dataset.filter ?? '';
        this._displayed = PAGE_SIZE;
        this._renderLogs(container);
      });
    });

    // Búsqueda de texto en tiempo real
    let _sTimer = null;
    container.querySelector('#audit-search')?.addEventListener('input', (e) => {
      clearTimeout(_sTimer);
      _sTimer = setTimeout(() => {
        this._searchText = e.target.value.trim().toLowerCase();
        this._displayed  = PAGE_SIZE;
        this._renderLogs(container);
      }, 200);
    });

    // Filtro de fechas
    const applyDates = () => {
      this._dateFrom  = container.querySelector('#audit-date-from')?.value ?? '';
      this._dateTo    = container.querySelector('#audit-date-to')?.value   ?? '';
      this._displayed = PAGE_SIZE;
      this._renderLogs(container);
    };
    container.querySelector('#audit-date-from')?.addEventListener('change', applyDates);
    container.querySelector('#audit-date-to')?.addEventListener('change',   applyDates);
    container.querySelector('#audit-date-clear')?.addEventListener('click', () => {
      const fi = container.querySelector('#audit-date-from'), ti = container.querySelector('#audit-date-to');
      if (fi) fi.value = ''; if (ti) ti.value = '';
      this._dateFrom = ''; this._dateTo = '';
      this._displayed = PAGE_SIZE;
      this._renderLogs(container);
    });

    container.querySelector('#audit-clear-view')?.addEventListener('click', () => {
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
      this._searchText = this._searchText ?? '';
      this._dateFrom   = this._dateFrom   ?? '';
      this._dateTo     = this._dateTo     ?? '';
      list.innerHTML = '<div class="loading-state" style="padding:24px;text-align:center">Cargando registros...</div>';
    }

    try {
      // Traemos todo sin filtro server-side de action — el filtrado combinado
      // (pill + texto + fechas) se hace client-side sobre _allLogs
      const { data, error } = await this.db
        .from('audit_log')
        .select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      this._allLogs = data ?? [];
      // NUEVO (aditivo): poblar el filtro de usuarios con los que aparecen en el log
      try {
        const sel = container.querySelector('#audit-user-filter');
        if (sel) {
          const users = [...new Set(this._allLogs.map(l => l.user_email).filter(Boolean))].sort();
          const cur = this._userFilter ?? '';
          sel.innerHTML = '<option value="">👤 Todos los usuarios</option>'
            + users.map(u => '<option value="' + u + '"' + (u === cur ? ' selected' : '') + '>' + u.split('@')[0] + '</option>').join('');
        }
      } catch {}
      this._renderStatsBar(container);
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

  _renderStatsBar(container) {
    const bar = container.querySelector('#audit-stats-bar');
    if (!bar || !this._allLogs?.length) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    const weekAgo  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const hoy     = this._allLogs.filter(l => (l.created_at ?? '').slice(0, 10) === todayStr).length;
    const semana  = this._allLogs.filter(l => (l.created_at ?? '').slice(0, 10) >= weekAgo).length;
    const pagos   = this._allLogs.filter(l => (l.action ?? '').includes('payment')).length;
    const usuarios = [...new Set(this._allLogs.map(l => l.user_email ?? l.user_id).filter(Boolean))].length;

    const card = (n, label, color) =>
      '<div class="audit-stat-card" style="border-top:3px solid ' + color + '">' +
      '<div class="asn">' + n + '</div>' +
      '<div class="asl">' + label + '</div></div>';

    bar.innerHTML =
      card(hoy,     'Acciones hoy',   '#6366f1') +
      card(semana,  'Esta semana',    '#0ea5e9') +
      card(pagos,   'Pagos totales',  '#22c55e') +
      card(usuarios,'Usuarios activos','#f59e0b');
  }

  _renderLogs(container) {
    const list     = container.querySelector('#audit-log-list');
    const moreWrap = container.querySelector('#audit-load-more');
    const infoEl   = container.querySelector('#audit-filter-info');
    if (!list) return;

    // ── Filtrado combinado ─────────────────────────────────────────────────
    let logs = this._allLogs ?? [];

    if (this._filter) {
      const f = this._filter.toLowerCase();
      logs = logs.filter(l => {
        const a = (l.action ?? '').toLowerCase();
        return a === f || a.startsWith(f);
      });
    }

    if (this._searchText) {
      const q = this._searchText;
      logs = logs.filter(l =>
        (l.user_email  ?? '').toLowerCase().includes(q) ||
        (l.description ?? '').toLowerCase().includes(q) ||
        (l.action      ?? '').toLowerCase().includes(q) ||
        (l.entity_type ?? '').toLowerCase().includes(q) ||
        (l.entity_id   ?? '').toLowerCase().includes(q)
      );
    }

    if (this._dateFrom) logs = logs.filter(l => (l.created_at ?? '').slice(0,10) >= this._dateFrom);
    if (this._dateTo)   logs = logs.filter(l => (l.created_at ?? '').slice(0,10) <= this._dateTo);
    // NUEVO (aditivo): filtro por usuario
    if (this._userFilter) logs = logs.filter(l => l.user_email === this._userFilter);

    if (infoEl) {
      const filters = [];
      if (this._filter)     filters.push('acción: ' + this._filter);
      if (this._searchText) filters.push('texto: "' + this._searchText + '"');
      if (this._userFilter) filters.push('usuario: ' + this._userFilter.split('@')[0]);
      if (this._dateFrom || this._dateTo)
        filters.push('fechas: ' + (this._dateFrom || '…') + ' → ' + (this._dateTo || '…'));
      infoEl.textContent = logs.length + ' registro' + (logs.length !== 1 ? 's' : '') +
        (filters.length ? ' · filtros: ' + filters.join(', ') : '');
    }

    if (!logs.length) {
      list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">📋</span>'
        + '<p>' + (this._filter || this._searchText || this._dateFrom || this._dateTo
          ? 'Sin resultados para los filtros activos.'
          : 'Sin registros de auditoría aún.') + '</p></div>';
      if (moreWrap) moreWrap.style.display = 'none';
      return;
    }

    // ── Agrupar por día ───────────────────────────────────────────────────
    const byDay = {};
    const todayLocale = new Date().toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });

    logs.slice(0, this._displayed).forEach(log => {
      const day = log.created_at
        ? new Date(log.created_at).toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
        : 'Sin fecha';
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(log);
    });

    list.innerHTML = Object.entries(byDay).map(([day, entries], di) => {
      const isToday = day === todayLocale;
      const isFirst = di === 0;

      // Mini-resumen de tipos de acciones del día
      const counts = {};
      entries.forEach(e => {
        const cfg = ACTION_LABELS[e.action] ?? ACTION_LABELS[(e.action ?? '').toLowerCase()];
        const k = cfg ? cfg.icon : '📌';
        counts[k] = (counts[k] ?? 0) + 1;
      });
      const miniBar = Object.entries(counts)
        .map(([icon, n]) => '<span style="font-size:.68rem">' + icon + (n > 1 ? ' ×' + n : '') + '</span>')
        .join(' ');

      return '<div class="audit-day-group" style="margin-bottom:4px">'
        + '<button class="audit-day-header ' + (isFirst ? 'open' : '') + '" data-day="' + di + '"'
        + ' style="display:flex;align-items:center;width:100%;text-align:left;padding:7px 10px;'
        + 'border-radius:8px;border:none;cursor:pointer;gap:8px;'
        + 'background:' + (isToday ? 'var(--color-primary)0d' : 'var(--color-surface-2)') + ';'
        + 'border-left:3px solid ' + (isToday ? 'var(--color-primary)' : 'var(--color-border)') + '">'
        + '<span style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">'
        + (isToday ? '<span style="font-size:.65rem;font-weight:700;padding:1px 7px;border-radius:4px;background:var(--color-primary);color:#fff;flex-shrink:0">HOY</span>' : '')
        + '<strong style="font-size:.78rem;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + day + '</strong>'
        + '<span style="font-size:.68rem;color:var(--color-text-3);white-space:nowrap;flex-shrink:0">' + entries.length + ' acción' + (entries.length !== 1 ? 'es' : '') + '</span>'
        + '<span style="display:flex;gap:4px;flex-shrink:0">' + miniBar + '</span>'
        + '</span>'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"'
        + ' class="audit-day-chevron" style="flex-shrink:0;transition:transform .2s;transform:' + (isFirst ? 'rotate(180deg)' : 'rotate(0)') + '">'
        + '<polyline points="6 9 12 15 18 9"/></svg>'
        + '</button>'
        + '<div class="audit-day-body ' + (isFirst ? 'open' : '') + '"'
        + ' style="display:' + (isFirst ? 'block' : 'none') + ';border-left:2px solid var(--color-border);margin-left:13px;padding-left:10px;margin-top:2px">'
        + entries.map(log => this._renderRow(log)).join('')
        + '</div></div>';
    }).join('');

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

    // NUEVO (aditivo): click en registro navegable → abre la entidad
    list.querySelectorAll('.audit-row-nav').forEach(row => {
      row.addEventListener('click', () => {
        const type = row.dataset.navType;
        const id   = row.dataset.navId;
        if (!id) return;
        if (type === 'booking') {
          if (window._bookingFormInstance?.openEdit) window._bookingFormInstance.openEdit(id);
        } else if (type === 'expense') {
          if (window.milaNav) window.milaNav('operations');
        }
      });
    });

    if (moreWrap) {
      const hasMore = logs.length > this._displayed;
      moreWrap.style.display = hasMore ? 'block' : 'none';
      const oldMore = moreWrap.querySelector('#btn-audit-more');
      if (oldMore) {
        oldMore.textContent = 'Cargar más (' + (logs.length - this._displayed) + ' restantes)';
        const newMore = oldMore.cloneNode(true);
        oldMore.replaceWith(newMore);
        newMore.addEventListener('click', () => { this._displayed += PAGE_SIZE; this._renderLogs(container); });
      }
    }
  }

  _renderStatsBar(container) {
    const bar = container.querySelector('#audit-stats-bar');
    if (!bar || !this._allLogs?.length) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const weekAgo  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const hoy      = this._allLogs.filter(l => (l.created_at ?? '').slice(0,10) === todayStr).length;
    const semana   = this._allLogs.filter(l => (l.created_at ?? '').slice(0,10) >= weekAgo).length;
    const pagos    = this._allLogs.filter(l => (l.action ?? '').includes('payment')).length;
    const usuarios = new Set(this._allLogs.map(l => l.user_email ?? l.user_id).filter(Boolean)).size;
    const card = (n, label, color) =>
      '<div class="audit-stat-card" style="border-top:3px solid ' + color + '">'
      + '<div class="asn">' + n + '</div>'
      + '<div class="asl">' + label + '</div></div>';
    bar.innerHTML =
      card(hoy,      'Acciones hoy',    '#6366f1') +
      card(semana,   'Esta semana',     '#0ea5e9') +
      card(pagos,    'Pagos totales',   '#22c55e') +
      card(usuarios, 'Usuarios activos','#f59e0b');
  }

  _renderRow(log) {
    const action = log.action ?? '';
    const cfg    = ACTION_LABELS[action] ?? ACTION_LABELS[action.toLowerCase()] ?? { label: action, icon: '📌', color: '#64748b' };
    const time   = log.created_at
      ? new Date(log.created_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })
      : '—';
    const rawUser  = log.user_email ?? log.user_id?.slice(0,8) ?? 'Sistema';
    const initials = rawUser === 'Sistema' ? '⚙' : rawUser.slice(0,2).toUpperCase();
    const entity   = log.entity_type && log.entity_id
      ? log.entity_type + ' #' + String(log.entity_id).slice(0,8)
      : log.entity_type ?? '';

    // NUEVO (aditivo): navegación a la entidad — solo para tipos conocidos
    const eType = (log.entity_type ?? '').toLowerCase();
    const navigable = log.entity_id && (eType.includes('booking') || eType.includes('reserva') || eType.includes('expense') || eType.includes('gasto'));
    const navAttrs = navigable
      ? ' data-nav-type="' + (eType.includes('booking') || eType.includes('reserva') ? 'booking' : 'expense') + '" data-nav-id="' + log.entity_id + '"'
      : '';

    // NUEVO (aditivo): diff de cambios si el log trae changes {before, after}
    let diffHTML = '';
    try {
      const ch = typeof log.changes === 'string' ? JSON.parse(log.changes) : log.changes;
      if (ch?.before && ch?.after) {
        const IGNORE = new Set(['updated_at','created_at','id','hotel_id']);
        const keys = [...new Set([...Object.keys(ch.before), ...Object.keys(ch.after)])]
          .filter(k => !IGNORE.has(k) && JSON.stringify(ch.before[k]) !== JSON.stringify(ch.after[k]))
          .slice(0, 4);
        if (keys.length) {
          const fmtV = v => {
            if (v === null || v === undefined || v === '') return '—';
            if (typeof v === 'number') return v.toLocaleString('es-AR');
            const s = String(v);
            return s.length > 24 ? s.slice(0, 24) + '…' : s;
          };
          diffHTML = '<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px;padding:6px 9px;background:var(--color-surface-2);border-radius:6px;border-left:2px solid ' + cfg.color + '">'
            + keys.map(k =>
                '<div style="font-size:.66rem;color:var(--color-text-3)"><strong style="color:var(--color-text-2)">' + k + ':</strong> '
                + '<span style="text-decoration:line-through;opacity:.6">' + fmtV(ch.before[k]) + '</span>'
                + ' <span style="color:' + cfg.color + '">→ ' + fmtV(ch.after[k]) + '</span></div>'
              ).join('')
            + '</div>';
        }
      }
    } catch {}

    return '<div class="audit-row' + (navigable ? ' audit-row-nav' : '') + '"' + navAttrs
      + ' style="display:flex;gap:10px;padding:8px 4px;align-items:flex-start;'
      + 'border-bottom:1px solid var(--color-border-2)' + (navigable ? ';cursor:pointer' : '') + '"'
      + (navigable ? ' title="Click para abrir ' + (eType.includes('booking') || eType.includes('reserva') ? 'la reserva' : 'el gasto en Operaciones') + '"' : '') + '>'
      + '<div style="width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;'
      + 'justify-content:center;font-size:.7rem;font-weight:700;'
      + 'background:' + cfg.color + '18;color:' + cfg.color + ';border:1.5px solid ' + cfg.color + '33">'
      + cfg.icon + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
      + '<span style="font-size:.8rem;font-weight:600;color:var(--color-text)">' + cfg.label + '</span>'
      + (entity ? '<span style="font-size:.68rem;color:var(--color-text-3);background:var(--color-surface-2);padding:1px 6px;border-radius:4px">' + entity + '</span>' : '')
      + (navigable ? '<span style="font-size:.62rem;color:var(--color-primary)">↗</span>' : '')
      + '</div>'
      + (log.description ? '<div style="font-size:.72rem;color:var(--color-text-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + log.description + '</div>' : '')
      + diffHTML
      + '<div style="display:flex;gap:10px;margin-top:3px;align-items:center">'
      + '<span style="font-size:.68rem;color:var(--color-text-3)" title="' + rawUser + '">'
      + '<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--color-border);font-size:.55rem;font-weight:700;margin-right:3px">' + initials + '</span>'
      + rawUser.split('@')[0] + '</span>'
      + '<span style="font-size:.68rem;color:var(--color-text-3)">🕐 ' + time + '</span>'
      + '</div></div></div>';
  }
}
