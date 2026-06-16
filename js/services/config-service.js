// ══════════════════════════════════════════════════
// config-service.js — Servicio de configuración
// Lee valores de AppContext.config (cargado al boot)
// También usa ConfigPanel.getNumber() como helper
// ══════════════════════════════════════════════════

import { AppContext } from '../supabase-config.js';

/** Obtener valor de configuración como string */
export function getConfig(key, defaultVal = '') {
  return AppContext.config?.[key] ?? defaultVal;
}

/** Obtener valor de configuración como número */
export function getConfigNumber(key, defaultVal = 0) {
  return parseFloat(AppContext.config?.[key] ?? defaultVal) || defaultVal;
}

/** Comisión por canal (0-100) */
export function getChannelCommission(channel) {
  const MAP = {
    booking:  'commission_booking',
    airbnb:   'commission_airbnb',
    despegar: 'commission_despegar',
    expedia:  'commission_expedia',
  };
  const key = MAP[channel];
  return key ? getConfigNumber(key, 15) : 0;
}

/** Recargo por forma de pago (0-100) */
export function getPaymentSurcharge(method) {
  const MAP = {
    credit_card:  'surcharge_credit_card',
    debit_card:   'surcharge_debit_card',
    transfer:     'surcharge_transfer',
    mercadopago:  'surcharge_mercadopago',
  };
  const key = MAP[method];
  return key ? getConfigNumber(key, method === 'credit_card' ? 10 : 0) : 0;
}

/** Hora de check-in estándar */
export function getCheckinHour()  { return getConfig('checkin_hour',  '14:00'); }
/** Hora de check-out estándar */
export function getCheckoutHour() { return getConfig('checkout_hour', '10:00'); }
