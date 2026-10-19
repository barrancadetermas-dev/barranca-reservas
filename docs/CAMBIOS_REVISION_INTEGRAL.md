# Revisión integral — reservas, calendario, fechas especiales y check-in

## Orden de puesta en marcha
1. Supabase → SQL Editor (en este orden; todas son aditivas e idempotentes):
   1. `migration_guest_gender.sql` · 2. `migration_booking_segments.sql` · 3. **`migration_booking_source_channels.sql`** (nueva)
   4. *(opcional)* `migration_booking_segments_pricing.sql` (leer su cabecera).
2. Si un canal sigue fallando: ejecutar `_dev/scripts-sql/diagnostico_reservas_origen.sql` (solo lectura) y pasar los resultados.
3. Desplegar el código.

## Causas encontradas
| Problema | Causa real |
|---|---|
| Personas "vuelven a 2" | (a) al abrir la edición no se refrescaba el contador: quedaba el «2» del reset aunque hubiera 4; (b) se leía `adults` (por defecto 1 en la base) en vez del total real `pax`: la reserva se mostraba con 1 y **al guardar se pisaba `pax`**; (c) el guardado de personas era un UPDATE aparte dentro de un `try/catch` vacío que además ignoraba `error`. |
| Canales que no cargan | **No es el formulario**: probé los 9 canales con clics reales y todos envían su origen. Lo único del repo que puede rechazarlos es la restricción `chk_booking_source` (permite 4 de los 9 canales que ofrece la app). Sin acceso a tu base no puedo confirmarlo → SQL de diagnóstico + migración. Además el error ahora se ve (banner fijo + mensaje claro). |
| Check-in | Estaba escrito 3 veces con reglas distintas; el del Dashboard no miraba el error de la respuesta (mostraba «✅» aunque la base lo rechazara), no controlaba permisos, ni clics repetidos, ni dejaba auditoría. |
| Cobro (lista) | Ofrecía el método `card` (no existe en la base), no enviaba `amount_ars` (lo que suma el trigger), usaba un saldo en memoria (podía duplicar el pago si se cobró desde otra pantalla) y la fecha en UTC. |

## Archivos nuevos
`js/services/checkin-service.js` · `js/services/special-dates.js` · `js/utils/guest-count.js` · `js/utils/db-errors.js` ·
`_dev/scripts-sql/migrations/migration_booking_source_channels.sql` · `_dev/scripts-sql/diagnostico_reservas_origen.sql` ·
tests en `_dev/tests/unit/` y `_dev/tests/e2e/`.

## Fechas especiales (Argentina)
- Calculado por año: Pascua, Carnaval, Jueves/Viernes Santo, traslado de feriados trasladables (Ley 27.399 art. 6).
- **Cargado a mano por año** (no se puede calcular): días no laborables con fines turísticos y traslados de feriados que caen en fin de semana.
  Están cargados 2025 (Dec. 1027/2024, Res. 139/2025) y 2026 (Dec. 164/2025). **2027 todavía no tiene decreto**: cuando se publique,
  agregarlo en `TOURIST_BRIDGES` (`js/services/special-dates.js`). Mientras tanto no se inventan puentes.
- Validado: los 12 fines de semana largos de 2026 coinciden con los oficiales.
- Reglas: una noche de la estadía cae en la ventana del feriado (víspera + día); finde largo = desde la víspera del primer día libre;
  verano = alguna noche entre el 2/1 y el 10/3 inclusive; el día de check-out no es noche.


---

# Ronda 2 — calendario más limpio, guardado directo, % de pago, personas y PROMO

## Qué se cambió
| Pedido | Qué se hizo |
|---|---|
| Fechas especiales "muy grandes" en el calendario | En las barras queda **solo un ícono mínimo** (bandera / 🎆 / 🎄 / 🎭 / ✝️ y ☀️ de verano). Todo el detalle (feriado, fechas del finde largo, verano) está en el **tooltip**. La lista y la ficha usan chips chicos con texto. La bandera 🇦🇷 ahora se dibuja con CSS: el emoji se ve como «AR» en Windows. |
| Reservas pasadas con descuento/recargo "borrosas" | Eran **tres efectos apilados**: (1) `past-col .bar { brightness(.72) }` oscurecía TODA barra cuyo día de ingreso fuera pasado, aunque la estadía siguiera en curso; (2) en reservas en curso el fondo se reemplazaba por «oscuro→color base», perdiendo el naranja del descuento / amarillo de la noche gratis / tono del recargo; (3) transición de color de ~8 puntos (se percibía como desenfoque). Ahora: un solo atenuado suave (`saturate`) que no toca el texto, el tramo transcurrido es una capa translúcida encima del fondo, cortes de color nítidos y el recargo ya no queda casi negro. |
| Guardar sin llegar al último paso | Botón **💾 Guardar cambios** al editar, visible en los pasos 1 a 3 (en el 4 el botón principal ya guarda). Valida todo y, si falta algo, te lleva al paso correspondiente. Protegido contra clics repetidos. |
| % del total junto al pago | En el paso Pagos (por cada pago y en el resumen «Abonado / Saldo»), en la ficha (Pagado, Saldo, cada pago del historial) y en la tarjeta de la lista («33,3 % abonado · resta 66,7 %»). Se calcula sobre el total de la estadía; siempre suma 100. Ejemplo: de $10 abona $2 → **20 %** (resta 80 %). |
| Adultos y menores en la tarjeta | «👥 4 · 3 adultos + 1 menor». También en la ficha y en el tooltip (que antes mostraba «1 adulto» con 4 personas). |
| PROMO | Si hay noches sin cargo: **PROMO 2+1** (3 noches, abona 2), **3+1** (4 noches, abona 3)… en la tarjeta, la ficha y el tooltip. |

## Fuente única de feriados
`js/services/arg-holidays.js` (lo usan los encabezados del calendario, las notificaciones y la temporada alta) tenía un cálculo
propio e **incorrecto**: movía el Día de la Bandera (es inamovible), calculaba San Martín/Diversidad/Soberanía como «n-ésimo lunes»,
omitía Güemes y el Jueves Santo e **inventaba puentes**. Ahora es una vista de `special-dates.js` (misma fecha en el calendario y en las etiquetas).
También se corrigió que un feriado que coincidía con las vacaciones de invierno estimadas (p. ej. 9/7/2024) dejaba de verse como feriado.

## Para el próximo año
- **2027 no tiene puentes cargados** (no hay decreto todavía). Cuando se publique, agregarlo en `TOURIST_BRIDGES` (`js/services/special-dates.js`).
- El 20/11/2027 cae sábado: si el Gobierno lo traslada, agregarlo en `MOVED_WEEKEND_HOLIDAYS`.
