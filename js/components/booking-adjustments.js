// ══════════════════════════════════════════════════════════════════════════
// booking-adjustments.js — Lista de AJUSTES de precio del formulario de reservas
//
// Descuentos, recargos, noches sin cargo y late check-out; cada uno para TODA la reserva o para UN depto,
// con su motivo. Se pueden poner varios, editar y borrar. El cálculo vive en services/booking-pricing.js.
// Estos métodos se agregan al prototipo de BookingForm (ver el final de booking-form.js).
// ══════════════════════════════════════════════════════════════════════════
import { ADJUSTMENT_REASONS, ADJUSTMENT_KINDS, reasonOf } from '../services/booking-pricing.js';
import { escapeHtml } from '../services/voucher-template.js';
import { formatARS } from '../supabase-config.js';

const ICON = { free_nights: '🎁', discount: '🏷️', surcharge: '➕', late_checkout: '🌅' };
const KIND_ORDER = ['free_nights', 'discount', 'surcharge', 'late_checkout'];
const KIND_BTN = { free_nights: 'Noches sin cargo', discount: 'Descuento', surcharge: 'Recargo', late_checkout: 'Late check-out' };
const newId = () => 'adj-' + Math.random().toString(36).slice(2, 9);

export const adjustmentsMethods = {
  _adjReset() { this._adjustments = []; this._adjForm = null; },

  /** Texto del valor: "10 %", "$15.000", "1 noche", "$55.000 · se cobra". */
  _adjValueText(a) {
    if (a.kind === 'free_nights') return `${a.value} noche${Number(a.value) === 1 ? '' : 's'}`;
    if (a.kind === 'late_checkout') return a.charged === false ? 'Sin cargo' : formatARS(a.value);
    return a.mode === 'pct' ? `${String(+(+a.value).toFixed(4))} %` : formatARS(a.value);
  },

  _adjTargetName(a) { return a.unitId == null ? 'Toda la reserva' : this._unitLabel(a.unitId); },

  /** Valor por defecto del late check-out: media noche del depto (o de la suma si es de toda la reserva). */
  _adjLateDefault(unitId) {
    const price = unitId != null ? (parseFloat(this._unitPrices?.[unitId]) || 0)
      : (this._isMulti() ? [...this._selectedUnitIds].reduce((s, u) => s + (parseFloat(this._unitPrices?.[u]) || 0), 0) : (parseFloat(document.getElementById('f-price')?.value) || 0));
    return Math.round(price * 0.5);
  },

  _renderAdjustments() {
    const host = document.getElementById('adj-wrap');
    if (!host) return;
    const multi = this._isMulti();
    const ids = multi ? [...this._selectedUnitIds].map(String) : [];
    // ajustes de un depto que ya no está en la reserva: se quitan
    this._adjustments = (this._adjustments ?? []).filter(a => a.unitId == null || (multi && ids.includes(String(a.unitId))));
    const list = this._adjustments;
    const f = this._adjForm;

    const rows = list.map(a => `
      <div class="adj-li" data-id="${a.id}">
        <span class="adj-tp">${ICON[a.kind]} ${ADJUSTMENT_KINDS[a.kind]}</span>
        <span>${a.unitId == null ? '<span class="adj-ch all">Toda la reserva</span>' : `<span class="adj-ch">${escapeHtml(this._unitLabel(a.unitId))}</span>`}</span>
        <span class="adj-val">${escapeHtml(this._adjValueText(a))}</span>
        <span class="adj-mot" title="${escapeHtml(reasonOf(a))}">${reasonOf(a) ? escapeHtml(reasonOf(a)) : '<i>sin motivo</i>'}</span>
        <span class="adj-act"><button type="button" data-adj="edit" title="Editar">✏️</button><button type="button" data-adj="del" title="Borrar">🗑️</button></span>
      </div>`).join('');

    const form = f ? this._adjFormHTML(f, ids) : '';
    host.innerHTML = `
      <div class="adj-hd"><b>Ajustes de precio <span class="adj-n">· ${list.length}</span></b>
        ${f ? '' : '<button type="button" class="adj-add" data-adj="add">＋ Agregar ajuste</button>'}</div>
      ${list.length ? `<div class="adj-list"><div class="adj-li adj-h"><span>Tipo</span><span>Se aplica a</span><span>Valor</span><span>Motivo</span><span></span></div>${rows}</div>`
        : (f ? '' : '<div class="adj-empty">Sin ajustes. Podés agregar descuentos, recargos, noches sin cargo o late check-out, cada uno con su motivo.</div>')}
      ${multi && list.some(a => a.kind === 'discount') ? '<div class="adj-note">Varios descuentos de un mismo depto se suman (los % se suman; los montos fijos se convierten a % y se suman).</div>' : ''}
      ${form}`;
    this._adjBind(host, ids);
  },

  _adjFormHTML(f, ids) {
    const multi = ids.length > 1;
    const sym = f.mode === 'pct' ? '%' : '$';
    const valueBlock = f.kind === 'free_nights'
      ? `<div class="adj-vrow"><input type="number" id="adj-value" min="1" step="1" value="${f.value ?? ''}" placeholder="1"><span class="adj-unit">noches</span></div>`
      : f.kind === 'late_checkout'
        ? `<div class="adj-vrow"><span class="adj-unit">$</span><input type="number" id="adj-value" min="0" step="500" value="${f.value ?? ''}" placeholder="${this._adjLateDefault(f.unitId)} (½ noche)">
             <label class="adj-chk"><input type="checkbox" id="adj-charged" ${f.charged === false ? '' : 'checked'}> Se cobra</label></div>`
        : `<div class="adj-vrow"><input type="number" id="adj-value" min="0" step="${f.mode === 'pct' ? '0.5' : '500'}" ${f.mode === 'pct' ? 'max="100"' : ''} value="${f.value ?? ''}" placeholder="0">
             <span class="adj-seg"><button type="button" data-mode="pct" class="${f.mode === 'pct' ? 'on' : ''}">%</button><button type="button" data-mode="amt" class="${f.mode === 'amt' ? 'on' : ''}">$</button></span></div>`;
    void sym;
    return `<div class="adj-form" id="adj-form">
      <div class="adj-fr">
        <div><label>TIPO</label><div class="adj-seg adj-kinds">${KIND_ORDER.map(k => `<button type="button" data-kind="${k}" class="${f.kind === k ? 'on' : ''}">${ICON[k]} ${KIND_BTN[k]}</button>`).join('')}</div></div>
        ${multi ? `<div><label>SE APLICA A</label><select id="adj-target"><option value="">Toda la reserva</option>${ids.map(u => `<option value="${u}" ${String(f.unitId) === u ? 'selected' : ''}>${escapeHtml(this._unitLabel(u))}</option>`).join('')}</select></div>` : ''}
        <div><label>VALOR</label>${valueBlock}</div>
      </div>
      <div><label>MOTIVO <span class="adj-opt">(opcional · se muestra en el detalle y en el voucher)</span></label>
        <div class="adj-chips">${ADJUSTMENT_REASONS.map(r => `<button type="button" data-reason="${escapeHtml(r)}" class="${f.reason === r ? 'on' : ''}">${escapeHtml(r === 'Otro' ? 'Otro…' : r)}</button>`).join('')}</div>
        ${f.reason === 'Otro' ? `<input type="text" id="adj-other" maxlength="100" placeholder="Motivo adicional" value="${escapeHtml(f.reasonOther ?? '')}" class="adj-other">` : ''}</div>
      <div class="adj-err" id="adj-err"></div>
      <div class="adj-btns"><button type="button" data-adj="cancel">Cancelar</button><button type="button" class="p" data-adj="save">${f.id ? 'Guardar cambios' : 'Agregar ajuste'}</button></div>
    </div>`;
  },

  _adjBind(host, ids) {
    const changed = () => { this._renderAdjustments(); this._updateBreakdown(); };
    host.onclick = (e) => {
      const b = e.target.closest('button'); if (!b || !host.contains(b)) return;
      const f = this._adjForm;
      if (b.dataset.adj === 'add') {
        this._adjForm = { id: null, kind: 'discount', unitId: null, mode: 'pct', value: '', charged: true, reason: '', reasonOther: '' };
        this._renderAdjustments(); document.getElementById('adj-value')?.focus(); return;
      }
      if (b.dataset.adj === 'cancel') { this._adjForm = null; this._renderAdjustments(); return; }
      if (b.dataset.adj === 'edit') {
        const a = this._adjustments.find(x => x.id === b.closest('.adj-li')?.dataset.id); if (!a) return;
        this._adjForm = { ...a, value: a.value, unitId: a.unitId == null ? null : String(a.unitId) };
        this._renderAdjustments(); return;
      }
      if (b.dataset.adj === 'del') {
        const id = b.closest('.adj-li')?.dataset.id;
        this._adjustments = this._adjustments.filter(x => x.id !== id); if (this._adjForm?.id === id) this._adjForm = null; changed(); return;
      }
      if (!f) return;
      if (b.dataset.kind) {   // cambia el tipo: se conservan alcance y motivo
        f.kind = b.dataset.kind; f.mode = b.dataset.kind === 'free_nights' ? 'nights' : (b.dataset.kind === 'late_checkout' ? 'amt' : (f.mode === 'nights' ? 'pct' : (f.mode ?? 'pct')));
        if (b.dataset.kind === 'surcharge' && f.mode === 'pct' && !f._touchedMode) f.mode = 'amt';
        f.value = ''; this._renderAdjustments(); return;
      }
      if (b.dataset.mode) { f.mode = b.dataset.mode; f._touchedMode = true; this._renderAdjustments(); return; }
      if (b.dataset.reason !== undefined) { f.reason = f.reason === b.dataset.reason ? '' : b.dataset.reason; this._renderAdjustments(); document.getElementById('adj-other')?.focus(); return; }
      if (b.dataset.adj === 'save') this._adjSave();
    };
    host.oninput = (e) => {
      const f = this._adjForm; if (!f) return;
      if (e.target.id === 'adj-value') f.value = e.target.value;
      if (e.target.id === 'adj-other') f.reasonOther = e.target.value;
    };
    host.onchange = (e) => {
      const f = this._adjForm; if (!f) return;
      if (e.target.id === 'adj-target') { f.unitId = e.target.value || null; if (f.kind === 'late_checkout') this._renderAdjustments(); }
      if (e.target.id === 'adj-charged') f.charged = e.target.checked;
    };
    void ids;
  },

  _adjSave() {
    const f = this._adjForm; if (!f) return;
    const err = msg => { const el = document.getElementById('adj-err'); if (el) el.textContent = msg; };
    let value = parseFloat(f.value);
    if (f.kind === 'late_checkout' && (f.value === '' || Number.isNaN(value))) value = f.charged === false ? 0 : this._adjLateDefault(f.unitId);   // por defecto: ½ noche
    if (f.kind === 'free_nights') { value = Math.round(value); if (!(value >= 1)) return err('Poné cuántas noches sin cargo (1 o más).'); }
    else if (f.kind !== 'late_checkout' && !(value > 0)) return err('Poné un valor mayor a 0.');
    if (f.kind === 'late_checkout' && f.charged !== false && !(value > 0)) return err('Poné cuánto se cobra del late check-out (o destildá "Se cobra").');
    if ((f.kind === 'discount') && f.mode === 'pct' && value > 100) return err('El descuento no puede pasar de 100 %.');
    if (f.reason === 'Otro' && !String(f.reasonOther ?? '').trim()) return err('Escribí el motivo adicional (o elegí otro motivo).');
    const a = { id: f.id ?? newId(), unitId: f.unitId == null || f.unitId === '' ? null : String(f.unitId), kind: f.kind,
      mode: f.kind === 'free_nights' ? 'nights' : (f.kind === 'late_checkout' ? 'amt' : (f.mode === 'pct' ? 'pct' : 'amt')),
      value, charged: f.kind === 'late_checkout' ? f.charged !== false : true, reason: f.reason ?? '', reasonOther: f.reasonOther ?? '' };
    const i = this._adjustments.findIndex(x => x.id === a.id);
    if (i >= 0) this._adjustments[i] = a; else this._adjustments.push(a);
    this._adjForm = null;
    this._renderAdjustments(); this._updateBreakdown();
  },

  /** Para cotizaciones / reprogramaciones: agrega ajustes desde afuera (ej.: desde el calendario). */
  prefillAdjustments({ freeNights = 0, discount = null, surcharge = null, late = null, reason = '', reasonOther = '' } = {}) {
    this._adjustments ??= [];
    const add = a => this._adjustments.push({ id: newId(), unitId: null, reason, reasonOther, charged: true, ...a });
    if (freeNights > 0) add({ kind: 'free_nights', mode: 'nights', value: freeNights });
    if (discount && discount.value > 0) add({ kind: 'discount', mode: discount.mode === 'amt' ? 'amt' : 'pct', value: discount.value });
    if (surcharge && surcharge.value > 0) add({ kind: 'surcharge', mode: surcharge.mode === 'pct' ? 'pct' : 'amt', value: surcharge.value });
    if (late) add({ kind: 'late_checkout', mode: 'amt', value: late.amount ?? this._adjLateDefault(null), charged: late.charged !== false });
    this._renderAdjustments(); this._updateBreakdown();
  },
};
