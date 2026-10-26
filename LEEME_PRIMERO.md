# Entrega final — MILA (calendario + reservas multi-unidad + cards + armado + saldo por unidad)

## Orden (importante)
1. **Supabase → SQL Editor → pegar `1_migration_multiunidad.sql` → Run.** Va PRIMERO. Solo agrega columnas y un trigger; el código viejo sigue andando igual. Se puede correr más de una vez.
   - Si ya habías corrido la migración multiunidad de una entrega anterior (sin el nombre por depto), corré solo `2_solo_si_ya_corriste_la_anterior_migration_nombre.sql`.
2. Respaldá tu proyecto (commit o copia).
3. Copiá estos archivos pisando los tuyos (mismas rutas). Si tocaste `calendar.js`, `booking-form.js`, `booking-list.js`, `dashboard.js`, `index.html` o `supabase-config.js` después del `index.zip` original, compará antes de pisar.
4. **Borrá**: `js/components/supabase-config.js` (copia sin uso) y `_dev/tests/e2e/booking_cards_test.py` (validaba el diseño viejo de las cards; lo reemplaza `booking_cards_v2_test.py`).
5. Refresco forzado (Ctrl+Shift+R; si usás la PWA, limpiá caché).

## Novedades de esta ronda
- **Armado de hoy y mañana:** botón "📲 Armado hoy/mañana" (barra de las cards). Genera el texto para la encargada: `#6 ~ LILIANA LÓPEZ, 2PERS, (27/10 al 30/10) 3 noches. $100.000`, una línea por depto, con nombre propio, personas del depto y saldo del depto (0 → PAGADO). Editable; Copiar / Abrir WhatsApp.
- **Saldo por unidad** en el detalle de la reserva (y en el armado): los pagos con depto asignado descuentan de ese depto; los pagos generales se reparten proporcional a lo que corresponde a cada depto.
- **⚡ Edición rápida** en el detalle: abre directo en Precios (descuentos, noches sin cargo, recargos, nombre y personas por depto).
- **Lista de Reservas:** el nombre propio del depto aparece junto al chip (y el buscador lo encuentra).
- **Calendario:** la barra de herramientas ya no flota sobre las filas al hacer scroll.
- **Cards:** una sola línea (máx. 6, HOY y futuras juntas), más compactas; acciones como iconos al pasar el mouse.
- **Formulario (paso 3) mucho más corto:** conceptos en una fila con "Toda / Un depto" debajo de cada uno; distribución por unidad en filas de una línea; late check-out y depósito en una fila.
- **Errores reales arreglados:**
  - `dashboard.js`: al hacer check-out desde el Panel de Hoy mostraba "Error: notas is not defined" (después de registrarlo) y no refrescaba ni sonaba.
  - Noches sin cargo fuera de la vista pintaban amarillo falso en la parte visible.
  - Estadías divididas: las noches sin cargo y el late check-out aparecían en cada tramo (ahora solo donde corresponden).
  - Recargo: la cola de la barra quedaba casi negra (0.55 → 0.65).
- **Tests viejos puestos al día:** `free_nights_test` (diseño de degradé vigente) y `ui_test4`. Ya no quedan fallas.

## Probalo a mano (no pude contra tu base real)
- Reserva de 2 deptos: descuento / recargo / noche sin cargo a uno solo; nombres por depto; guardar, recargar y reabrir.
- Detalle → "Saldo por unidad" con un pago general y otro asignado a un depto.
- ⚡ Edición rápida; "Editar" común sigue empezando en el paso 1.
- 📲 Armado hoy/mañana con tus llegadas reales (necesita que los pagos por depto tengan `unit_id`; los generales se reparten).
- Cards: check-in de una llegada de HOY, WhatsApp (necesita el teléfono), filtros.
- Scroll del calendario con muchas filas; modo oscuro; celular.
- Si ya cargaste pagos en una reserva por unidad, revisá que el estado (señada/pagada) quede bien.

## Decisiones que tomé por vos (cambiables)
- Descuento colectivo + de un depto: se suman los porcentajes (tope 100%). Capacidad excedida / suma que no coincide: avisa y pide confirmar, no bloquea.
- Distribución y nombre por depto: opcionales. Late check-out: de toda la reserva y solo en el último tramo de una estadía dividida.
- Pagos generales: se reparten proporcional al "corresponde" de cada depto.
- Barras de reservas pasadas: se mantienen apagadas (opacidad .55, saturación .5); el test se ajustó a ese diseño.

## Tests
- `node --test _dev/tests/unit/` → 34 pruebas (cálculo, nombres, saldo por unidad, armado).
- `python3 _dev/tests/e2e/regen_harness.py`, luego `npx vite --port 5199` y por cada archivo `python3 _dev/tests/e2e/<archivo>.py`. Resultado en esta entrega: todos pasan —
  multiunit_form (47), multiunit_extras (24), booking_cards_v2 (34), free_nights (34), ui_test4 (41), unit_filter (12), late_checkout_* (11 + 22), bar_colors (14), dash_checkout (5), cal, checkin, dash_*, pay, ui_test/2/3, voucher_guest.
