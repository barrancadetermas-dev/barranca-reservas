# MILA v8 — Guía de instalación y configuración

## 1. Deploy del código (ya hecho si llegás de GitHub)
Pushear a GitHub → Vercel deploya automáticamente.

## 2. Migración SQL — EJECUTAR UNA SOLA VEZ en Supabase SQL Editor
Copiar y pegar el contenido de `scripts/migration_complete_v8.sql`

Crea:
- Tabla `hotel_config` (comisiones, WiFi, horarios)
- Tabla `guest_notes` (notas internas de huéspedes)
- Tabla `hotel_stock` (inventario de limpieza)
- Columnas faltantes en `bookings` (price_per_night, checked_in_at, etc.)
- Índices de performance

## 3. Variables de entorno en Vercel
Settings → Environment Variables:
- `VITE_SUPABASE_URL` = https://tuneeinpudlsezzmvaro.supabase.co
- `VITE_SUPABASE_ANON_KEY` = (tu anon key)

## 4. Secrets en Supabase (para emails)
Edge Functions → Secrets:
- `RESEND_API_KEY` = tu key de Resend
- `MILA_FROM_EMAIL` = reservas@barrancadetermas.com

## 5. Edge Functions (ya deployadas)
- `weekly-summary` → email resumen cada lunes
- `booking-confirmation` → email al crear una reserva

## 6. Cron del resumen semanal — en SQL Editor
```sql
select cron.schedule(
  'mila-weekly-summary',
  '0 11 * * 1',
  $$
    select net.http_post(
      url     := 'https://tuneeinpudlsezzmvaro.supabase.co/functions/v1/weekly-summary',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer TU_ANON_KEY"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
```

## 7. Configuración inicial (en la app)
Ir a **Configuración** y completar:
- Nombre WiFi y contraseña (para WhatsApp automático en check-in)
- Comisiones por canal (Booking, Airbnb, etc.)
- Horarios de check-in / check-out
- Anticipos mínimos

---

## Atajos de teclado
| Atajo | Acción |
|---|---|
| `Ctrl+N` | Nueva reserva (abre calculadora) |
| `Ctrl+K` | Command palette (buscar todo) |
| `Ctrl+F` | Buscar huésped |
| `Ctrl+D` | Panel de Hoy |
| `←` `→` | Navegar meses en el calendario |
| `Escape` | Cerrar modal activo |
| `Shift+Arrastrar` | Bloquear fechas en el calendario |

## Funcionalidades nuevas
- 🔊 **Sonidos**: parlante en el header para silenciar/activar
- 🎨 **Temas**: 5 paletas de color (ícono de paleta en el header)
- 🔔 **Notificaciones reales**: check-ins, saldos pendientes, recordatorios vencidos
- ✅ **Check-in desde Panel de Hoy**: sin ir al calendario
- 💬 **WhatsApp automático**: al hacer check-in, ofrece enviar bienvenida con WiFi
- 💰 **Calculadora como paso 0**: al crear reserva, calcula primero
- 📊 **Historial de precios**: al elegir unidad, muestra precio histórico del mismo mes
- 🔒 **SHIFT+arrastrar**: bloquear fechas por mantenimiento en el calendario
- 👁 **Ver disponibilidad**: toggle en el calendario colorea celdas libres
- 📧 **Email de confirmación**: automático al crear reserva
- 📋 **Audit log con before/after**: registra cambios de precio, fechas, etc.
