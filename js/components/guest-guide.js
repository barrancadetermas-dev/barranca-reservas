// ══════════════════════════════════════════════════════════════
// guest-guide.js — Panel de administración Guía del Huésped
// ══════════════════════════════════════════════════════════════
import { GuideService } from '../services/guide-service.js';
import { showToast }    from '../supabase-config.js';

const SECTION_ICONS = ['🏡','📍','🌤','📶','⏰','📜','🍽','🛒','🎡','🎁','📞','❓','🚨','⭐','📸','🗺'];
const PLACE_CATS = [
  { key:'restaurants',  label:'🍽 Restaurantes' },
  { key:'supermarkets', label:'🛒 Supermercados' },
  { key:'butchers',     label:'🥩 Carnicerías' },
  { key:'greengrocers', label:'🥦 Verdulerías' },
  { key:'pharmacies',   label:'💊 Farmacias' },
  { key:'bakeries',     label:'🥐 Panaderías' },
  { key:'gas_stations', label:'⛽ Estaciones de servicio' },
  { key:'atms',         label:'🏧 Cajeros' },
  { key:'banks',        label:'🏦 Bancos' },
];
const RULE_TYPES = [
  { key:'allowed',    label:'✅ Permitido' },
  { key:'prohibited', label:'❌ Prohibido' },
  { key:'important',  label:'⚠️ Importante' },
  { key:'info',       label:'ℹ️ Información' },
];

export class GuestGuidePanel {
  constructor(supabase, ctx) {
    this.svc = new GuideService(supabase, ctx);
    this.ctx = ctx;
    this._tab = 'sections';
    this._cfg = {};
    this._sections = [];
    this._items = [];
    this._faqs = [];
    this._editingItem = null;
    this._editingFaq  = null;
    this._activeSection = null;
  }

  async load() {
    const container = document.getElementById('guide-panel-root');
    if (!container) return;
    container.innerHTML = this._renderShell();
    this._bindShell(container);
    await this._loadAll(container);
  }

  async _loadAll(container) {
    this._setLoading(container, true);
    try {
      [this._cfg, this._sections, this._items, this._faqs] = await Promise.all([
        this.svc.getConfig().then(c => c ?? {}),
        this.svc.getSections(),
        this.svc.getItems(),
        this.svc.getFaqs(),
      ]);
      this._renderActiveTab(container);
    } catch (err) {
      container.querySelector('#guide-tab-content').innerHTML = `<div class="empty-state"><p>Error al cargar: ${err.message}</p></div>`;
    }
    this._setLoading(container, false);
  }

  // ── Shell ─────────────────────────────────────────────
  _renderShell() {
    return `
      <div class="guide-admin-wrap">
        <!-- Top bar -->
        <div class="guide-topbar">
          <div>
            <div class="guide-topbar-title">🗺️ Guía del Huésped</div>
            <div class="guide-topbar-sub">Página pública para huéspedes</div>
          </div>
          <div class="guide-topbar-actions">
            <label class="guide-published-toggle" title="Publicar / despublicar la guía">
              <span id="guide-pub-label">Cargando...</span>
              <div class="guide-toggle-wrap">
                <input type="checkbox" id="guide-pub-chk" style="display:none">
                <div class="guide-toggle" id="guide-pub-visual"></div>
              </div>
            </label>
            <button class="btn btn-outline btn-sm" id="guide-qr-btn">🖨️ QR</button>
            <a class="btn btn-outline btn-sm" id="guide-view-btn" target="_blank">👁 Ver guía →</a>
          </div>
        </div>

        <!-- Tab nav -->
        <div class="guide-tabs-nav">
          <button class="guide-tab-btn active" data-tab="sections">📑 Secciones</button>
          <button class="guide-tab-btn" data-tab="config">⚙️ Configuración</button>
          <button class="guide-tab-btn" data-tab="appearance">🎨 Apariencia</button>
          <button class="guide-tab-btn" data-tab="stats">📊 Estadísticas</button>
          <button class="guide-tab-btn" data-tab="qr">🖨 QR</button>
        </div>

        <!-- Content -->
        <div id="guide-tab-content" class="guide-tab-content">
          <div class="guide-loading" id="guide-loading" style="display:none">
            <div class="guide-spinner"></div>
          </div>
        </div>
      </div>`;
  }

