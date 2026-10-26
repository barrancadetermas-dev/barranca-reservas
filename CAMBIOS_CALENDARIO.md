# Calendario MILA: ajuste de barras y degradado de noches sin cargo / descuento

Único archivo modificado: `js/components/calendar.js`

## 1. Ancho exacto de las barras
- Causa: las barras usaban `calc(span * 100% - 8px)`. Ese 100% es el ancho interior de UNA celda
  (sin bordes) y los bordes varían (1px normal, 2+2px en "hoy", 2px en cambio de mes), por lo que la
  barra quedaba más corta que las celdas que ocupa.
- Solución: `_fitBars()` mide el borde real de la primera y la última celda y fija `left`/`width` en px
  (mismo margen de 4px de diseño en ambos extremos). Se recalcula con ResizeObserver.

## 2. Degradado (un solo módulo, sin cortes)
- La barra conserva su color base (verde = pagada, rojo = señada, ámbar = sin seña).
- Noches sin cargo: el degradado empieza en el límite exacto de celda de la primera noche sin cargo
  y llega a amarillo (`FREE_NIGHT_END`, `#FACC15`) al final. Se adapta a 1, 2, 3 o más noches.
- Descuento: el último tramo (proporcional al %) vira a amarillo. 25% = último cuarto del ancho.
- Recargo: el último tramo, proporcional al % cobrado sobre el alquiler base (precio por noche × noches),
  vira al color base oscurecido (`SURCHARGE_DARKEN`): bordó en rojas, verde oscuro en pagadas.
  Ej.: alquiler 100.000 + recargo 25.000 = último 25% de la barra.
- Prioridad: noches sin cargo > descuento > recargo. Descuento + recargo juntos: sin cambios.
- Late checkout: la extensión ahora es solo una tira al final de la barra (antes se dibujaba encima de
  toda la barra repitiendo avatar y nombre, y el texto se veía doble). Toma el color final del degradado.
- Sombra de texto sutil en estas barras para mantener legible el nombre.

## No se tocó
Cálculo de noches, fechas, importes, tarifas, pagos, disponibilidad, tooltips, sincronización.

## Verificación
Medido en navegador real (Playwright, arnés `_dev/tests/harness`): escritorio y móvil, reservas de 1 a 7
noches, 0-3 noches sin cargo, descuentos 10/25/50%, pagadas/señadas/sin seña, cruce de mes, ventana
recortada a izquierda y derecha. Tests unitarios: todos pasan salvo `availability.test.js`, que ya
fallaba con el código original (no relacionado).

## Mejoras de uso (leyenda, filtros, huecos, limpieza, hoy, pasadas)
Todo dentro de `js/components/calendar.js` (los estilos se inyectan desde el propio archivo).
- **Leyenda "?"** (barra de herramientas): colores de estado, canales, degradados (amarillo/bordó) y marcas.
- **Filtros** (barra de herramientas): por estado (pagadas / con seña / sin seña / bloqueos), canal y unidad.
  Estado y canal atenúan el resto; unidad oculta las otras filas. Se recuerdan en el navegador
  (`localStorage`, clave `mila_cal_filters_v1`). El botón muestra cuántos filtros hay activos.
- **Noches sueltas**: huecos de 1–2 noches (`GAP_ALERT_MAX_NIGHTS`) entre reservas de la misma unidad,
  desde hoy en adelante, se marcan con una barra punteada "⚠ Nn". Click → cotizar con descuento sugerido
  (`GAP_SUGGESTED_DISCOUNT`: 15% 1 noche, 10% 2 noches; precarga la cotización), reservar o bloquear
  (pide confirmación; requiere permiso `editBooking`).
- **Turnos de limpieza**: donde sale uno y entra otro el mismo día, insignia 🧹 en la celda (con nombres
  en el tooltip), subrayado ámbar y contador 🧹N en el encabezado del día. Reemplaza al 🔄 anterior.
- **Hoy en las estadías en curso**: línea blanca con muesca en el límite exacto de la celda de hoy y
  tramo transcurrido más oscuro. (La línea existía pero se borraba al armar el contenido de la barra.)
- **Reservas pasadas más sobrias**: opacidad 55% y menos saturación (se aclaran al pasar el mouse).
- `_openQuickQuote` acepta un tercer parámetro opcional `prefill` ({ discountValue }); sin él, igual que antes.

## Late check-out en diagonal + barra de herramientas agrupada
Archivos: `js/components/calendar.js`, `css/calendar-v5.css`, `index.html`

- **Late check-out = una sola barra.** Antes la extensión era un elemento aparte (otra opacidad, otro fondo, esquinas
  redondeadas), por eso parecía una reserva nueva. Ahora la propia barra se prolonga `LATE_FRAC` (62%) dentro de la celda
  del día de salida y termina con corte diagonal (`LATE_SKEW` 12px). Mismo color y mismo degradé de punta a punta.
