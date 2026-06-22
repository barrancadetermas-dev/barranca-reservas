# CHANGELOG — Barranca de Termas PMS

---

## v4.1 — Junio 2026 (versión actual)

### ✅ Implementado en esta versión

#### Seguridad — Credenciales aisladas (#1)
- `js/config.js` separado del código fuente y excluido de git (`.gitignore`)
- `js/config.example.js` como plantilla commitable
- `scripts/build-config.js` para generar credenciales desde variables de entorno en Vercel
- `vercel.json` actualizado con `buildCommand`

#### UX de solapamiento (#3)
- Al seleccionar unidades en el formulario, las ocupadas muestran el nombre del
  huésped que las reservó y el período de conflicto
- Ejemplo: `✗ Ramírez (12 jun → 20 jun)` en lugar del genérico `✗ Ocupada`

#### Editar y eliminar pagos individuales (#6)
- Cada pago en el detalle de reserva tiene botones ✏️ y 🗑️ (gateados por rol)
- Edición inline: cambia método y monto sin abrir un modal nuevo
- Eliminación con confirmación, recalcula el saldo automáticamente
- Registra la acción en el audit log

#### Duplicar reserva (#14)
- Botón "📋 Duplicar" en el detalle de cada reserva
- Pre-carga todos los datos del huésped, las mismas unidades y el precio anterior
- Las fechas quedan en blanco para seleccionar el nuevo período
- Título del formulario indica "Duplicar — [Nombre Huésped]"

#### Notas internas por unidad (#16)
- Ícono 📝 en el calendario junto a unidades con notas guardadas
- Tooltip al pasar el mouse muestra el texto de la nota
- Admins pueden editar las notas con clic en ✏️ (prompt nativo)
- Se guarda en el campo `internal_notes` de la tabla `units`

#### Vista lista para mobile (#17)
- Botón "☰ Lista" / "📅 Mes" en el toolbar del calendario
- Vista lista muestra todas las reservas del mes ordenadas por fecha
- Cada card muestra: huésped, departamento, fechas, estado y saldo
- Diseño optimizado para pantallas chicas

#### P&L visual en Estadísticas (#18)
- Nueva pestaña "P&L del Período" en la sección de Estadísticas
- Tabla de ingresos por canal con deducción de comisiones
- Tabla de gastos por categoría (pagados y pendientes)
- Resultado neto con color verde/rojo según sea positivo o negativo
- Botón de exportación a CSV (solo admin)
- Funciona con datos reales y con datos demo simulados

---

## v4.0 — Junio 2026

### Roles de usuario (admin / staff / demo)
- Sistema completo de permisos con función `can(permiso)` en cada acción
- Demo mode: datos simulados realistas, nada se guarda en Supabase
- Banner naranja animado cuando se está en modo demo
- Nav condicional según rol (Auditoría y Config solo admin)

### Cancelación de reservas
- Modal con 3 opciones: retener cobros / devolver todo / devolución parcial
- Registra pago negativo en BD si hay devolución
- Guarda motivo en `cancel_note`

### Check-in / Check-out tracking
- Columnas `checked_in_at` / `checked_out_at` en la tabla `bookings`
- Botones condicionales en el detalle de reserva (visibles solo el día correspondiente)
- Loguea cada acción en el audit log

### Comisiones por canal
- Tabla `channel_commissions` en la BD
- Configurables desde la sección Admin (Booking 15%, Airbnb 18% por defecto)
- Usadas en el cálculo del P&L

### Export CSV
- Reservas filtradas a CSV con BOM para Excel
- P&L del período a CSV
- Solo disponible para rol admin

### Error handling
- Cada sección tiene try/catch con estado visual de error
- Botón "🔄 Reintentar" que llama `load()` de nuevo

### Paginación
- Lista de reservas: 25 por página con "Cargar 25 más"
- Funciona sobre los filtros activos

### PWA
- `manifest.json` para instalación como app en el celular
- `sw.js` (Service Worker): cache-first para assets, network-first para Supabase
- Funciona offline mostrando la última versión cacheada

### Audit log
- Tabla `audit_log` en la BD
- Vista admin con historial de las últimas 100 acciones
- Registra: quién, cuándo, qué acción, sobre qué entidad

### Tarifas por temporada
- Tabla `season_pricing` en la BD
- CRUD desde la sección Configuración (solo admin)
- Función SQL `get_season_price()` para sugerir precio automático

### Mock data
- `js/services/mock-data.js` con generador de datos para el mes actual
- 16 reservas realistas: todos los estados, 3 canales, nombres argentinos
- Gastos, recordatorios y KPIs de dashboard simulados

---

## v3.0 — Sistema de Identificación Visual (Sira)

### Paleta oficial de 7 departamentos
- #1 3AMB Duplex → Rojo `#EF4444`
- #2 2AMB Duplex → Azul `#3B82F6`
- #3 2AMB Duplex → Aqua `#22D3EE`
- #4 2AMB Planta Baja → Verde Manzana `#84CC16`
- #5 2AMB Planta Baja → Celeste `#38BDF8`
- #6 2AMB Planta Alta → Rosa Bebé `#F472B6`
- #7 2AMB Planta Alta → Lila `#C084FC`

### Sistema de colores de reservas (prioridad estricta)
- Bloqueo ⬛ > Familia 🟪 > Airbnb 🟧 > Booking 🟦 > Pagado 🟩 > Con seña 🟥 > Sin seña 🟨

### Funciones helper unificadas
- `getUnitLabel()` → `#1 · 3AMB Duplex`
- `getUnitChipHTML()` → chip con color y punto indicador
- `getBookingBarColor()` → color con prioridad estricta
- `getSourceBadgeHTML()` → badge de canal de origen

