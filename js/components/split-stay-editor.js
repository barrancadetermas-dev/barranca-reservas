// ══════════════════════════════════════════════════════════════
// split-stay-editor.js — Editor de tramos de UNA reserva
//
// "2 noches en el Depto 2 y 1 noche en el Depto 5" dentro de la misma
// reserva. Solo gestiona el estado y la pantalla del cambio de depto;
// guardar, precios globales y validación final siguen en booking-form.js.
//
// Los tramos son SECUENCIALES por construcción: cada uno empieza donde
// termina el anterior, así que no pueden quedar huecos ni superposiciones
// dentro de la reserva. Un depto no puede repetirse (restricción de base).
//
// Dos vistas del mismo estado:
//   • structureEl (paso 2): quién y hasta cuándo
//   • priceEl     (paso 3): precio por noche de cada tramo
// ══════════════════════════════════════════════════════════════

import { addDays, nightsBetween, validateSegments } from '../services/stay-segments.js';
import { escapeHtml as esc } from '../services/voucher-template.js';

const MAX_SEGMENTS = 4;
const fmtDM  = iso => iso.split('-').reverse().slice(0, 2).join('/');
const fmtARS = n => '$' + Math.round(n || 0).toLocaleString('es-AR');
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

export class SplitStayEditor {
  /**
   * @param {object} o
   * @param {HTMLElement} o.structureEl  contenedor del paso 2
   * @param {HTMLElement} o.priceEl      contenedor del paso 3
   * @param {()=>Array} o.getUnits       unidades [{id,name,sort_order,color,max_guests}]
   * @param {(segments:Array)=>Promise<Array>} o.checkConflicts  devuelve choques (availability-service)
   * @param {(segments:Array)=>void} o.onChange                  avisa cada cambio de estado
   * @param {(msg:string,type?:string)=>void} o.toast
   */
  constructor({ structureEl, priceEl, getUnits, checkConflicts, onChange, toast }) {
    this.structureEl = structureEl;
    this.priceEl     = priceEl;
    this.getUnits    = getUnits;
    this.checkConflicts = checkConflicts;
    this.onChange    = onChange ?? (() => {});
    this.toast       = toast ?? (() => {});
    this._reset();
    this._bind();
  }

  _reset() {
    this.active = false;
    this.ci = null; this.co = null;
    this.rows = [];    // [{ unit_id, price }]
    this.bounds = [];  // fechas de cambio, una menos que rows
    this.conflicts = new Map(); // unit_id -> texto
    this._seq = 0;
    this._timer = null;
    this._autoPickFreeUnit = false;
  }

  // ── API pública ───────────────────────────────────
  /** Tramos actuales: [{unit_id, from, to, nights, pricePerNight}] */
  getSegments() {
    if (!this.active) return [];
    return this.rows.map((r, i) => {
      const from = i === 0 ? this.ci : this.bounds[i - 1];
      const to   = i === this.rows.length - 1 ? this.co : this.bounds[i];
      return { unit_id: String(r.unit_id), from, to, nights: nightsBetween(from, to),
               pricePerNight: parseFloat(r.price) > 0 ? parseFloat(r.price) : null };
    });
  }

  validate() {
    if (!this.active) return { ok: true, errors: [] };
    const res = validateSegments({ check_in: this.ci, check_out: this.co }, this.getSegments());
    if (res.ok && this.getSegments().some(s => !(s.pricePerNight > 0))) {
      return { ok: false, errors: ['Ingresá el precio por noche de cada tramo'] };
    }
    if (res.ok && this.conflicts.size) {
      return { ok: false, errors: ['Hay un departamento ocupado en su tramo: elegí otro'] };
    }
    return res;
  }

