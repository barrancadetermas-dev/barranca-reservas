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
