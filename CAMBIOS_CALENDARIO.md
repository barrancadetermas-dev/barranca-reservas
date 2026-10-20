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