  _bindShell(container) {
    // Tab buttons
    container.querySelectorAll('.guide-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.guide-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._tab = btn.dataset.tab;
        this._renderActiveTab(container);
      });
    });
    // View link
    const origin = window.location.origin;
    container.querySelector('#guide-view-btn')?.setAttribute('href', `${origin}/guia`);
    // QR button
    container.querySelector('#guide-qr-btn')?.addEventListener('click', () => {
      this._tab = 'qr';
      container.querySelectorAll('.guide-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'qr'));
      this._renderActiveTab(container);
    });
  }

  _renderActiveTab(container) {
    const content = container.querySelector('#guide-tab-content');
    switch (this._tab) {
      case 'sections':   content.innerHTML = this._renderSections(); this._bindSections(content); break;
      case 'config':     content.innerHTML = this._renderConfig();   this._bindConfig(content, container); break;
      case 'appearance': content.innerHTML = this._renderAppearance(); this._bindAppearance(content, container); break;
      case 'stats':      content.innerHTML = '<div class="guide-loading-inline">Cargando...</div>'; this._loadStats(content); break;
      case 'qr':         content.innerHTML = this._renderQR(container); this._initQR(content); break;
    }
    // Update publish toggle
    const chk = container.querySelector('#guide-pub-chk');
    const vis = container.querySelector('#guide-pub-visual');
    const lbl = container.querySelector('#guide-pub-label');
    if (chk) {
      chk.checked = !!this._cfg.is_published;
      vis.className = 'guide-toggle' + (this._cfg.is_published ? ' on' : '');
      lbl.textContent = this._cfg.is_published ? '🟢 Publicada' : '🔴 No publicada';
      chk.onchange = async () => {
        const val = chk.checked;
        vis.className = 'guide-toggle' + (val ? ' on' : '');
        lbl.textContent = val ? '🟢 Publicada' : '🔴 No publicada';
        await this.svc.saveConfig({ is_published: val });
        this._cfg.is_published = val;
        showToast(val ? 'Guía publicada ✓' : 'Guía despublicada', val ? 'success' : 'info');
      };
    }
  }

  // ── SECTIONS TAB ──────────────────────────────────────
  _renderSections() {
    const secs = this._sections;
    return `
      <div class="guide-sections-layout">
        <!-- Sections list -->
        <div class="guide-sections-list" id="guide-sections-list">
          <div class="guide-sections-hint">Activá, desactivá o reordenará secciones. Click para editar su contenido.</div>
          ${secs.map(s => this._renderSectionRow(s)).join('')}
        </div>
        <!-- Section editor panel -->
        <div class="guide-section-editor" id="guide-section-editor">
          <div class="guide-editor-placeholder">
            <span style="font-size:2rem">👈</span>
            <p>Seleccioná una sección para editar su contenido</p>
          </div>
        </div>
      </div>`;
  }

  _renderSectionRow(sec) {
    return `
      <div class="guide-sec-row ${this._activeSection === sec.key ? 'active' : ''}" data-key="${sec.key}" data-id="${sec.id}">
        <div class="guide-sec-drag" title="Arrastrar para reordenar">⠿</div>
        <label class="guide-sec-toggle-wrap" title="${sec.is_visible ? 'Ocultar' : 'Mostrar'} esta sección">
          <input type="checkbox" class="guide-sec-chk" ${sec.is_visible ? 'checked' : ''} data-id="${sec.id}">
          <div class="guide-sec-toggle ${sec.is_visible ? 'on' : ''}"></div>
        </label>
        <span class="guide-sec-icon">${sec.icon}</span>
        <span class="guide-sec-title">${sec.title}</span>
        <span class="guide-sec-count">${this._countForSection(sec.key)}</span>
        <button class="guide-sec-edit-btn" data-key="${sec.key}">Editar →</button>
      </div>`;
  }

  _countForSection(key) {
    if (key === 'faq') return this._faqs.length ? `${this._faqs.length} preguntas` : '';
    const count = this._items.filter(i => i.section_key === key).length;
    return count ? `${count} elementos` : '';
  }

  _bindSections(content) {
    // Toggle visibility
    content.querySelectorAll('.guide-sec-chk').forEach(chk => {
      chk.addEventListener('change', async () => {
        const id = chk.dataset.id;
        const sec = this._sections.find(s => s.id === id);
        if (!sec) return;
        sec.is_visible = chk.checked;
        const toggle = chk.closest('.guide-sec-toggle-wrap').querySelector('.guide-sec-toggle');
        toggle.classList.toggle('on', chk.checked);
        await this.svc.updateSection(id, { is_visible: chk.checked });
        showToast(chk.checked ? 'Sección visible ✓' : 'Sección oculta', 'success');
      });
    });

    // Click row → open editor
    content.querySelectorAll('.guide-sec-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        this._activeSection = key;
        // Highlight active
        content.querySelectorAll('.guide-sec-row').forEach(r => r.classList.toggle('active', r.dataset.key === key));
        // Load editor
        const editorPanel = content.querySelector('#guide-section-editor');
        this._renderSectionEditor(key, editorPanel);
      });
    });
  }

  _renderSectionEditor(key, panel) {
    const sec = this._sections.find(s => s.key === key);
    if (!key || !sec) return;

    // Header edit (icon + title)
    let editorHtml = `
      <div class="guide-editor-header">
        <span class="guide-editor-icon">${sec.icon}</span>
        <div class="guide-editor-title-wrap">
          <div class="guide-field-label">Ícono</div>
          <select class="guide-input guide-input-sm guide-icon-picker" data-id="${sec.id}">
            ${SECTION_ICONS.map(i => `<option value="${i}" ${sec.icon === i ? 'selected' : ''}>${i}</option>`).join('')}
          </select>
        </div>
        <div class="guide-editor-title-wrap" style="flex:1">
          <div class="guide-field-label">Título de la sección</div>
          <input class="guide-input" type="text" value="${esc(sec.title)}" data-id="${sec.id}" placeholder="Título">
        </div>
        <button class="btn btn-primary btn-sm guide-sec-save-btn" data-id="${sec.id}">Guardar</button>
      </div>`;

    // Content area per section type
    if (key === 'faq') {
      editorHtml += this._renderFaqEditor();
    } else if (['quickinfo','contact','howtoget'].includes(key)) {
      editorHtml += `<div class="guide-editor-note">ℹ️ El contenido de esta sección se configura en la pestaña <strong>Configuración</strong>.</div>`;
    } else if (key === 'weather') {
      editorHtml += `<div class="guide-editor-note">🌤 El clima se obtiene automáticamente con las coordenadas del hotel configuradas en <strong>Configuración</strong>. No requiere contenido adicional.</div>`;
    } else {
      editorHtml += this._renderItemsEditor(key);
    }

    panel.innerHTML = editorHtml;
    this._bindEditor(key, panel);
  }

  _renderItemsEditor(sectionKey) {
    const items = this._items.filter(i => i.section_key === sectionKey);
    const showCategories = sectionKey === 'places';
    const showRuleType   = sectionKey === 'rules';
    return `
      <div class="guide-items-list" id="guide-items-list">
        ${items.length === 0 ? '<div class="guide-empty-items">Sin elementos. Agregá el primero.</div>' : ''}
        ${items.map(item => this._renderItemRow(item)).join('')}
      </div>
      <button class="guide-add-btn" id="guide-add-item">+ Agregar elemento</button>
      <!-- Item form (hidden by default) -->
      <div class="guide-item-form hidden" id="guide-item-form">
        ${this._renderItemForm(sectionKey, null, showCategories, showRuleType)}
      </div>`;
  }

  _renderItemRow(item) {
    const extra = item.extra_json || {};
    const sub = [item.address, item.description?.slice(0,60)].filter(Boolean).join(' · ');
    return `
      <div class="guide-item-row" data-id="${item.id}">
        <div class="guide-item-thumb">
          ${item.photo_url ? `<img src="${esc(item.photo_url)}" alt="">` : (item.icon || '📍')}
        </div>
        <div class="guide-item-info">
          <div class="guide-item-name">${esc(item.name)}</div>
          ${sub ? `<div class="guide-item-sub">${esc(sub)}</div>` : ''}
        </div>
        <div class="guide-item-actions">
          <button class="btn btn-outline btn-sm guide-edit-item" data-id="${item.id}">✏️</button>
          <button class="btn btn-outline btn-sm guide-delete-item" data-id="${item.id}">🗑</button>
        </div>
      </div>`;
  }

  _renderItemForm(sectionKey, item, showCategories, showRuleType) {
    const i = item || {};
    const extra = i.extra_json || {};
    return `
      <div class="guide-item-form-inner">
        <div class="guide-field-label">Nombre *</div>
        <input class="guide-input" type="text" id="item-name" value="${esc(i.name||'')}" placeholder="Nombre">

        ${showCategories ? `
          <div class="guide-field-label">Categoría</div>
          <select class="guide-input" id="item-category">
            ${PLACE_CATS.map(c => `<option value="${c.key}" ${i.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>` : ''}

        ${showRuleType ? `
          <div class="guide-field-label">Tipo</div>
          <select class="guide-input" id="item-rule-type">
            ${RULE_TYPES.map(r => `<option value="${r.key}" ${(extra.type||'info') === r.key ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select>` : ''}

        <div class="guide-field-label">Descripción</div>
        <textarea class="guide-textarea" id="item-desc" placeholder="Descripción breve">${esc(i.description||'')}</textarea>

        <div class="guide-field-row">
          <div>
            <div class="guide-field-label">Dirección</div>
            <input class="guide-input" type="text" id="item-address" value="${esc(i.address||'')}" placeholder="Dirección">
          </div>
          <div>
            <div class="guide-field-label">Teléfono</div>
            <input class="guide-input" type="text" id="item-phone" value="${esc(i.phone||'')}" placeholder="+54...">
          </div>
        </div>

        <div class="guide-field-row">
          <div>
            <div class="guide-field-label">WhatsApp (solo números)</div>
            <input class="guide-input" type="text" id="item-whatsapp" value="${esc(i.whatsapp||'')}" placeholder="5493468...">
          </div>
          <div>
            <div class="guide-field-label">Ícono (emoji)</div>
            <input class="guide-input" type="text" id="item-icon" value="${esc(i.icon||'📍')}" maxlength="4" style="width:60px">
          </div>
        </div>

        <div class="guide-field-row">
          <div>
            <div class="guide-field-label">Latitud</div>
            <input class="guide-input" type="number" id="item-lat" value="${i.coords_lat||''}" placeholder="-32.42...">
          </div>
          <div>
            <div class="guide-field-label">Longitud</div>
            <input class="guide-input" type="number" id="item-lng" value="${i.coords_lng||''}" placeholder="-58.23...">
          </div>
        </div>

        ${sectionKey === 'discounts' ? `
          <div class="guide-field-row">
            <div>
              <div class="guide-field-label">Descuento</div>
              <input class="guide-input" type="text" id="item-discount" value="${esc(extra.discount||'')}" placeholder="Ej: 10% off">
            </div>
            <div>
              <div class="guide-field-label">Válido hasta</div>
              <input class="guide-input" type="date" id="item-valid-until" value="${esc(extra.valid_until||'')}">
            </div>
          </div>
          <div class="guide-field-label">Condiciones</div>
          <input class="guide-input" type="text" id="item-conditions" value="${esc(extra.conditions||'')}" placeholder="Presentar la guía en caja">
        ` : ''}

        ${sectionKey === 'visit' ? `
          <div class="guide-field-row">
            <div>
              <div class="guide-field-label">Horarios</div>
              <input class="guide-input" type="text" id="item-schedule" value="${esc(extra.schedule||'')}" placeholder="9 a 18 hs">
            </div>
            <div>
              <div class="guide-field-label">Precio de entrada</div>
              <input class="guide-input" type="text" id="item-price" value="${esc(extra.price||'')}" placeholder="Ej: $2000 / Gratuito">
            </div>
          </div>
        ` : ''}

        <div class="guide-field-label">Foto</div>
        <div class="guide-img-upload" id="guide-img-upload-wrap">
          ${i.photo_url ? `<img src="${esc(i.photo_url)}" class="guide-img-preview" id="guide-img-preview">` : '<div class="guide-img-preview" id="guide-img-preview" style="display:none"></div>'}
          <input type="file" id="item-photo" accept="image/*" class="guide-file-input">
          <label for="item-photo" class="guide-upload-btn">📷 Subir foto</label>
          <span class="guide-upload-hint">JPG, PNG · recomendado 800×500</span>
        </div>

        <input type="hidden" id="item-photo-url" value="${esc(i.photo_url||'')}">
        <input type="hidden" id="item-editing-id" value="${esc(i.id||'')}">

        <div class="guide-form-actions">
          <button class="btn btn-outline btn-sm" id="guide-cancel-item">Cancelar</button>
          <button class="btn btn-primary btn-sm" id="guide-save-item">Guardar</button>
        </div>
      </div>`;
  }

  _renderFaqEditor() {
    const faqs = this._faqs;
    return `
      <div class="guide-items-list" id="guide-faqs-list">
        ${faqs.length === 0 ? '<div class="guide-empty-items">Sin preguntas. Agregá la primera.</div>' : ''}
        ${faqs.map(f => `
          <div class="guide-faq-row" data-id="${f.id}">
            <div class="guide-item-info">
              <div class="guide-item-name">${esc(f.question)}</div>
              <div class="guide-item-sub">${esc(f.answer.slice(0,80))}${f.answer.length > 80 ? '...' : ''}</div>
            </div>
            <div class="guide-item-actions">
              <button class="btn btn-outline btn-sm guide-edit-faq" data-id="${f.id}">✏️</button>
              <button class="btn btn-outline btn-sm guide-delete-faq" data-id="${f.id}">🗑</button>
            </div>
          </div>`).join('')}
      </div>
      <button class="guide-add-btn" id="guide-add-faq">+ Agregar pregunta</button>
      <div class="guide-item-form hidden" id="guide-faq-form">
        <div class="guide-item-form-inner">
          <div class="guide-field-label">Pregunta *</div>
          <input class="guide-input" type="text" id="faq-question" placeholder="¿Pregunta frecuente?">
          <div class="guide-field-label">Respuesta *</div>
          <textarea class="guide-textarea" id="faq-answer" placeholder="Respuesta clara y concisa..."></textarea>
          <input type="hidden" id="faq-editing-id">
          <div class="guide-form-actions">
            <button class="btn btn-outline btn-sm" id="guide-cancel-faq">Cancelar</button>
            <button class="btn btn-primary btn-sm" id="guide-save-faq">Guardar</button>
          </div>
        </div>
      </div>`;
  }

  _bindEditor(key, panel) {
    // Save section title/icon
    panel.querySelector('.guide-sec-save-btn')?.addEventListener('click', async () => {
      const id    = panel.querySelector('.guide-sec-save-btn').dataset.id;
      const title = panel.querySelector('input[data-id]')?.value;
      const icon  = panel.querySelector('.guide-icon-picker')?.value;
      if (!title) return;
      await this.svc.updateSection(id, { title, icon });
      const sec = this._sections.find(s => s.id === id);
      if (sec) { sec.title = title; sec.icon = icon; }
      showToast('Sección actualizada ✓', 'success');
      document.querySelectorAll(`[data-id="${id}"] .guide-sec-title`).forEach(el => el.textContent = title);
    });

    if (key === 'faq') {
      this._bindFaqEditor(panel);
    } else if (!['quickinfo','contact','howtoget','weather'].includes(key)) {
      this._bindItemsEditor(key, panel);
    }
  }

  _bindItemsEditor(sectionKey, panel) {
    const items = this._items.filter(i => i.section_key === sectionKey);
    const showCats    = sectionKey === 'places';
    const showRule    = sectionKey === 'rules';

    panel.querySelector('#guide-add-item')?.addEventListener('click', () => {
      this._editingItem = null;
      const form = panel.querySelector('#guide-item-form');
      form.innerHTML = this._renderItemForm(sectionKey, null, showCats, showRule);
      form.classList.remove('hidden');
      this._bindItemForm(sectionKey, panel, form);
    });

    panel.querySelectorAll('.guide-edit-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = this._items.find(i => i.id === btn.dataset.id);
        if (!item) return;
        this._editingItem = item;
        const form = panel.querySelector('#guide-item-form');
        form.innerHTML = this._renderItemForm(sectionKey, item, showCats, showRule);
        form.classList.remove('hidden');
        this._bindItemForm(sectionKey, panel, form);
      });
    });

    panel.querySelectorAll('.guide-delete-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este elemento?')) return;
        await this.svc.deleteItem(btn.dataset.id);
        this._items = this._items.filter(i => i.id !== btn.dataset.id);
        btn.closest('.guide-item-row').remove();
        showToast('Eliminado ✓', 'success');
      });
    });
  }

  _bindItemForm(sectionKey, panel, form) {
    // Image preview
    form.querySelector('#item-photo')?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const prev = form.querySelector('#guide-img-preview');
        prev.src = ev.target.result;
        prev.style.display = 'block';
        prev.tagName !== 'IMG' && (prev.outerHTML = `<img src="${ev.target.result}" class="guide-img-preview" id="guide-img-preview">`);
      };
      reader.readAsDataURL(file);
    });

    form.querySelector('#guide-cancel-item')?.addEventListener('click', () => form.classList.add('hidden'));

    form.querySelector('#guide-save-item')?.addEventListener('click', async () => {
      const name = form.querySelector('#item-name')?.value?.trim();
      if (!name) { showToast('El nombre es obligatorio', 'error'); return; }

      const btn = form.querySelector('#guide-save-item');
      btn.disabled = true; btn.textContent = 'Guardando...';

      try {
        // Upload image if selected
        const fileInput = form.querySelector('#item-photo');
        let photoUrl = form.querySelector('#item-photo-url')?.value || '';
        if (fileInput?.files?.length) {
          photoUrl = await this.svc.uploadImage(fileInput.files[0]);
        }

        const extra = {};
        const discount    = form.querySelector('#item-discount')?.value;
        const validUntil  = form.querySelector('#item-valid-until')?.value;
        const conditions  = form.querySelector('#item-conditions')?.value;
        const schedule    = form.querySelector('#item-schedule')?.value;
        const price       = form.querySelector('#item-price')?.value;
        const ruleType    = form.querySelector('#item-rule-type')?.value;
        if (discount)   extra.discount    = discount;
        if (validUntil) extra.valid_until = validUntil;
        if (conditions) extra.conditions  = conditions;
        if (schedule)   extra.schedule    = schedule;
        if (price)      extra.price       = price;
        if (ruleType)   extra.type        = ruleType;

        const editingId = form.querySelector('#item-editing-id')?.value;
        const payload = {
          id:          editingId || undefined,
          section_key: sectionKey,
          name,
          description: form.querySelector('#item-desc')?.value     || null,
          address:     form.querySelector('#item-address')?.value  || null,
          phone:       form.querySelector('#item-phone')?.value    || null,
          whatsapp:    form.querySelector('#item-whatsapp')?.value || null,
          icon:        form.querySelector('#item-icon')?.value     || null,
          category:    form.querySelector('#item-category')?.value || null,
          coords_lat:  parseFloat(form.querySelector('#item-lat')?.value) || null,
          coords_lng:  parseFloat(form.querySelector('#item-lng')?.value) || null,
          photo_url:   photoUrl || null,
          extra_json:  Object.keys(extra).length ? extra : {},
        };

        const { data } = await this.svc.saveItem(payload);
        const saved = data?.[0] || payload;

        if (editingId) {
          const idx = this._items.findIndex(i => i.id === editingId);
          if (idx >= 0) this._items[idx] = { ...this._items[idx], ...saved };
        } else {
          this._items.push(saved);
        }

        showToast('Guardado ✓', 'success');
        form.classList.add('hidden');
        // Refresh list
        const list = panel.querySelector('#guide-items-list');
        if (list) {
          list.innerHTML = this._items.filter(i => i.section_key === sectionKey).map(i => this._renderItemRow(i)).join('');
          this._bindItemsEditor(sectionKey, panel);
        }
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
      btn.disabled = false; btn.textContent = 'Guardar';
    });
  }

  _bindFaqEditor(panel) {
    panel.querySelector('#guide-add-faq')?.addEventListener('click', () => {
      const form = panel.querySelector('#guide-faq-form');
      form.querySelector('#faq-question').value = '';
      form.querySelector('#faq-answer').value   = '';
      form.querySelector('#faq-editing-id').value = '';
      form.classList.remove('hidden');
    });

    panel.querySelectorAll('.guide-edit-faq').forEach(btn => {
      btn.addEventListener('click', () => {
        const faq = this._faqs.find(f => f.id === btn.dataset.id);
        if (!faq) return;
        const form = panel.querySelector('#guide-faq-form');
        form.querySelector('#faq-question').value    = faq.question;
        form.querySelector('#faq-answer').value      = faq.answer;
        form.querySelector('#faq-editing-id').value  = faq.id;
        form.classList.remove('hidden');
      });
    });

    panel.querySelectorAll('.guide-delete-faq').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta pregunta?')) return;
        await this.svc.deleteFaq(btn.dataset.id);
        this._faqs = this._faqs.filter(f => f.id !== btn.dataset.id);
        btn.closest('.guide-faq-row').remove();
        showToast('Pregunta eliminada ✓', 'success');
      });
    });

    panel.querySelector('#guide-cancel-faq')?.addEventListener('click', () => {
      panel.querySelector('#guide-faq-form').classList.add('hidden');
    });

    panel.querySelector('#guide-save-faq')?.addEventListener('click', async () => {
      const q  = panel.querySelector('#faq-question')?.value?.trim();
      const a  = panel.querySelector('#faq-answer')?.value?.trim();
      const id = panel.querySelector('#faq-editing-id')?.value;
      if (!q || !a) { showToast('Pregunta y respuesta son obligatorias', 'error'); return; }
      const payload = { question: q, answer: a };
      if (id) payload.id = id;
      const { data } = await this.svc.saveFaq(payload);
      const saved = data?.[0] || { ...payload, id: id || Date.now().toString() };
      if (id) {
        const idx = this._faqs.findIndex(f => f.id === id);
        if (idx >= 0) this._faqs[idx] = saved;
      } else {
        this._faqs.push(saved);
      }
      showToast('Pregunta guardada ✓', 'success');
      panel.querySelector('#guide-faq-form').classList.add('hidden');
      panel.querySelector('#guide-faqs-list').innerHTML = this._faqs.map(f => `
        <div class="guide-faq-row" data-id="${f.id}">
          <div class="guide-item-info">
            <div class="guide-item-name">${esc(f.question)}</div>
            <div class="guide-item-sub">${esc(f.answer.slice(0,80))}</div>
          </div>
          <div class="guide-item-actions">
            <button class="btn btn-outline btn-sm guide-edit-faq" data-id="${f.id}">✏️</button>
            <button class="btn btn-outline btn-sm guide-delete-faq" data-id="${f.id}">🗑</button>
          </div>
        </div>`).join('');
      this._bindFaqEditor(panel);
    });
  }

  // ── CONFIG TAB ────────────────────────────────────────
  _renderConfig() {
    const c = this._cfg;
    return `
      <div class="guide-config-grid">
        <div class="guide-config-section">
          <div class="guide-config-title">🏨 Datos del complejo</div>
          <div class="guide-field-label">Nombre del complejo</div>
          <input class="guide-input" id="cfg-hotel-name" value="${esc(c.hotel_name||'')}">
          <div class="guide-field-label">Texto de bienvenida</div>
          <textarea class="guide-textarea" id="cfg-welcome">${esc(c.welcome_text||'')}</textarea>
          <div class="guide-field-label">Dirección completa</div>
          <input class="guide-input" id="cfg-address" value="${esc(c.address||'')}">
          <div class="guide-field-row">
            <div>
              <div class="guide-field-label">Latitud</div>
              <input class="guide-input" id="cfg-lat" type="number" step="0.0001" value="${c.coords_lat||''}">
            </div>
            <div>
              <div class="guide-field-label">Longitud</div>
              <input class="guide-input" id="cfg-lng" type="number" step="0.0001" value="${c.coords_lng||''}">
            </div>
          </div>
          <div class="guide-field-label">URL embed Google Maps (opcional)</div>
          <input class="guide-input" id="cfg-maps-embed" value="${esc(c.maps_embed_url||'')}" placeholder="https://www.google.com/maps/embed?...">
        </div>

        <div class="guide-config-section">
          <div class="guide-config-title">📞 Contacto</div>
          <div class="guide-field-label">WhatsApp (solo números con código de país)</div>
          <input class="guide-input" id="cfg-whatsapp" value="${esc(c.whatsapp||'')}" placeholder="5493468XXXXXX">
          <div class="guide-field-label">Teléfono</div>
          <input class="guide-input" id="cfg-phone" value="${esc(c.phone||'')}">
          <div class="guide-field-label">Email</div>
          <input class="guide-input" id="cfg-email" type="email" value="${esc(c.email||'')}">
          <div class="guide-field-label">Instagram URL</div>
          <input class="guide-input" id="cfg-instagram" value="${esc(c.instagram_url||'')}" placeholder="https://instagram.com/...">
        </div>

        <div class="guide-config-section">
          <div class="guide-config-title">📶 Wi-Fi</div>
          <div class="guide-field-label">Nombre de la red (SSID)</div>
          <input class="guide-input" id="cfg-wifi-ssid" value="${esc(c.wifi_ssid||'')}">
          <div class="guide-field-label">Contraseña</div>
          <input class="guide-input" id="cfg-wifi-pwd" value="${esc(c.wifi_password||'')}">
        </div>

        <div class="guide-config-section">
          <div class="guide-config-title">⏰ Horarios</div>
          <div class="guide-field-row">
            <div>
              <div class="guide-field-label">Check-in</div>
              <input class="guide-input" id="cfg-checkin" value="${esc(c.checkin_time||'14:00')}" placeholder="14:00">
            </div>
            <div>
              <div class="guide-field-label">Check-out</div>
              <input class="guide-input" id="cfg-checkout" value="${esc(c.checkout_time||'10:00')}" placeholder="10:00">
            </div>
          </div>
          <div class="guide-field-label">Horario de recepción</div>
          <input class="guide-input" id="cfg-reception" value="${esc(c.reception_hours||'')}" placeholder="8:00 a 22:00">
          <div class="guide-field-label">Horario atención WhatsApp</div>
          <input class="guide-input" id="cfg-wapp-hours" value="${esc(c.whatsapp_hours||'')}" placeholder="9:00 a 20:00">
        </div>

        <div class="guide-config-actions">
          <button class="btn btn-primary" id="guide-save-config">💾 Guardar configuración</button>
        </div>
      </div>`;
  }

  _bindConfig(content, container) {
    content.querySelector('#guide-save-config')?.addEventListener('click', async () => {
      const btn = content.querySelector('#guide-save-config');
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        const payload = {
          hotel_name:     content.querySelector('#cfg-hotel-name')?.value  || null,
          welcome_text:   content.querySelector('#cfg-welcome')?.value     || null,
          address:        content.querySelector('#cfg-address')?.value     || null,
          coords_lat:     parseFloat(content.querySelector('#cfg-lat')?.value)  || null,
          coords_lng:     parseFloat(content.querySelector('#cfg-lng')?.value)  || null,
          maps_embed_url: content.querySelector('#cfg-maps-embed')?.value  || null,
          whatsapp:       content.querySelector('#cfg-whatsapp')?.value    || null,
          phone:          content.querySelector('#cfg-phone')?.value       || null,
          email:          content.querySelector('#cfg-email')?.value       || null,
          instagram_url:  content.querySelector('#cfg-instagram')?.value   || null,
          wifi_ssid:      content.querySelector('#cfg-wifi-ssid')?.value   || null,
          wifi_password:  content.querySelector('#cfg-wifi-pwd')?.value    || null,
          checkin_time:   content.querySelector('#cfg-checkin')?.value     || null,
          checkout_time:  content.querySelector('#cfg-checkout')?.value    || null,
          reception_hours:content.querySelector('#cfg-reception')?.value   || null,
          whatsapp_hours: content.querySelector('#cfg-wapp-hours')?.value  || null,
        };
        await this.svc.saveConfig(payload);
        this._cfg = { ...this._cfg, ...payload };
        showToast('Configuración guardada ✓', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
      btn.disabled = false; btn.textContent = '💾 Guardar configuración';
    });
  }

  // ── APPEARANCE TAB ────────────────────────────────────
  _renderAppearance() {
    const c = this._cfg;
    return `
      <div class="guide-config-grid">
        <div class="guide-config-section">
          <div class="guide-config-title">🎨 Colores</div>
          <div class="guide-field-label">Color principal</div>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="color" id="cfg-color" value="${c.primary_color || '#1e40af'}" style="width:48px;height:36px;border:none;border-radius:6px;cursor:pointer">
            <input class="guide-input" id="cfg-color-text" value="${c.primary_color || '#1e40af'}" style="width:120px">
          </div>
        </div>
        <div class="guide-config-section">
          <div class="guide-config-title">🖼 Imágenes</div>
          <div class="guide-field-label">Foto de portada (Hero)</div>
          ${c.cover_url ? `<img src="${esc(c.cover_url)}" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;margin-bottom:8px">` : ''}
          <input type="file" id="cfg-cover-file" accept="image/*" class="guide-file-input">
          <label for="cfg-cover-file" class="guide-upload-btn">📷 Subir foto de portada</label>
          <div class="guide-field-label" style="margin-top:16px">Logo del complejo</div>
          ${c.logo_url ? `<img src="${esc(c.logo_url)}" style="width:60px;height:60px;object-fit:contain;border-radius:8px;margin-bottom:8px;background:#f1f5f9;padding:4px">` : ''}
          <input type="file" id="cfg-logo-file" accept="image/*" class="guide-file-input">
          <label for="cfg-logo-file" class="guide-upload-btn">🏨 Subir logo</label>
        </div>
        <div class="guide-config-actions">
          <button class="btn btn-primary" id="guide-save-appearance">💾 Guardar apariencia</button>
        </div>
      </div>`;
  }

  _bindAppearance(content, container) {
    content.querySelector('#cfg-color')?.addEventListener('input', e => {
      content.querySelector('#cfg-color-text').value = e.target.value;
    });
    content.querySelector('#guide-save-appearance')?.addEventListener('click', async () => {
      const btn = content.querySelector('#guide-save-appearance');
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        const payload = { primary_color: content.querySelector('#cfg-color-text')?.value || '#1e40af' };

        const coverFile = content.querySelector('#cfg-cover-file')?.files?.[0];
        if (coverFile) payload.cover_url = await this.svc.uploadImage(coverFile, 'guide/covers');

        const logoFile = content.querySelector('#cfg-logo-file')?.files?.[0];
        if (logoFile) payload.logo_url = await this.svc.uploadImage(logoFile, 'guide/logos');

        await this.svc.saveConfig(payload);
        this._cfg = { ...this._cfg, ...payload };
        showToast('Apariencia guardada ✓', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
      btn.disabled = false; btn.textContent = '💾 Guardar apariencia';
    });
  }

  // ── STATS TAB ─────────────────────────────────────────
  async _loadStats(content) {
    try {
      const stats = await this.svc.getViewStats();
      content.innerHTML = `
        <div class="guide-stats-grid">
          <div class="guide-stat-card">
            <div class="guide-stat-num">${stats.total}</div>
            <div class="guide-stat-lbl">Visitas últimos 30 días</div>
          </div>
        </div>
        <div class="guide-config-section" style="margin-top:16px">
          <div class="guide-config-title">Secciones más vistas</div>
          ${Object.entries(stats.bySection).sort((a,b) => b[1]-a[1]).slice(0,10).map(([k,v]) =>
            `<div class="guide-stat-row-item"><span>${k}</span><strong>${v}</strong></div>`
          ).join('') || '<p style="color:#64748b;font-size:.82rem">Sin datos aún.</p>'}
        </div>`;
    } catch { content.innerHTML = '<div class="empty-state">Error al cargar estadísticas.</div>'; }
  }

  // ── QR TAB ────────────────────────────────────────────
  _renderQR(container) {
    const url = `${window.location.origin}/guia`;
    return `
      <div class="guide-qr-panel">
        <div class="guide-config-section">
          <div class="guide-config-title">🖨 Código QR de la guía</div>
          <p style="font-size:.82rem;color:#64748b;margin-bottom:16px">Imprimí este QR y colocalo en cada departamento para que los huéspedes accedan a la guía fácilmente.</p>
          <div style="text-align:center">
            <canvas id="guide-qr-canvas" style="border-radius:12px;background:#fff;padding:12px"></canvas>
          </div>
          <div style="font-size:.75rem;color:#64748b;text-align:center;margin:10px 0;font-family:monospace">${esc(url)}</div>
          <div class="guide-form-actions">
            <button class="btn btn-primary" id="guide-qr-download">⬇ Descargar PNG</button>
            <button class="btn btn-outline" onclick="window.print()">🖨 Imprimir</button>
          </div>
        </div>
      </div>`;
  }

  _initQR(content) {
    const url = `${window.location.origin}/guia`;
    // Dynamic import of qrcode library
    import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js').then(() => {
      const canvas = content.querySelector('#guide-qr-canvas');
      if (canvas && window.QRCode) {
        window.QRCode.toCanvas(canvas, url, { width: 220, margin: 2, color: { dark: '#1e293b' } });
        content.querySelector('#guide-qr-download')?.addEventListener('click', () => {
          const a = document.createElement('a');
          a.download = 'qr-guia-huespedes.png';
          a.href = canvas.toDataURL();
          a.click();
        });
      }
    }).catch(() => {
      content.querySelector('#guide-qr-canvas').insertAdjacentHTML('afterend', `<p style="color:#64748b;font-size:.82rem">No se pudo cargar el generador de QR. Intentá de nuevo.</p>`);
    });
  }

  // ── Utilities ─────────────────────────────────────────
  _setLoading(container, show) {
    const el = container?.querySelector('#guide-loading');
    if (el) el.style.display = show ? 'flex' : 'none';
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
