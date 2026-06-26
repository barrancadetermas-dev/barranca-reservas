/**
 * MILA PMS — patches/reminders-fix.js
 *
 * PROBLEMA: 261 llamadas a /reminders con 400 Bad Request → loop infinito.
 * CAUSA:    La query selecciona o filtra columnas que no existen en la tabla.
 *
 * Columnas REALES de reminders:
 *   id, hotel_id, unit_id, title, description,
 *   scheduled_date, completed, created_at, completed_at
 *
 * INTEGRACIÓN:
 * Buscá en tu código donde hacés la query a 'reminders' y reemplazala
 * con loadReminders() o loadRemindersWidget() de este archivo.
 */

// ── Guard global: evita reintentar errores 400 ───────────────────
// Pegar esto al inicio de cualquier función que haga queries a Supabase:
const _failedQueries = new Set();

function shouldSkipQuery(key) {
  if (_failedQueries.has(key)) {
    console.warn(`⚠️ Query '${key}' omitida (falló con 400 anteriormente). Revisar columnas.`);
    return true;
  }
  return false;
}

function markQueryFailed(key) {
  _failedQueries.add(key);
  console.error(`❌ Query '${key}' marcada como fallida. No se reintentará.`);
}

// ── Query correcta de reminders ──────────────────────────────────

/**
 * Carga recordatorios pendientes para hoy o anteriores.
 * SOLO usa columnas que existen en la tabla.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} hotelId
 * @returns {Promise<Array>}
 */
export async function loadReminders(supabase, hotelId) {
  const QUERY_KEY = 'reminders-pending';
  if (shouldSkipQuery(QUERY_KEY)) return [];

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('reminders')
    .select(`
      id,
      hotel_id,
      unit_id,
      title,
      description,
      scheduled_date,
      completed,
      completed_at,
      created_at
    `)
    .eq('hotel_id', hotelId)
    .is('completed', false)          // ← columna real: completed (boolean)
    .lte('scheduled_date', today)
    .order('scheduled_date', { ascending: true })
    .limit(20);

  if (error) {
    if (error.code === 'PGRST200' || error.message?.includes('column')) {
      markQueryFailed(QUERY_KEY);    // ← NO reintentar si es 400
    }
    console.error('loadReminders error:', error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Carga TODOS los recordatorios (para la vista de gestión).
 */
export async function loadAllReminders(supabase, hotelId) {
  const QUERY_KEY = 'reminders-all';
  if (shouldSkipQuery(QUERY_KEY)) return [];

  const { data, error } = await supabase
    .from('reminders')
    .select(`
      id,
      hotel_id,
      unit_id,
      title,
      description,
      scheduled_date,
      completed,
      completed_at,
      created_at
    `)
    .eq('hotel_id', hotelId)
    .order('scheduled_date', { ascending: true });

  if (error) {
    if (error.code === 'PGRST200' || error.message?.includes('column')) {
      markQueryFailed(QUERY_KEY);
    }
    console.error('loadAllReminders error:', error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Marca un recordatorio como completado.
 */
export async function completeReminder(supabase, reminderId) {
  const { error } = await supabase
    .from('reminders')
    .update({
      completed:    true,
      completed_at: new Date().toISOString(),
    })
    .eq('id', reminderId);

  if (error) {
    console.error('completeReminder error:', error.message);
    return false;
  }
  return true;
}

/**
 * Crea un nuevo recordatorio.
 */
export async function createReminder(supabase, { hotelId, unitId, title, description, scheduledDate }) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      hotel_id:       hotelId,
      unit_id:        unitId ?? null,
      title:          title,
      description:    description ?? null,
      scheduled_date: scheduledDate,
      completed:      false,
    })
    .select()
    .single();

  if (error) {
    console.error('createReminder error:', error.message);
    return null;
  }
  return data;
}

// ── Widget de recordatorios para el Panel de Control ─────────────

/**
 * Renderiza el widget de recordatorios pendientes.
 * @param {HTMLElement} container
 * @param {Array}       reminders
 * @param {Function}    onComplete  - callback(reminderId) al marcar completado
 */
export function renderRemindersWidget(container, reminders, onComplete) {
  if (!container) return;

  if (!reminders.length) {
    container.innerHTML = `
      <div class="reminders-empty">
        <span>✅ Sin recordatorios pendientes</span>
      </div>
    `;
    return;
  }

  const hoy   = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <ul class="reminders-list">
      ${reminders.map(r => {
        const isOverdue = r.scheduled_date < hoy;
        return `
          <li class="reminder-item ${isOverdue ? 'reminder-item--overdue' : ''}">
            <div class="reminder-info">
              <span class="reminder-date ${isOverdue ? 'text-red' : ''}">
                ${isOverdue ? '⚠️' : '📅'} ${formatDate(r.scheduled_date)}
              </span>
              <span class="reminder-title">${escHtml(r.title)}</span>
              ${r.description
                ? `<span class="reminder-desc">${escHtml(r.description)}</span>`
                : ''}
            </div>
            <button
              type="button"
              class="btn-complete-reminder"
              data-id="${r.id}"
              title="Marcar como completado"
            >✓</button>
          </li>
        `;
      }).join('')}
    </ul>
  `;

  container.querySelectorAll('.btn-complete-reminder').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled    = true;
      btn.textContent = '⏳';
      if (typeof onComplete === 'function') await onComplete(btn.dataset.id);
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────
function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-AR', {
    day: 'numeric', month: 'short'
  });
}

function escHtml(str) {
  return str?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') ?? '';
}
