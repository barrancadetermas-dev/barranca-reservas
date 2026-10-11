# Cambios: cambio de departamento en una reserva · género · voucher A4

## Orden de puesta en marcha (importante)
1. **Supabase → SQL Editor**, en este orden:
   1. `_dev/scripts-sql/migrations/migration_guest_gender.sql`
   2. `_dev/scripts-sql/migrations/migration_booking_segments.sql`
   3. *(opcional)* `migration_booking_segments_pricing.sql` — **leer su cabecera antes**: pide comparar
      `SELECT pg_get_functiondef('recalculate_booking_totals'::regproc);` con la del repo.
2. Recién después desplegar el código.
Si se despliega antes, la app **no se rompe** (reintenta sin las columnas nuevas y avisa), pero género y
cambio de depto no se guardan hasta correr el SQL.

## 1. Una reserva con varios tramos
- Modelo: `booking_units` = tramos (unidad, desde, hasta). `segment_* = NULL` ⇒ toda la estadía
  (reservas viejas y comunes: no se tocan).
- Un único módulo decide la ocupación: `js/services/stay-segments.js`. Disponibilidad:
  `js/services/availability-service.js`. Estadísticas: `js/services/unit-stats.js`.
- Formulario: paso 2 → «🔀 Cambiar de departamento durante la estadía» (editor en
  `js/components/split-stay-editor.js`); precios por tramo en el paso 3. La sugerencia 🔀 ya no
  crea dos reservas: convierte la misma en una con dos tramos.
- Ficha, tooltip del calendario, voucher y texto de WhatsApp muestran los tramos.
- Un trigger de base (paso A) mantiene los tramos alineados si cambian las fechas de la reserva.
- Límite conocido: un depto no puede repetirse dentro de una misma reserva (restricción UNIQUE existente).
- Máximo 4 tramos por reserva.

## 2. Género
- `guests.gender` = `male | female | nonbinary | NULL`. Campo en «Nueva/Editar reserva» (junto al email).
- `js/utils/gender.js` → `alojado(gender, {count, style, fallback})`. Reservas sin género conservan
  el texto de siempre (`Alojadas`, `ALOJADA`).
- Se envía `gender` solo si hay un valor elegido: nunca se pisa con vacío un género ya guardado.

## 3. Voucher A4
- Plantilla única `js/services/voucher-template.js` (antes 3 copias): `@page A4`, márgenes 12 mm,
  tipografía en pt (≥ 8 pt), pie al fondo, `break-inside: avoid`, modo compacto automático,
  imprime tras cargar fuentes, nombre de archivo sugerido «Voucher Apellido Nombre AAAA-MM-DD».
- Medido (Chromium → PDF A4): antes 70 % del alto y texto de 6,75 pt; ahora ~93 % y mínimo 8 pt.

## Pruebas incluidas
- `_dev/tests/unit/stay-segments.test.js` (módulos reales; ya enlazado en `test-runner.html`).
- `_dev/tests/harness/*` — arnés de integración con Supabase simulado (Playwright + `vite`; necesita un
  `.env.local` con `VITE_SUPABASE_URL=http://localhost:9` y `VITE_SUPABASE_ANON_KEY=dummy`).
