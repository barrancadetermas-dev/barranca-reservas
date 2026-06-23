/**
 * MILA PMS — Avatar Editor
 * Edición de avatar con overlay de lápiz, upload a Supabase Storage.
 *
 * Uso:
 *   import { AvatarEditor } from './components/avatar-editor.js';
 *   const editor = new AvatarEditor(supabaseClient, {
 *     containerId: 'avatar-container',
 *     userId: currentUser.id,
 *     currentUrl: profile.avatar_url,
 *     onUpdate: (newUrl) => updateProfileDisplay(newUrl),
 *   });
 *   editor.mount();
 */

export class AvatarEditor {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   * @param {object} opts
   * @param {string}          opts.containerId  ID del elemento contenedor
   * @param {string}          opts.userId       UUID del usuario
   * @param {string|null}     opts.currentUrl   URL actual del avatar
   * @param {function(string):void} opts.onUpdate  Callback con nueva URL
   * @param {number}          [opts.maxSizeMB]  Límite en MB (default: 2)
   */
  constructor(supabase, { containerId, userId, currentUrl, onUpdate, maxSizeMB = 2 }) {
    this._sb         = supabase;
    this._userId     = userId;
    this._currentUrl = currentUrl;
    this._onUpdate   = onUpdate;
    this._maxSize    = maxSizeMB * 1024 * 1024;
    this._container  = document.getElementById(containerId);
    this._fileInput  = null;
    this._loading    = false;
  }

  mount() {
    if (!this._container) {
      console.warn('[AvatarEditor] Contenedor no encontrado');
      return;
    }
    this._render();
  }

  updateUrl(url) {
    this._currentUrl = url;
    const img = this._container.querySelector('.avatar-img');
    if (img) img.src = url || this._fallbackSrc();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    this._container.innerHTML = `
      <div class="avatar-container" role="button" tabindex="0"
           aria-label="Cambiar foto de perfil" title="Cambiar foto de perfil">
        <img
          class="avatar-img"
          src="${this._currentUrl || this._fallbackSrc()}"
          alt="Avatar"
          onerror="this.src='${this._fallbackSrc()}'"
          width="80" height="80"
        />
        <div class="avatar-edit-overlay" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>
        <div class="avatar-loading-overlay" style="display:none">
          <svg class="spin" width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="white" stroke-width="2.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
          </svg>
        </div>
        <input type="file" class="avatar-file-input"
               accept="image/jpeg,image/png,image/webp,image/gif"
               style="display:none" aria-hidden="true" />
      </div>
    `;

    this._fileInput = this._container.querySelector('.avatar-file-input');
    const wrapper   = this._container.querySelector('.avatar-container');

    // Click en el avatar → abrir selector de archivo
    wrapper.addEventListener('click', () => {
      if (!this._loading) this._fileInput.click();
    });

    // Teclado accesible
    wrapper.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !this._loading) {
        e.preventDefault();
        this._fileInput.click();
      }
    });

    // Cambio de archivo → subir
    this._fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this._upload(file);
      // Reset para permitir seleccionar el mismo archivo nuevamente
      e.target.value = '';
    });
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  async _upload(file) {
    // Validación de tipo
    if (!file.type.startsWith('image/')) {
      this._showToast('Solo se permiten imágenes (JPG, PNG, WEBP, GIF)', 'error');
      return;
    }

    // Validación de tamaño
    if (file.size > this._maxSize) {
      const maxMB = (this._maxSize / 1024 / 1024).toFixed(0);
      this._showToast(`El archivo es demasiado grande (máximo ${maxMB} MB)`, 'error');
      return;
    }

    this._setLoading(true);

    try {
      // Nombre de archivo único por usuario
      const ext      = file.name.split('.').pop().toLowerCase();
      const path     = `${this._userId}/avatar_${Date.now()}.${ext}`;

      // Upload a Supabase Storage
      const { error: uploadError } = await this._sb.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadError) throw uploadError;

      // Obtener URL pública
      const { data: { publicUrl } } = this._sb.storage
        .from('avatars')
        .getPublicUrl(path);

      // Actualizar user_profiles
      const { error: updateError } = await this._sb
        .from('user_profiles')
        .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', this._userId);

      if (updateError) throw updateError;

      // Actualizar UI inmediatamente
      this.updateUrl(publicUrl);
      this._currentUrl = publicUrl;

      // Callback externo
      if (this._onUpdate) this._onUpdate(publicUrl);

      this._showToast('Avatar actualizado correctamente', 'success');

    } catch (err) {
      console.error('[AvatarEditor] Error al subir avatar:', err);
      this._showToast(err.message || 'Error al actualizar el avatar', 'error');
    } finally {
      this._setLoading(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _setLoading(active) {
    this._loading = active;
    const overlay = this._container.querySelector('.avatar-loading-overlay');
    const editOverlay = this._container.querySelector('.avatar-edit-overlay');
    if (overlay) overlay.style.display = active ? 'flex' : 'none';
    if (editOverlay) editOverlay.style.opacity = active ? '0' : '1';
  }

  _fallbackSrc() {
    // SVG data URI como fallback cuando no hay avatar
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Ccircle cx='40' cy='40' r='40' fill='%23374151'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%236b7280'/%3E%3Cellipse cx='40' cy='70' rx='24' ry='18' fill='%236b7280'/%3E%3C/svg%3E";
  }

  _showToast(message, type = 'info') {
    // Intentar usar el sistema de toast de la app si existe
    if (window.showToast) {
      window.showToast(message, type);
      return;
    }
    if (window.toast) {
      window.toast[type]?.(message);
      return;
    }
    // Fallback: alert básico
    if (type === 'error') console.error('[AvatarEditor]', message);
    else console.info('[AvatarEditor]', message);
  }
}

// ─── CSS para avatar-loading-overlay ─────────────────────────────────────────
const AVATAR_CSS = `
.avatar-container {
  position: relative;
  display: inline-block;
  cursor: pointer;
  user-select: none;
}

.avatar-img {
  display: block;
  border-radius: 50%;
  object-fit: cover;
  width: 80px;
  height: 80px;
  border: 3px solid rgba(255,255,255,0.15);
  transition: filter 0.2s ease;
}

.avatar-container:hover .avatar-img {
  filter: brightness(0.75);
}

.avatar-edit-overlay {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 26px;
  height: 26px;
  background: #3b82f6;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #0f172a;
  transition: background 0.2s ease, opacity 0.2s ease;
  z-index: 2;
  pointer-events: none;
}

.avatar-container:hover .avatar-edit-overlay {
  background: #2563eb;
}

.avatar-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.5);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
.spin { animation: spin 1s linear infinite; }
`;

// Inyectar CSS si no está ya presente
if (!document.getElementById('avatar-editor-css')) {
  const style = document.createElement('style');
  style.id    = 'avatar-editor-css';
  style.textContent = AVATAR_CSS;
  document.head.appendChild(style);
}