  /**
   * Activa el modo cambio de depto.
   * @param {{checkIn:string, checkOut:string, segments?:Array, firstUnitId?:string, price?:number}} o
   * @returns {boolean} false si no se pudo (ej. menos de 2 noches)
   */
  activate({ checkIn, checkOut, segments = null, firstUnitId = null, price = 0 }) {
    if (!checkIn || !checkOut || nightsBetween(checkIn, checkOut) < 2) {
      this.toast('Para cambiar de departamento hacen falta al menos 2 noches', 'warning');
      return false;
    }
    this.ci = checkIn; this.co = checkOut;
    const units = this.getUnits();

    if (segments?.length >= 2) {
      this.rows   = segments.map(s => ({ unit_id: String(s.unit_id), price: s.pricePerNight ?? price ?? '' }));
      this.bounds = segments.slice(0, -1).map(s => s.to);
    } else {
      const first  = String(firstUnitId ?? units[0]?.id ?? '');
      const second = String(units.find(u => String(u.id) !== first)?.id ?? '');
      if (!first || !second) { this.toast('Necesitás al menos 2 departamentos configurados', 'warning'); return false; }
      const n = nightsBetween(checkIn, checkOut);
      this.rows   = [{ unit_id: first, price: price || '' }, { unit_id: second, price: price || '' }];
      this.bounds = [addDays(checkIn, Math.ceil(n / 2))];
      this._autoPickFreeUnit = true;
    }
    this.active = true;
    this.render();
    this._emit();
    return true;
  }

  /** Vuelve a un solo depto. @returns {string|null} el depto del primer tramo */
  deactivate({ silent = false } = {}) {
    const first = this.rows[0]?.unit_id ?? null;
    clearTimeout(this._timer);
    this._reset();
    this.structureEl && (this.structureEl.innerHTML = '');
    this.priceEl && (this.priceEl.innerHTML = '');
    if (!silent) this.onChange([]);
    return first;
  }

  /** Las fechas de la reserva cambiaron: los extremos las siguen y los cortes se acomodan. */
  setWindow(ci, co) {
    if (!this.active) return;
    if (!ci || !co || nightsBetween(ci, co) < this.rows.length) {
      this.toast('Con esas fechas ya no alcanzan las noches para cambiar de departamento: se volvió a un solo depto', 'warning');
      const first = this.deactivate({ silent: true });
      this.onChange([], { exitedTo: first });
      return;
    }
    this.ci = ci; this.co = co;
    // Cada corte tiene que quedar estrictamente dentro y en orden creciente
    let prev = ci;
    this.bounds = this.bounds.map((b, i) => {
      const remaining = this.rows.length - 1 - i;          // cortes que faltan después de este
      const minB = addDays(prev, 1), maxB = addDays(co, -(remaining + 1));
      const v = b < minB ? minB : b > maxB ? maxB : b;
      prev = v; return v;
    });
    this.render();
    this._emit();
  }

