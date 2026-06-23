/**
 * MILA PMS — Dollar Widget
 * Componente visual que muestra la cotización del dólar en el header/panel.
 *
 * Uso:
 *   import { DollarWidget } from './components/dollar-widget.js';
 *   const widget = new DollarWidget('#dollar-widget-container');
 *   widget.mount();
 */

import { dollarService } from '../services/dollar-service.js';

export class DollarWidget {
  /**
   * @param {string|HTMLElement} target  Selector o elemento donde montar el widget.
   */
  constructor(target) {
    this._container = typeof target === 'string'
      ? document.querySelector(target)
      : target;
    this._unsub     = null;
    this._interval  = null;
  }

  mount() {
    if (!this._container) {
      console.warn('[DollarWidget] Contenedor no encontrado');
      return;
    }

    // Estado inicial: loading
    this._renderLoading();

    // Suscribirse a actualizaciones
    this._unsub = dollarService.subscribe((rate) => this._renderRate(rate));

    // Cargar cotización
    dollarService.getRate()
      .then((rate) => this._renderRate(rate))
      .catch((err) => this._renderError(err.message));

    // Auto-refresh cada 30 minutos
    this._interval = setInterval(() => {
      dollarService.refresh()
        .then((rate) => this._renderRate(rate))
        .catch((err) => console.warn('[DollarWidget] Error al refrescar:', err.message));
    }, 30 * 60 * 1000);
  }

  unmount() {
    if (this._unsub) this._unsub();
    if (this._interval) clearInterval(this._interval);
    if (this._container) this._container.innerHTML = '';
  }

  // ── Renders ──────────────────────────────────────────────────────────────────

  _renderLoading() {
    this._container.innerHTML = `
      <div class="dollar-widget dollar-loading" aria-label="Cargando cotización">
        <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
        </svg>
        <span>Cotización...</span>
      </div>`;
  }

  _renderRate(rate) {
    const fmt   = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const date  = new Date(rate.updatedAt);
    const time  = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const stale = rate.stale ? '<span class="dollar-stale" title="Datos vencidos">⚠</span>' : '';

    this._container.innerHTML = `
      <div class="dollar-widget" title="Cotización oficial del dólar">
        <div class="dollar-main">
          <span class="dollar-icon">💵</span>
          <span class="dollar-label">USD Oficial</span>
          <span class="dollar-values">
            <span class="dollar-buy"  title="Compra">$${fmt(rate.buy)}</span>
            <span class="dollar-sep">/</span>
            <span class="dollar-sell" title="Venta">$${fmt(rate.sell)}</span>
          </span>
          ${stale}
        </div>
        <div class="dollar-meta">
          <span class="dollar-sources" title="Fuentes: ${rate.sources.join(', ')}">
            ${rate.sources.map((s) => `<span>${s}</span>`).join(' · ')}
          </span>
          <span class="dollar-updated">Actualizado ${time}</span>
        </div>
      </div>`;

    // Emitir evento global por si otros módulos escuchan
    window.dispatchEvent(new CustomEvent('mila:dollar:updated', { detail: rate }));
  }

  _renderError(message) {
    this._container.innerHTML = `
      <div class="dollar-widget dollar-error" title="${message}">
        <span class="dollar-icon">💵</span>
        <span class="dollar-label">Sin cotización</span>
        <button class="dollar-retry btn btn-xs" type="button">Reintentar</button>
      </div>`;

    this._container.querySelector('.dollar-retry')?.addEventListener('click', () => {
      this._renderLoading();
      dollarService.refresh()
        .then((rate) => this._renderRate(rate))
        .catch((err) => this._renderError(err.message));
    });
  }
}

// ─── Función de conversión (para la calculadora) ──────────────────────────────

/**
 * Convierte USD a ARS usando la cotización oficial (promedio compra).
 * @param {number} usd
 * @returns {Promise<{ars: number, rate: number}>}
 */
export async function convertUSDtoARS(usd) {
  const rate = await dollarService.getOfficialRate();
  return { ars: Math.round(usd * rate * 100) / 100, rate };
}

/**
 * Convierte ARS a USD usando la cotización oficial (promedio compra).
 * @param {number} ars
 * @returns {Promise<{usd: number, rate: number}>}
 */
export async function convertARStoUSD(ars) {
  const rate = await dollarService.getOfficialRate();
  return { usd: Math.round((ars / rate) * 100) / 100, rate };
}
