/**
 * MILA PMS — lib/supabase-debug.js
 * Wrapper de diagnóstico para operaciones Supabase.
 * Nombres reales: bookings, payments, expenses, cleaning_tasks
 */

const ERROR_HINTS = {
  '42501':   '🔒 RLS BLOQUEÓ la operación. Revisar política en Supabase Studio.',
  'PGRST301':'🔑 JWT expirado o inválido. Re-autenticar usuario.',
  'PGRST116':'📭 .single() no encontró filas. Verificar filtros.',
  '23505':   '🔄 Duplicate key — el registro ya existe.',
  '23503':   '🔗 Foreign key violation — referencia inexistente.',
  '23502':   '📋 NOT NULL violation — campo obligatorio vacío.',
  '22P02':   '🔤 Tipo de dato incorrecto (texto donde se esperaba número).',
  '22001':   '✂️  Valor demasiado largo para la columna.',
  'PGRST204':'📋 Columna inexistente en la tabla.',
};

function diagnose(error) {
  const hint = ERROR_HINTS[error.code] ?? `Código desconocido: ${error.code}`;
  console.error(`   ⚑ Diagnóstico: ${hint}`);
  if (error.details) console.error('   Details:', error.details);
  if (error.hint)    console.error('   Hint DB:', error.hint);
}

/**
 * INSERT con logging completo.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} table
 * @param {Object|Object[]} payload
 * @param {string} [context]
 */
export async function safeInsert(supabase, table, payload, context = '') {
  console.group(`🔵 INSERT → ${table}${context ? ` [${context}]` : ''}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const { data, error, status, statusText } = await supabase
    .from(table)
    .insert(payload)
    .select(); // ← CRÍTICO: sin .select() data es null aunque inserte OK

  if (error) {
    console.error(`❌ HTTP ${status} ${statusText}:`, error.message);
    diagnose(error);
  } else {
    console.log(`✅ ${data?.length ?? 0} fila(s) insertada(s)`, data);
  }

  console.groupEnd();
  return { data, error };
}

/**
 * UPDATE con logging.
 */
export async function safeUpdate(supabase, table, payload, filters, context = '') {
  console.group(`🟡 UPDATE → ${table}${context ? ` [${context}]` : ''}`);
  console.log('Payload:', payload, '| Filters:', filters);

  let query = supabase.from(table).update(payload);
  for (const [col, val] of Object.entries(filters)) query = query.eq(col, val);
  const { data, error, status } = await query.select();

  if (error) { console.error(`❌ HTTP ${status}:`, error.message); diagnose(error); }
  else        { console.log(`✅ ${data?.length ?? 0} fila(s) actualizada(s)`); }

  console.groupEnd();
  return { data, error };
}

/**
 * UPSERT con logging.
 */
export async function safeUpsert(supabase, table, payload, onConflict = 'id', context = '') {
  console.group(`🟢 UPSERT → ${table}${context ? ` [${context}]` : ''}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const { data, error, status } = await supabase
    .from(table)
    .upsert(payload, { onConflict })
    .select();

  if (error) { console.error(`❌ HTTP ${status}:`, error.message); diagnose(error); }
  else        { console.log(`✅ upsert OK`, data); }

  console.groupEnd();
  return { data, error };
}

/**
 * Verifica sesión activa y hotel vinculado antes de cualquier operación.
 * Llamar al inicio de onSubmit de cada formulario.
 */
export async function preOperationCheck(supabase) {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();

  if (authErr || !user) {
    console.error('❌ Pre-check: Sin sesión.', authErr);
    return { ok: false };
  }

  const { data: hu, error: huErr } = await supabase
    .from('hotel_users')
    .select('hotel_id, role')
    .eq('user_id', user.id)
    .single();

  if (huErr || !hu) {
    console.error('❌ Pre-check: Sin hotel_user vinculado para uid:', user.id);
    return { ok: false };
  }

  console.log('✅ Pre-check OK:', { userId: user.id, hotelId: hu.hotel_id, role: hu.role });
  return { ok: true, userId: user.id, hotelId: hu.hotel_id, role: hu.role };
}

// ── Shortcuts para cada formulario ───────────────────────────────
export const insertBooking      = (sb, p) => safeInsert(sb, 'bookings',       p, 'Reserva');
export const insertExpense      = (sb, p) => safeInsert(sb, 'expenses',       p, 'Gasto');
export const insertCleaningTask = (sb, p) => safeInsert(sb, 'cleaning_tasks', p, 'Limpieza');
export const insertPayment      = (sb, p) => safeInsert(sb, 'payments',       p, 'Pago');