  // ── Eventos ───────────────────────────────────────
  _bind() {
    const onClick = (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !this.active) return;
      const act = btn.dataset.act, i = +btn.dataset.i;
      if (act === 'remove') { const first = this.deactivate({ silent: true }); this.onChange([], { exitedTo: first }); }
      else if (act === 'add')  this._addRow();
      else if (act === 'del')  this._delRow(i);
      else if (act === 'same-price') this._samePrice();
    };
    const onInput = (e) => {
      if (!this.active) return;
      const el = e.target, i = +el.dataset.i;
      if (el.dataset.field === 'unit')  { this.rows[i].unit_id = el.value; this._afterStructure(); }
      else if (el.dataset.field === 'bound' && e.type === 'change') this._setBound(i, el.value);
      else if (el.dataset.field === 'price') {
        this.rows[i].price = el.value;
        this._refreshPriceTotals();
        this._emit();
      }
    };
    [this.structureEl, this.priceEl].forEach(el => {
      el?.addEventListener('click', onClick);
      el?.addEventListener('change', onInput);
      el?.addEventListener('input', onInput);
    });
  }

  _setBound(i, value) {
    const min = addDays(i === 0 ? this.ci : this.bounds[i - 1], 1);
    const max = addDays(i === this.bounds.length - 1 ? this.co : this.bounds[i + 1], -1);
    if (!value || value < min || value > max) {
      this.toast(`El cambio debe ser entre el ${fmtDM(min)} y el ${fmtDM(max)}`, 'warning');
      this.render(); return;
    }
    this.bounds[i] = value;
    this._afterStructure();
  }

  _addRow() {
    const units = this.getUnits();
    if (this.rows.length >= Math.min(MAX_SEGMENTS, units.length)) { this.toast('No hay más departamentos para agregar', 'warning'); return; }
    const lastStart = this.bounds[this.bounds.length - 1];
    if (nightsBetween(lastStart, this.co) < 2) { this.toast('El último tramo ya es de 1 noche', 'warning'); return; }
    const used = new Set(this.rows.map(r => String(r.unit_id)));
    const free = units.find(u => !used.has(String(u.id)));
    this.bounds.push(addDays(this.co, -1));
    this.rows.push({ unit_id: String(free.id), price: this.rows[this.rows.length - 1].price });
    this._afterStructure();
  }

  _delRow(i) {
    if (this.rows.length <= 2) return;
    this.rows.splice(i, 1);
    this.bounds.splice(Math.max(0, i - 1), 1); // el tramo vecino absorbe las noches
    this._afterStructure();
  }

  _samePrice() {
    const p = this.rows.find(r => parseFloat(r.price) > 0)?.price ?? '';
    this.rows.forEach(r => { r.price = p; });
    this.render(); this._emit();
  }

  _afterStructure() {
    this.render();
    this._emit();
  }

  // ── Disponibilidad por tramo (con sugerencia de depto libre) ──
  _emit() {
    this.onChange(this.getSegments());
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._refreshConflicts(), 250);
  }

  async _refreshConflicts() {
    if (!this.active) return;
    const seq = ++this._seq;
    try {
      // Al activarse solo, elegir como 2º depto uno que esté libre en su tramo
      if (this._autoPickFreeUnit) {
        this._autoPickFreeUnit = false;
        const segs = this.getSegments();
        const second = segs[1];
        const taken = new Set([String(segs[0].unit_id)]);
        const candidates = this.getUnits().filter(u => !taken.has(String(u.id)));
        const clashes = await this.checkConflicts(candidates.map(u => ({ unit_id: String(u.id), from: second.from, to: second.to })));
        if (seq !== this._seq || !this.active) return;
        const busy = new Set(clashes.map(c => c.unit_id));
        const pick = candidates.find(u => !busy.has(String(u.id)));
        if (pick && String(pick.id) !== String(this.rows[1].unit_id)) {
          this.rows[1].unit_id = String(pick.id);
          this.render(); this.onChange(this.getSegments());
        }
      }
      const clashes = await this.checkConflicts(this.getSegments());
      if (seq !== this._seq || !this.active) return;
      this.conflicts = new Map(clashes.map(c =>
        [c.unit_id, `${c.guestName} (${fmtDM(c.from)} → ${fmtDM(c.to)})`]));
      this._paintConflicts();
      this.onChange(this.getSegments());
    } catch (err) {
      console.warn('[SplitStay] no se pudo verificar disponibilidad:', err);
    }
  }

  _paintConflicts() {
    this.structureEl?.querySelectorAll('.split-avail').forEach(el => {
      const uid = this.rows[+el.dataset.i]?.unit_id;
      const clash = this.conflicts.get(String(uid));
      el.className = 'split-avail ' + (clash ? 'busy' : 'free');
      el.textContent = clash ? `⚠ Ocupado por ${clash}` : '✓ Libre';
    });
    const msg = this.structureEl?.querySelector('.split-msg');
    if (msg) msg.textContent = this.conflicts.size ? 'Elegí otro departamento o ajustá la fecha del cambio.' : '';
  }

  // ── Render ────────────────────────────────────────
  render() {
    if (!this.active) return;
    this._renderStructure();
    this._renderPrices();
  }

  _unitOptions(selectedId, i) {
    const usedElsewhere = new Set(this.rows.filter((_, k) => k !== i).map(r => String(r.unit_id)));
    return this.getUnits().map(u => {
      const disabled = usedElsewhere.has(String(u.id));
      return `<option value="${esc(u.id)}" ${String(u.id) === String(selectedId) ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(u.name)}</option>`;
    }).join('');
  }

  _renderStructure() {
    if (!this.structureEl) return;
    const segs = this.getSegments();
    const units = this.getUnits();
    const canAdd = this.rows.length < Math.min(MAX_SEGMENTS, units.length);
    const totalN = nightsBetween(this.ci, this.co);

    this.structureEl.innerHTML = `
      <div class="split-editor">
        <div class="split-head">
          <div><strong>🔀 Cambio de departamento</strong>
            <span class="split-sub">una sola reserva · ${plural(totalN, 'noche', 'noches')} en total</span></div>
          <button type="button" class="btn btn-ghost btn-sm" data-act="remove">Volver a un solo depto</button>
        </div>
        ${segs.map((s, i) => {
          const last = i === segs.length - 1;
          const color = units.find(u => String(u.id) === s.unit_id)?.color ?? '#6366f1';
          // El corte de este tramo debe dejar al menos 1 noche al tramo siguiente
          // (el último tramo no tiene corte propio: termina en el check-out)
          const min = last ? null : addDays(s.from, 1);
          const max = last ? null : addDays(i === this.bounds.length - 1 ? this.co : this.bounds[i + 1], -1);
          return `
          <div class="split-row" style="--split-color:${esc(color)}">
            <span class="split-n">${i + 1}</span>
            <select class="form-input split-unit" data-field="unit" data-i="${i}" aria-label="Departamento del tramo ${i + 1}">${this._unitOptions(s.unit_id, i)}</select>
            <div class="split-dates">
              <span>${esc(fmtDM(s.from))}</span><span class="split-arrow">→</span>
              ${last
                ? `<span>${esc(fmtDM(s.to))}</span>`
                : `<input type="date" class="form-input split-bound" data-field="bound" data-i="${i}" value="${esc(s.to)}" min="${esc(min)}" max="${esc(max)}" aria-label="Fecha del cambio">`}
            </div>
            <span class="split-nights">${plural(s.nights, 'noche', 'noches')}</span>
            ${this.rows.length > 2 ? `<button type="button" class="split-del" data-act="del" data-i="${i}" title="Quitar este tramo" aria-label="Quitar tramo ${i + 1}">×</button>` : '<span></span>'}
            <span class="split-avail" data-i="${i}"></span>
          </div>`;
        }).join('')}
        ${canAdd ? '<button type="button" class="btn btn-outline btn-sm split-add" data-act="add">+ Agregar otro tramo</button>' : ''}
        <div class="split-msg" role="alert"></div>
      </div>`;
    this._paintConflicts();
  }

  _renderPrices() {
    if (!this.priceEl) return;
    const segs = this.getSegments();
    const units = this.getUnits();
    this.priceEl.innerHTML = `
      <div class="split-editor split-prices">
        <div class="split-head">
          <div><strong>Precio por noche, por tramo</strong> <span class="req">*</span></div>
          <button type="button" class="btn btn-outline btn-sm" data-act="same-price" style="font-size:.72rem;padding:3px 9px">Mismo precio en todos</button>
        </div>
        ${segs.map((s, i) => {
          const u = units.find(x => String(x.id) === s.unit_id);
          return `
          <div class="split-row split-price-row" style="--split-color:${esc(u?.color ?? '#6366f1')}">
            <span class="split-n">${i + 1}</span>
            <div class="split-price-name">${esc(u?.name ?? 'Depto')}
              <small>${esc(fmtDM(s.from))} → ${esc(fmtDM(s.to))} · ${plural(s.nights, 'noche', 'noches')}</small></div>
            <input type="number" class="form-input split-price" data-field="price" data-i="${i}" min="0" step="500" placeholder="45000" value="${esc(this.rows[i].price ?? '')}" aria-label="Precio por noche del tramo ${i + 1}">
            <span class="split-sub-total" data-i="${i}">${s.pricePerNight ? fmtARS(s.pricePerNight * s.nights) : '—'}</span>
          </div>`;
        }).join('')}
        <div class="split-total-row"><span>Subtotal alojamiento</span><strong class="split-grand">—</strong></div>
      </div>`;
    this._refreshPriceTotals();
  }

  _refreshPriceTotals() {
    if (!this.priceEl) return;
    const segs = this.getSegments();
    let total = 0, complete = true;
    segs.forEach((s, i) => {
      const el = this.priceEl.querySelector(`.split-sub-total[data-i="${i}"]`);
      if (s.pricePerNight) { total += s.pricePerNight * s.nights; if (el) el.textContent = fmtARS(s.pricePerNight * s.nights); }
      else { complete = false; if (el) el.textContent = '—'; }
    });
    const g = this.priceEl.querySelector('.split-grand');
    if (g) g.textContent = complete ? fmtARS(total) : '—';
  }
}

