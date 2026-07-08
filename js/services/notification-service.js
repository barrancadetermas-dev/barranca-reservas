// ═══════════════════════════════════════════════════
// notification-service.js — Notificaciones reales
// • Check-ins hoy y mañana
// • Reservas con saldo pendiente próximo check-in
// • Recordatorios vencidos
// • Check-outs pendientes
// ═══════════════════════════════════════════════════

import { AppContext } from '../supabase-config.js';

export class NotificationService {
  constructor(supabase) {
    this.db    = supabase;
    this._list = [];
  }

  async refresh() {
    if (!AppContext.hotelId) return [];
    const _d = (d) => { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
    const today    = _d(new Date());
    const tomorrow = _d(new Date(new Date().setDate(new Date().getDate()+1)));
    const in3Days  = _d(new Date(new Date().setDate(new Date().getDate()+3)));
    const now      = new Date();

    this._list = [];

    try {
      // ── Check-ins de hoy ─────────────────────────
      const { data: arrivals } = await this.db
        .from('bookings')
        .select('id, check_in, check_out, guests!bookings_guest_id_fkey(first_name, last_name)')
        .eq('hotel_id', AppContext.hotelId)
        .eq('check_in', today)
        .not('status', 'in', '(cancelled,blocked)');

      (arrivals ?? []).forEach(b => {
        const g = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Huésped';
        this._list.push({
          id:       `ci-${b.id}`,
          type:     'checkin_today',
          priority: 'high',
          icon:     '✅',
          title:    `Check-in hoy`,
          body:     `${g} llega hoy (sale el ${b.check_out})`,
          bookingId: b.id,
          action:   'checkin',
        });
      });

      // ── Check-ins mañana ─────────────────────────
      const { data: tomorrow_arr } = await this.db
        .from('bookings')
        .select('id, check_in, check_out, guests!bookings_guest_id_fkey(first_name, last_name)')
        .eq('hotel_id', AppContext.hotelId)
        .eq('check_in', tomorrow)
        .not('status', 'in', '(cancelled,blocked)');

      (tomorrow_arr ?? []).forEach(b => {
        const g = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Huésped';
        this._list.push({
          id:       `cit-${b.id}`,
          type:     'checkin_tomorrow',
          priority: 'medium',
          icon:     '📅',
          title:    `Check-in mañana`,
          body:     `${g} llega mañana`,
          bookingId: b.id,
        });
      });

      // ── Check-outs de hoy ────────────────────────
      const { data: departures } = await this.db
        .from('bookings')
        .select('id, check_out, guests!bookings_guest_id_fkey(first_name, last_name), checked_out_at')
        .eq('hotel_id', AppContext.hotelId)
        .eq('check_out', today)
        .not('status', 'in', '(cancelled,blocked)');

      (departures ?? []).forEach(b => {
        if (b.checked_out_at) return; // ya registrado
        const g = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Huésped';
        this._list.push({
          id:       `co-${b.id}`,
          type:     'checkout_today',
          priority: now.getHours() >= 10 ? 'high' : 'medium',
          icon:     '👋',
          title:    `Check-out pendiente`,
          body:     `${g} debía salir hoy`,
          bookingId: b.id,
          action:   'checkout',
        });
      });

      // ── Recambios de hoy (sale uno, entra otro el mismo día) ──
      const { data: checkinsHoy } = await this.db
        .from('bookings')
        .select('id, check_in, booking_units(unit_id, units(name)), guests!bookings_guest_id_fkey(first_name, last_name)')
        .eq('hotel_id', AppContext.hotelId)
        .eq('check_in', today)
        .not('status', 'in', '(cancelled,blocked)');

      const { data: checkoutsHoy } = await this.db
        .from('bookings')
        .select('id, check_out, booking_units(unit_id, units(name)), guests!bookings_guest_id_fkey(first_name, last_name)')
        .eq('hotel_id', AppContext.hotelId)
        .eq('check_out', today)
        .not('status', 'in', '(cancelled,blocked)');

      (checkinsHoy ?? []).forEach(ci => {
        const ciUnitId = ci.booking_units?.[0]?.unit_id;
        const co = (checkoutsHoy ?? []).find(co => co.booking_units?.[0]?.unit_id === ciUnitId);
        if (!co) return; // no hay salida en la misma unidad hoy → no es recambio
        const unitName = ci.booking_units?.[0]?.units?.name ?? 'Unidad';
        const inGuest  = ci.guests ? `${ci.guests.first_name} ${ci.guests.last_name}` : 'Huésped';
        const outGuest = co.guests ? `${co.guests.first_name} ${co.guests.last_name}` : 'Huésped';
        this._list.push({
          id:       `rec-${ci.id}`,
          type:     'recambio',
          priority: 'high',
          icon:     '⚡',
          title:    `Recambio en ${unitName}`,
          body:     `Sale: ${outGuest} · Entra: ${inGuest}`,
          bookingId: ci.id,
        });
      });

      // ── Reservas con saldo pendiente (check-in en ≤3 días) ──
      const { data: unpaid } = await this.db
        .from('bookings')
        .select('id, check_in, total_amount, total_paid, balance, guests!bookings_guest_id_fkey(first_name, last_name)')
        .eq('hotel_id', AppContext.hotelId)
        .eq('status', 'partial')
        .lte('check_in', in3Days)
        .gte('check_in', today);

      (unpaid ?? []).forEach(b => {
        const g   = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Huésped';
        const bal = Math.round(b.balance ?? (b.total_amount - (b.total_paid ?? 0)));
        if (bal <= 0) return;
        const daysTo = Math.round((new Date(b.check_in) - now) / 86400000);
        this._list.push({
          id:       `up-${b.id}`,
          type:     'unpaid',
          priority: daysTo <= 1 ? 'high' : 'medium',
          icon:     '💰',
          title:    `Saldo pendiente`,
          body:     `${g} llega en ${daysTo === 0 ? 'hoy' : daysTo + (daysTo === 1 ? ' día' : ' días')} · Debe $${bal.toLocaleString('es-AR')}`,
          bookingId: b.id,
        });
      });

      // ── Recordatorios vencidos ───────────────────
      // NOTA: La tabla reminders NO tiene columna 'priority' — no incluirla en select
      // is_note=false: las notas (cumpleaños, Mundial, etc.) no son tareas
      // vencidas, no tiene sentido que aparezcan acá como pendientes.
      const { data: reminders } = await this.db
        .from('reminders')
        .select('id, title, scheduled_date, completed_at')
        .eq('hotel_id', AppContext.hotelId)
        .eq('is_note', false)
        .is('completed', false)
        .lte('scheduled_date', today)
        .order('scheduled_date', { ascending: true })
        .limit(10);

      (reminders ?? []).forEach(r => {
        const days = Math.round((now - new Date(r.scheduled_date + 'T00:00:00')) / 86400000);
        // Cuanto más vencido, más urgente
        const priority = days > 3 ? 'high' : 'medium';
        this._list.push({
          id:        `rem-${r.id}`,
          type:      'reminder',
          priority,
          icon:      days > 3 ? '🚨' : '🔔',
          title:     `Recordatorio vencido`,
          body:      `${r.title}${days > 0 ? ` (hace ${days} día${days !== 1 ? 's' : ''})` : ' (hoy)'}`,
          reminderId: r.id,
        });
      });

      // ── Limpiezas pendientes de hoy (o atrasadas) ──
      // Solo pending/in_progress: al marcarse 'completed' dejan de traerse acá.
      // NOTA: no se usa el embed units(name) porque en algunos hoteles la
      // relación no está aún en el schema cache de PostgREST y devuelve 400 —
      // se resuelve el nombre de la unidad con AppContext.units (ya en memoria).
      const unitName = (id) => AppContext.units?.find(u => u.id === id)?.name ?? 'Unidad';

      const { data: cleanings } = await this.db
        .from('cleaning_tasks')
        .select('id, scheduled_date, status, notes, unit_id')
        .eq('hotel_id', AppContext.hotelId)
        .neq('status', 'completed')
        .lte('scheduled_date', today)
        .order('scheduled_date', { ascending: true })
        .limit(10);

      (cleanings ?? []).forEach(t => {
        const overdue = t.scheduled_date < today;
        this._list.push({
          id:       `cl-${t.id}`,
          type:     'cleaning',
          priority: overdue ? 'high' : 'medium',
          icon:     '🧹',
          title:    overdue ? 'Limpieza atrasada' : 'Limpieza pendiente',
          body:     `${unitName(t.unit_id)}${t.notes ? ` · ${t.notes}` : ''}`,
          taskId:   t.id,
        });
      });

      // ── Incidencias de mantenimiento abiertas ──
      // Solo status !== 'resolved': al resolverse dejan de traerse acá.
      const { data: maint } = await this.db
        .from('maintenance_issues')
        .select('id, title, priority, status, created_at, unit_id')
        .eq('hotel_id', AppContext.hotelId)
        .neq('status', 'resolved')
        .order('created_at', { ascending: false })
        .limit(10);

      (maint ?? []).forEach(m => {
        this._list.push({
          id:       `mt-${m.id}`,
          type:     'maintenance',
          priority: m.priority === 'urgent' ? 'high' : 'medium',
          icon:     '🔧',
          title:    'Mantenimiento pendiente',
          body:     `${unitName(m.unit_id)} · ${m.title ?? 'Incidencia'}`,
          issueId:  m.id,
        });
      });

    } catch (err) {
      console.warn('[NotifService] error fetching notifications:', err.message);
    }

    // Ordenar: high primero, luego medium
    this._list.sort((a, b) =>
      (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
    );

    return this._list;
  }

  get count()       { return this._list.length; }
  get all()         { return this._list; }
  get highPriority(){ return this._list.filter(n => n.priority === 'high'); }
}