- **Reserva que entra ese mismo día:** arranca con un corte paralelo (separación `LATE_GAP` 3px) → queda el "|/|".
- Late gratis sin otro degradé: el amarillo arranca donde terminan las noches y sigue en el tramo del late.
- Los handles de resize se corrieron hacia adentro para no quedar recortados por la diagonal.
- **Toolbar:** botones agrupados en "píldoras" (navegación | Filtros ? Disponibilidad Períodos Cotizaciones | Imprimir),
  sin bordes sueltos, con separador y hover. Los botones Filtros y "?" que inserta el JS caen dentro del grupo.

## Filtros, toolbar, tooltip y colores por canal
Archivos: `js/components/calendar.js`, `js/supabase-config.js`, `css/calendar-v5.css`, `index.html`

- **Bug filtro por unidad:** la etiqueta de unidad tiene `display:flex !important`, el `display:none` inline no la ocultaba;
  las celdas sí se ocultaban y la grilla se desfasaba. Ahora se usa la clase `.cal-row-hidden` (`display:none !important`).
- **Toolbar:** una sola píldora ordenada por criterio: Buscar | Filtros | Disponibilidad | Períodos | Cotizaciones | ? | Imprimir.
  Los separadores `|` los pone el CSS entre cada hijo (también los botones que inserta el JS).
- **Tooltip:** descuento y recargo con el mismo estilo que la promo (`.ct-promo`):
  `🏷️ DESCUENTO 25% (−$50.000)` · `➕ RECARGO 20% (+$30.000)`. El chip de estado muestra siempre el estado de pago.
- **Colores de barra** (`getBookingBarColor`, `CHANNEL_BAR_COLORS`): Booking celeste, Airbnb naranja, Familia lila,
  Expedia naranja rojizo (color de canal, sin importar el pago). Resto de canales: verde pagada / rojo señada / amarillo sin seña.
  Noches sin cargo → degradé a amarillo también en Familia. Leyenda "?" actualizada.

## Ronda 3 — estado en barras de canal, diagonal única, filtros completos, tests
Archivos: `js/components/calendar.js`, `js/supabase-config.js`, `index.html`, `_dev/tests/e2e/*`
- **Canales con color propio** (Booking/Airbnb/Familia/Expedia): la barra va del color del canal (primer 40%, donde está el
  texto) al color de estado de pago (verde/rojo/amarillo). `getBookingBarColor` devuelve ahora `statusColor`/`statusLabel`.
  Los tramos de precio especial (noches sin cargo, descuento, recargo) siguen al final de la barra.
- **Recargo más suave** en colores claros (celeste, amarillo): factor 0.8 en vez de 0.55.
- **Diagonal única:** el late check-out usa la misma pendiente que la celda dividida (13px sobre el alto de la celda);
  `_fitBars` calcula los px según el alto real de la barra. Gap horizontal constante de 3px entre ambas diagonales.
- **Insignia 🧹** centrada en el corte diagonal cuando el que sale tiene late check-out.
- **Filtros:** también filtran las tarjetas de "próximas reservas" (antes de cortar a N tarjetas) y el cuadro tarifario.
  Doble click en una unidad del popover = solo esa unidad. Se quitó el `console.group` DEBUG de la mini agenda.
- **Disponibilidad:** el botón muestra siempre su nombre ("👁 Disponibilidad").
- **Noches sueltas** más tenues (borde 1px, fondo y texto con menos opacidad; hover recupera el énfasis).
- **Limpieza:** borrado `js/components/supabase-config.js` (copia sin uso).
- **Tests** (`npx vite --port 5199` y luego `python3 _dev/tests/e2e/<archivo>`): `late_checkout_past_test.py` (actualizado),
  `late_checkout_diagonal_test.py`, `bar_colors_test.py`, `unit_filter_test.py`; helpers en `_cal_helpers.py`.
  Antes de correrlos: `python3 _dev/tests/e2e/regen_harness.py` (copia el HTML real de index.html a los arneses).