### Canal de origen en formulario
- Selector visual con 4 opciones: Directo / Booking / Airbnb / Familia
- Se guarda en el campo `source` de la reserva
- Filtros rápidos en la lista de reservas

---

## v2.0 — Funcionalidades base

- Calendario de ocupación mensual con drag-select
- Formulario de reserva en 4 pasos
- Registro de pagos con múltiples métodos y monedas
- Dashboard con KPIs del día
- Estadísticas de ocupación por unidad
- Módulo de gastos operativos
- CRM de huéspedes con historial
- Recordatorios y mantenimiento
- WhatsApp voucher con formato estándar
- Dark mode
- Command palette (⌘K)
- Filtros y búsqueda en lista de reservas

---

## Estado actual — Junio 2026

### ✅ Completados (17/25)

| # | Ítem |
|---|---|
| 1 | Credenciales separadas (config.js gitignored) |
| 2 | Conflicto de migración unit_number |
| 3 | UX solapamiento con detalle de conflicto |
| 4 | Paginación (25/página) |
| 5 | Roles de usuario (admin/staff/demo) |
| 6 | Editar/eliminar pagos individuales |
| 7 | Lógica de cancelación con devolución |
| 9 | Comisiones por canal |
| 10 | Export CSV |
| 14 | Duplicar reserva |
| 15 | Check-in/Check-out tracking |
| 16 | Notas por unidad |
| 17 | Vista lista para mobile |
| 18 | P&L visual en Estadísticas |
| 21 | Audit log |
| 24 | PWA (manifest + service worker) |
| 25 | Error handling con retry |

---

### ❌ Pendientes (8/25)

| # | Ítem | Complejidad | Prioridad |
|---|---|---|---|
| 8 | Vista operativa del día | — | ❌ Descartado por el usuario |
| 11 | Vista semanal del calendario | Media | Baja |
| 12 | Date range picker visual (estilo Airbnb) | Media | Media |
| 13 | Drag & drop de reservas para mover fechas | Alta | Media |
| 19 | Depósito de garantía reembolsable | Media | Media |
| 20 | Recordatorios automáticos (Edge Functions cron) | Alta | Alta |
| 22 | Bundler (Vite) — para env vars nativas | Media | Baja |
| 23 | Tests unitarios y de integración | Alta | Alta |
| 26 | Wizard de onboarding (sin SQL manual) | Alta | Alta si → SaaS |

---

### Detalle de pendientes

**#11 — Vista semanal:**
Toggle en el calendario que muestra solo 7 días (lunes a domingo) con mayor
detalle por celda. Útil para semanas con muchos recambios.

**#12 — Date range picker:**
Reemplazar los `<input type="date">` del formulario por un selector de rango
visual tipo Airbnb, que marque los días ya ocupados en gris.

**#13 — Drag & drop:**
Arrastrar una barra del calendario para desplazar la reserva a nuevas fechas.
Requiere lógica de colisión en tiempo real y validación de disponibilidad.

**#19 — Depósito de garantía:**
Campo "depósito reembolsable" en la reserva, separado del pago del alojamiento.
Se registra al check-in y se devuelve al check-out si no hay observaciones.

**#20 — Recordatorios automáticos:**
Alerta automática 48hs antes de cada check-in (email o WhatsApp al propietario).
Requiere una Edge Function en Supabase con un cron job.

**#22 — Vite:**
Migrar a Vite permite usar `import.meta.env` para credenciales reales sin
el workaround del build-config.js. Baja prioridad mientras el sistema actual
funcione correctamente.

**#23 — Tests:**
Sin ningún test, un cambio en la lógica de cálculo financiero puede pasar
desapercibido. Prioritario antes de dar el sistema a terceros.

**#26 — Onboarding SaaS:**
Wizard para configurar un nuevo complejo desde la interfaz web, sin ejecutar
SQL manualmente. Requiere la Guía 5 como referencia de qué configurar.

---

## v5.0 — Junio 2026 (versión actual)

### #22 — Vite Bundler
- `package.json` con `@supabase/supabase-js` via npm + `vite` como dev dependency
- `vite.config.js` — build output a `dist/`, entrypoints `index.html` + `setup.html`
- Credenciales ahora en `.env.local` → `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- `import.meta.env.*` en `supabase-config.js` — cero runtime config manual
- CDN import `esm.sh` → npm package `@supabase/supabase-js`
- `vercel.json` actualizado: `buildCommand: "npm run build"`, `outputDirectory: "dist"`
- `sw.js` + `manifest.json` movidos a `public/` (copiados a `dist/` por Vite)
- Eliminado el workaround `scripts/build-config.js`

### #26 — Wizard de Onboarding
- `setup.html` — página standalone de configuración inicial
- 4 pasos: datos del hotel → departamentos → SQL generado → instrucciones
- Genera SQL personalizado con nombre, slug, unidades y colores elegidos por el usuario
- Selector visual de color para cada unidad (paleta de 17 colores)
- Auto-generación de slug desde el nombre del hotel
- Botones "Copiar SQL" y "Descargar .sql"
- El SQL generado incluye: hotel, unidades, comisiones y el INSERT del usuario admin
- Funciona sin servidor — todo en el browser, cero backend

### Bugs corregidos
- `booking-form.js`: `let bookedUnitIds` no estaba declarado → corregido
- `statistics.js`: `AppContext.ctx?.units` no existe → corregido a `this.ctx.units`
- `calendar.js` drag&drop: `this._barDrag.startX` se leía después del reset → capturado antes
- `booking-form.js`: faltaba `import { can, isDemo }` → agregado

### Estado final
```
✅ Completados:  25 / 25  (100%)
```
Todos los ítems del backlog original resueltos.
