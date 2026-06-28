// ══════════════════════════════════════════════════
// admin-users.js — Panel de Administración de Usuarios
// • Lista usuarios con avatar, email, rol, estado
// • Cambio de rol (admin/staff/demo)
// • Reset de contraseña por email
// • Solo accesible para admins
// • Usa la vista admin_users_view (ya creada en Supabase)
// ══════════════════════════════════════════════════

import { showToast, formatDate } from '../supabase-config.js';
import { can } from '../auth/permissions.js';

const ROLE_CONFIG = {
  admin: { label: 'Administrador', emoji: '👑', color: '#6366f1', bg: 'rgba(99,102,241,.12)' },
  staff: { label: 'Staff',         emoji: '👤', color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
  demo:  { label: 'Demo',          emoji: '👁',  color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
};

const STATUS_CONFIG = {
  active:         { label: 'Activo',        color: '#22c55e', dot: '🟢' },
  inactive:       { label: 'Inactivo',      color: '#94a3b8', dot: '⚪' },
  never_logged_in:{ label: 'Nunca ingresó', color: '#f59e0b', dot: '🟡' },
  banned:         { label: 'Bloqueado',     color: '#ef4444', dot: '🔴' },
};

// Avatares: usamos iniciales en vez de emojis

export class AdminUsers {
  constructor(supabase, ctx) {
    this.db  = supabase;
    this.ctx = ctx;
    this._users    = [];
    this._filter   = '';
    this._roleFilter = '';
  }

  // ── Punto de entrada ──────────────────────────────
  async load(container) {
    if (!container) return;

    if (!can('manageSeasonPricing')) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">🔒</span>
          <p>Solo los administradores pueden gestionar usuarios.</p>
        </div>`;
      return;
    }

    container.innerHTML = this._renderShell();
    this._bindShell(container);
    await this._fetchAndRender(container);
  }

  // ── Shell ─────────────────────────────────────────
  _renderShell() {
    return `
      <div class="au-toolbar">
        <input type="text" id="au-search" class="form-input"
               placeholder="🔍 Buscar por email o nombre..." style="max-width:240px">
        <select id="au-role-filter" class="filter-select">
          <option value="">Todos los roles</option>
          <option value="admin">👑 Administrador</option>
          <option value="staff">👤 Staff</option>
          <option value="demo">👁 Demo</option>
        </select>
        <button class="btn btn-outline btn-sm" id="au-refresh" title="Actualizar">
          🔄
        </button>
        <button class="btn btn-primary btn-sm" id="au-invite-btn">
          ✉️ Invitar usuario
        </button>
      </div>
      <div id="au-list" style="margin-top:12px">
        <div class="loading-state">Cargando usuarios...</div>
      </div>`;
  }

  _bindShell(container) {
    const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    container.querySelector('#au-search')?.addEventListener('input', deb((e) => {
      this._filter = e.target.value.trim().toLowerCase();
      this._render(container);
    }, 200));

    container.querySelector('#au-role-filter')?.addEventListener('change', (e) => {
      this._roleFilter = e.target.value;
      this._render(container);
    });

    container.querySelector('#au-refresh')?.addEventListener('click', () => {
      this._fetchAndRender(container);
    });

    container.querySelector('#au-invite-btn')?.addEventListener('click', () => {
      this._openInviteModal(container);
    });
  }

  // ── Fetch ─────────────────────────────────────────
  async _fetchAndRender(container) {
    const list = container.querySelector('#au-list');
    if (list) list.innerHTML = '<div class="loading-state">Cargando...</div>';
    try {
      const { data, error } = await this.db
        .from('admin_users_view')
        .select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      this._users = data ?? [];
      this._render(container);
    } catch (err) {
      console.error('[AdminUsers] fetch:', err);
      if (list) list.innerHTML = `
        <div class="error-state" style="padding:24px;text-align:center">
          <p style="font-weight:700;margin-bottom:6px">Error al cargar usuarios</p>
          <p style="font-size:.82rem;color:var(--color-text-3)">${err?.message ?? err}</p>
        </div>`;
    }
  }

  // ── Render tabla ──────────────────────────────────
  _render(container) {
    const list = container.querySelector('#au-list');
    if (!list) return;

    let users = this._users;

    if (this._filter) {
      users = users.filter(u =>
        (u.email ?? '').toLowerCase().includes(this._filter) ||
        (u.nombre ?? '').toLowerCase().includes(this._filter)
      );
    }
    if (this._roleFilter) {
      users = users.filter(u => u.role === this._roleFilter);
    }

    if (!users.length) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">👥</span>
          <p>No se encontraron usuarios.</p>
        </div>`;
      return;
    }

    list.innerHTML = `
      <div class="au-count" style="font-size:.78rem;color:var(--color-text-3);margin-bottom:10px">
        ${users.length} usuario${users.length !== 1 ? 's' : ''}
      </div>
      <div class="au-grid">
        ${users.map(u => this._renderUserCard(u)).join('')}
      </div>`;

    // Bind acciones en cada card
    list.querySelectorAll('[data-au-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.auAction;
        const userId = btn.dataset.userId;
        const email  = btn.dataset.email;
        if (action === 'change-role')  this._openRoleModal(userId, email, container);
        if (action === 'reset-pass')   this._generateResetLink(email, btn);
        if (action === 'toggle-ban')   this._toggleBan(userId, btn, container);
      });
    });
  }

  _renderUserCard(u) {
    const roleCfg    = ROLE_CONFIG[u.role]    ?? ROLE_CONFIG.staff;
    const statusCfg  = STATUS_CONFIG[u.status] ?? STATUS_CONFIG.inactive;
    const avatarColor = u.avatar_color ?? '#6366f1';
    // Usar inicial del nombre o email en vez de emoji
    const avatarLetter = (u.nombre?.[0] ?? u.email?.[0] ?? 'U').toUpperCase();
    const lastSeen   = u.last_sign_in_at
      ? this._timeAgo(new Date(u.last_sign_in_at))
      : 'Nunca';
    const createdAt  = u.created_at
      ? new Date(u.created_at).toLocaleDateString('es-AR')
      : '—';

    return `
      <div class="au-card">
        <!-- Avatar -->
        <div class="au-avatar" style="background:${avatarColor};color:#fff;font-size:1.3rem;font-weight:800;font-family:system-ui,sans-serif">
          ${avatarLetter}
        </div>

        <!-- Info -->
        <div class="au-info">
          <div class="au-email" title="${u.email ?? ''}">${u.email ?? '—'}</div>
          ${u.nombre ? `<div class="au-nombre">${u.nombre}</div>` : ''}
          <div class="au-meta">
            <span class="au-badge" style="background:${roleCfg.bg};color:${roleCfg.color}">
              ${roleCfg.emoji} ${roleCfg.label}
            </span>
            <span class="au-status" style="color:${statusCfg.color}">
              ${statusCfg.dot} ${statusCfg.label}
            </span>
          </div>
          <div class="au-dates">
            <span title="Creado">📅 ${createdAt}</span>
            <span title="Último acceso">🕐 ${lastSeen}</span>
          </div>
        </div>

        <!-- Acciones -->
        <div class="au-actions">
          <button class="btn btn-outline btn-xs"
                  data-au-action="change-role"
                  data-user-id="${u.id}"
                  data-email="${u.email ?? ''}"
                  title="Cambiar rol">
            ✏️ Rol
          </button>
          <button class="btn btn-outline btn-xs"
                  data-au-action="reset-pass"
                  data-user-id="${u.id}"
                  data-email="${u.email ?? ''}"
                  title="Generar link de acceso">
            🔑 Reset
          </button>
          <button class="btn btn-xs" style="${u.status === 'banned' ? 'color:#22c55e;border-color:rgba(34,197,94,.3)' : 'color:#ef4444;border-color:rgba(239,68,68,.3)'};border:1px solid;border-radius:6px;padding:2px 8px;font-size:.7rem;cursor:pointer;background:transparent"
                  data-au-action="toggle-ban"
                  data-user-id="${u.id}"
                  data-email="${u.email ?? ''}"
                  title="${u.status === 'banned' ? 'Desbloquear usuario' : 'Bloquear acceso'}">
            ${u.status === 'banned' ? '🔓 Desbloquear' : '🚫 Bloquear'}
          </button>
        </div>
      </div>`;
  }

  // ── Cambiar rol ───────────────────────────────────
  _openRoleModal(userId, email, container) {
    const user    = this._users.find(u => u.id === userId);
    const current = user?.role ?? 'staff';

    const existing = document.getElementById('overlay-au-role');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-au-role';
    modal.style.zIndex = '300';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">Cambiar rol</h3>
          <button class="modal-close" id="au-role-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.82rem;color:var(--color-text-2);margin-bottom:16px">
            <strong>${email}</strong>
          </p>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${Object.entries(ROLE_CONFIG).map(([key, cfg]) => `
              <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                            border-radius:var(--r-lg);border:2px solid
                            ${current === key ? 'var(--color-primary)' : 'var(--color-border)'};
                            background:${current === key ? 'var(--color-primary-light)' : 'var(--color-surface-2)'};
                            cursor:pointer;transition:border-color .15s">
                <input type="radio" name="au-role" value="${key}"
                       ${current === key ? 'checked' : ''}
                       style="accent-color:var(--color-primary)">
                <div>
                  <div style="font-weight:700;font-size:.88rem">${cfg.emoji} ${cfg.label}</div>
                  <div style="font-size:.72rem;color:var(--color-text-3)">
                    ${key === 'admin' ? 'Acceso total al sistema' :
                      key === 'staff' ? 'Gestión de reservas y operaciones' :
                      'Acceso de solo lectura con datos de demo'}
                  </div>
                </div>
              </label>`).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="au-role-cancel">Cancelar</button>
          <button class="btn btn-primary" id="au-role-save">Guardar rol</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('#au-role-close').onclick  = close;
    modal.querySelector('#au-role-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Highlight al seleccionar
    modal.querySelectorAll('input[name="au-role"]').forEach(radio => {
      radio.addEventListener('change', () => {
        modal.querySelectorAll('label').forEach(l => {
          const checked = l.querySelector('input')?.checked;
          l.style.borderColor = checked ? 'var(--color-primary)' : 'var(--color-border)';
          l.style.background  = checked ? 'var(--color-primary-light)' : 'var(--color-surface-2)';
        });
      });
    });

    modal.querySelector('#au-role-save').addEventListener('click', async () => {
      const btn     = modal.querySelector('#au-role-save');
      const newRole = modal.querySelector('input[name="au-role"]:checked')?.value;
      if (!newRole || newRole === current) { close(); return; }

      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        const { error } = await this.db
          .from('hotel_users')
          .update({ role: newRole })
          .eq('user_id', userId)
          .eq('hotel_id', this.ctx.hotelId);
        if (error) throw error;

        // Actualizar local
        const u = this._users.find(x => x.id === userId);
        if (u) u.role = newRole;

        showToast(`Rol actualizado a ${ROLE_CONFIG[newRole].label} ✓`, 'success');
        close();
        this._render(container);
      } catch (err) {
        console.error('[AdminUsers] change role:', err);
        showToast('Error: ' + (err?.message ?? err), 'error');
        btn.disabled = false; btn.textContent = 'Guardar rol';
      }
    });
  }

  // ── Invitar usuario nuevo ────────────────────────
  _openInviteModal(container) {
    document.getElementById('overlay-au-invite')?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-au-invite';
    modal.style.zIndex = '300';
    modal.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3 class="modal-title">✉️ Invitar nuevo usuario</h3>
          <button class="modal-close" id="au-invite-close">✕</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <p style="font-size:.82rem;color:var(--color-text-2);margin-bottom:16px">
            Supabase enviará un email de invitación. El usuario clickea el link y elige su contraseña.
          </p>
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">Email</label>
            <input type="email" id="au-invite-email" class="form-input"
                   placeholder="usuario@ejemplo.com" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">Rol</label>
            <select id="au-invite-role" class="form-input">
              <option value="staff">👤 Staff</option>
              <option value="admin">👑 Administrador</option>
              <option value="demo">👁 Demo (solo lectura)</option>
            </select>
          </div>
          <div id="au-invite-result" style="margin-top:14px;display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="au-invite-cancel">Cancelar</button>
          <button class="btn btn-primary" id="au-invite-send">Enviar invitación</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('#au-invite-close').onclick  = close;
    modal.querySelector('#au-invite-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#au-invite-send').addEventListener('click', async () => {
      const email = modal.querySelector('#au-invite-email').value.trim();
      const role  = modal.querySelector('#au-invite-role').value;
      const btn   = modal.querySelector('#au-invite-send');
      const res   = modal.querySelector('#au-invite-result');

      if (!email || !email.includes('@')) {
        showToast('Ingresá un email válido', 'warning'); return;
      }

      btn.disabled = true; btn.textContent = 'Enviando...';
      try {
        const { data, error } = await this.db.functions.invoke('invite-user', {
          body: { action: 'invite', email, role, hotel_id: this.ctx.hotelId },
        });
        if (error || data?.error) throw new Error(error?.message ?? data?.error);

        res.style.display = 'block';
        res.innerHTML = `<div class="alert" style="background:rgba(34,197,94,.1);border:1px solid #22c55e;
          border-radius:8px;padding:10px 14px;font-size:.82rem;color:#15803d">
          ✅ Invitación enviada a <strong>${email}</strong>. El usuario recibirá un email para activar su cuenta.
        </div>`;
        btn.textContent = '✓ Enviado';
        this._fetchAndRender(container);
        setTimeout(close, 3000);
      } catch (err) {
        res.style.display = 'block';
        res.innerHTML = `<div class="alert" style="background:rgba(239,68,68,.1);border:1px solid #ef4444;
          border-radius:8px;padding:10px 14px;font-size:.82rem;color:#dc2626">
          ❌ ${err.message}
        </div>`;
        btn.disabled = false; btn.textContent = 'Enviar invitación';
      }
    });
  }

  // ── Generar link de reset (admin lo copia y manda) ─
  async _generateResetLink(email, btn) {
    if (!email) { showToast('Sin email asociado', 'warning'); return; }

    btn.disabled = true; btn.textContent = '⏳';
    try {
      const { data, error } = await this.db.functions.invoke('invite-user', {
        body: { action: 'reset_password', email, hotel_id: this.ctx.hotelId },
      });
      if (error || data?.error) throw new Error(error?.message ?? data?.error);

      if (data?.link) {
        // Mostrar modal con el link para copiar
        this._showLinkModal(email, data.link);
        showToast('Link generado ✓', 'success');
      } else {
        showToast('Link generado — revisar consola', 'info');
      }
    } catch (err) {
      // Fallback: enviar email de reset directo
      try {
        const { error: e2 } = await this.db.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/index.html',
        });
        if (e2) throw e2;
        showToast(`Email de reset enviado a ${email} ✓`, 'success');
      } catch {
        showToast('Error al resetear contraseña', 'error');
      }
    } finally {
      btn.disabled = false; btn.textContent = '🔑 Reset';
    }
  }

  _showLinkModal(email, link) {
    document.getElementById('overlay-au-link')?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-au-link';
    modal.style.zIndex = '300';
    modal.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h3 class="modal-title">🔑 Link de acceso para ${email}</h3>
          <button class="modal-close" id="au-link-close">✕</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <p style="font-size:.82rem;color:var(--color-text-2);margin-bottom:12px">
            Copiá este link y enviáselo al usuario. Expira en 1 hora.
          </p>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="au-link-input" class="form-input"
                   value="${link}" readonly style="font-size:.7rem;flex:1">
            <button class="btn btn-primary btn-sm" id="au-link-copy">📋 Copiar</button>
          </div>
          <p style="font-size:.72rem;color:var(--color-text-3);margin-top:10px">
            ⚠️ Este link permite acceso sin contraseña. Envialo solo al destinatario.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="au-link-close2">Cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('#au-link-close').onclick  = close;
    modal.querySelector('#au-link-close2').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#au-link-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        showToast('Link copiado ✓', 'success');
      } catch {
        modal.querySelector('#au-link-input').select();
        document.execCommand('copy');
        showToast('Link copiado ✓', 'success');
      }
    });
  }

  // ── Bloquear / desbloquear usuario ───────────────
  async _toggleBan(userId, btn, container) {
    const user = this._users.find(u => u.id === userId);
    const isBanned = user?.status === 'banned';
    const action   = isBanned ? 'Desbloquear' : 'Bloquear';
    if (!confirm(`¿${action} a ${user?.email ?? userId}?`)) return;

    btn.disabled = true;
    try {
      const { data, error } = await this.db.functions.invoke('invite-user', {
        body: { action: 'toggle_ban', user_id: userId, hotel_id: this.ctx.hotelId },
      });
      if (error || data?.error) throw new Error(error?.message ?? data?.error);
      showToast(`${action}ado ✓`, 'success');
      await this._fetchAndRender(container);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ── Helper: tiempo relativo ───────────────────────
  _timeAgo(date) {
    const diff = Math.floor((Date.now() - date) / 1000);
    if (diff < 60)     return 'Hace un momento';
    if (diff < 3600)   return `Hace ${Math.floor(diff/60)} min`;
    if (diff < 86400)  return `Hace ${Math.floor(diff/3600)} hs`;
    if (diff < 604800) return `Hace ${Math.floor(diff/86400)} días`;
    return date.toLocaleDateString('es-AR');
  }
}

// ── CSS inline ────────────────────────────────────────
// Inyectar estilos una sola vez
if (!document.getElementById('admin-users-css')) {
  const style = document.createElement('style');
  style.id = 'admin-users-css';
  style.textContent = `
    .au-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .au-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .au-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--r-xl);
      transition: border-color .15s;
    }
    .au-card:hover {
      border-color: var(--color-primary);
    }
    .au-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
    }
    .au-info {
      flex: 1;
      min-width: 0;
    }
    .au-email {
      font-weight: 700;
      font-size: .88rem;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .au-nombre {
      font-size: .75rem;
      color: var(--color-text-2);
      margin-top: 1px;
    }
    .au-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 5px;
      flex-wrap: wrap;
    }
    .au-badge {
      padding: 2px 8px;
      border-radius: 99px;
      font-size: .68rem;
      font-weight: 700;
    }
    .au-status {
      font-size: .72rem;
      font-weight: 600;
    }
    .au-dates {
      display: flex;
      gap: 12px;
      margin-top: 4px;
      font-size: .7rem;
      color: var(--color-text-3);
      flex-wrap: wrap;
    }
    .au-actions {
      display: flex;
      flex-direction: column;
      gap: 5px;
      flex-shrink: 0;
    }
    @media (max-width: 600px) {
      .au-card {
        flex-wrap: wrap;
      }
      .au-actions {
        flex-direction: row;
        width: 100%;
      }
    }
  `;
  document.head.appendChild(style);
}