## Ronda 4 — Reservas con 2+ deptos: huéspedes y ajustes POR UNIDAD
**Migración (correr ANTES de subir el código):** `migration_multiunidad.sql`
Archivos: `js/services/booking-pricing.js` (nuevo, cálculo único), `js/components/booking-form.js`, `calendar.js`, `booking-list.js`,
`dashboard.js`, `statistics.js`, `js/app.js`, `js/utils/db-compat.js`, `js/services/{unit-stats,voucher-template,voucher-guest}.js`,
`js/modules/encargada-share/encargada-content.js`, `index.html`, `css/calendar-v5.css`.
- Noches sin cargo, descuento y recargo: "Toda la reserva" o "Una unidad" (selector + depto). Lo colectivo sigue en `bookings`; lo de cada depto en `booking_units`.
- "Distribución por unidad": adultos/niños por depto, suma vs total, capacidad por depto, "Repartir automáticamente".
- Total: una sola función (`computeBookingPricing`). Sin ajustes por unidad = fórmula de siempre al centavo.
- Trigger `zz_booking_unit_pricing_total`: respeta el total de la app solo si `bookings.unit_pricing = true`.
- Se muestra en: formulario, resumen/voucher, detalle de reserva, calendario (barras y tooltip), tarjetas, Panel de Hoy, mensaje a la encargada, estadísticas por depto.
- Tests: `node --test _dev/tests/unit/` (21) y `_dev/tests/e2e/multiunit_form_test.py` (36).
- Limpieza: borrar `js/components/supabase-config.js`.

## Ronda 5 — Cards de reservas v2 + nombre propio de cada depto
**Migración:** `migration_multiunidad.sql` (ya incluye la columna nueva) o, si ya corriste la anterior, `migration_multiunidad_nombre.sql`.
- **Nombre por depto dentro de la reserva** (`booking_units.label`, hasta 60 caracteres): campo "Nombre en esta reserva" en cada depto de
  "Distribución por unidad". Se ve en: formulario, calendario (texto de la barra y tooltip), cards, detalle, voucher, Panel de Hoy y mensaje a la encargada.
- **Cards de "próximas reservas"** (`calendar.js → _renderMiniAgenda`, estilos en `calendar-v5.css`): agrupadas por día (Hoy · Mañana · Esta semana · Próximas),
  fecha grande + noches + salida, nombre completo + canal, una fila por depto (nombre propio, personas, importe, etiquetas 🎁🏷️➕), etiquetas 🌅 late y 🧹 turno,
  barra de pago con saldo real, avisos (sin seña a ≤2 días, saldo a ≤3 días, falta distribución), acciones al pasar el mouse (Check-in solo HOY, WhatsApp, Ver),
  barra final "Ver todas / Nueva reserva". Respeta los filtros. Se corrigió un manejador de clic que se acumulaba en cada redibujado.
- Calendario: el teléfono del huésped ahora viaja en la consulta (para WhatsApp).
- Tests: `booking_cards_v2_test.py` (27, reemplaza a `booking_cards_test.py`, que validaba el diseño anterior), `multiunit_form_test.py` (43), unitarios (24).

## Ronda 6 — Armado hoy/mañana, saldo por unidad, edición rápida, UI más compacta y arreglos
- **Armado de hoy y mañana** (`js/services/armado-service.js` + `js/components/armado-modal.js`): botón "📲 Armado hoy/mañana" en la barra de las cards. Texto editable para WhatsApp:
  `#6 ~ LILIANA LÓPEZ, 2PERS, (27/10 al 30/10) 3 noches. $100.000`. Una línea por depto (nombre propio, personas del depto, saldo del depto; saldo 0 → PAGADO). Opciones: Hoy / Mañana / Incluir saldo; Copiar y Abrir WhatsApp.
- **Saldo por unidad** (`unitBalances`): corresponde = neto del depto + parte proporcional de lo colectivo; pagado = pagos del depto (`payments.unit_id`) + parte proporcional de los pagos generales. Se ve en el detalle de la reserva y en el armado.
- **Edición rápida**: botón "⚡ Edición rápida" en el detalle; abre el formulario directo en Precios (descuentos, noches sin cargo, recargos, nombre y personas por depto).
- **Lista de Reservas**: el nombre propio del depto aparece junto al chip (y el buscador lo encuentra).
- **Calendario**: la barra de herramientas ya no flota sobre la grilla al hacer scroll.
- **Cards**: UNA sola línea (máx. 6, HOY y futuras juntas), compactas (una línea por depto, máx. 2 + "+N deptos más"), acciones como iconos al pasar el mouse.
- **Formulario (paso 3)** mucho más corto: Noches sin cargo · Descuento · Recargo en una fila con "Toda / Un depto" debajo de cada uno; distribución por unidad en filas de una línea (depto, nombre, adultos, niños, capacidad); late check-out y depósito en una fila.
- **Arreglos de errores reales:** `dashboard.js` (check-out: "Error: notas is not defined", sin refresco ni sonido); noches sin cargo pintadas en amarillo cuando caen fuera de la vista; en estadías divididas las noches sin cargo y el late check-out aparecían en cada tramo (ahora solo en el que corresponde); cola de recargo casi negra (0.55 → 0.65).
- **Tests viejos puestos al día:** `free_nights_test` (diseño de degradé vigente) y `ui_test4`.
