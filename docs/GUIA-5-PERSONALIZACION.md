# Guía 5 — Adaptar el sistema para otro complejo

Esta guía explica cómo reutilizar este sistema para un alojamiento diferente.
La estrategia es simple: **duplicar el proyecto y cambiar la configuración**.

No es necesario tocar la lógica del sistema. Solo cambiar datos y colores.

---

## Resumen del proceso

1. Duplicar el repositorio de GitHub
2. Crear una nueva base de datos en Supabase
3. Cambiar el nombre y datos del complejo
4. Cambiar los colores del sistema
5. Configurar las unidades (habitaciones/departamentos)
6. Publicar en Vercel

---

## PASO 1 — Duplicar el repositorio de GitHub

No modifiques el repositorio original. Creá uno nuevo:

1. En GitHub, entrá al repositorio original (`barranca-termas-pms`)
2. Hacé clic en el botón **"Code"** → **"Download ZIP"**
3. Descomprimí el ZIP en tu computadora
4. Renombrá la carpeta con el nombre del nuevo complejo
5. Creá un nuevo repositorio en GitHub con el nombre del nuevo complejo
6. Subí los archivos del nuevo repositorio

---

## PASO 2 — Nueva base de datos en Supabase

Creá un proyecto nuevo en Supabase (no reutilices el de Barranca de Termas).
Seguí los pasos de la Guía 1, Parte 2.

---

## PASO 3 — Cambiar el nombre y datos del complejo

### Archivo: `js/supabase-config.js`

Cambiá el slug del hotel:
```javascript
export const HOTEL_SLUG = 'nombre-del-nuevo-complejo';
```

Usá el mismo slug en el archivo SQL (ver más abajo).

---

### Archivo: `scripts/seed.sql`

Este archivo carga los datos iniciales del hotel. Editá:

```sql
-- Cambiar nombre, descripción, slug, zona horaria y ciudad
INSERT INTO hotels (name, slug, description, timezone, city, country)
VALUES (
  'Nombre del Nuevo Complejo',        -- nombre visible
  'nombre-del-nuevo-complejo',         -- slug (sin espacios, en minúsculas)
  'Complejo de apartamentos en...',    -- descripción corta
  'America/Argentina/Buenos_Aires',    -- zona horaria
  'Ciudad',                            -- ciudad
  'Argentina'                          -- país
)
ON CONFLICT (slug) DO NOTHING;
```

---

## PASO 4 — Cambiar los colores del sistema

### Color primario de la interfaz

En el archivo `css/styles.css`, buscá la sección de variables CSS al inicio:

```css
:root {
  --color-primary:   #6366F1;  /* ← cambiar este valor */
  --color-primary-d: #4F46E5;  /* versión oscura del primario */
  --color-primary-l: rgba(99, 102, 241, 0.08);
```

Reemplazá `#6366F1` con el color de la marca del nuevo complejo.

**Herramienta para elegir colores:** https://colorpicker.me

---

### Colores de las unidades

En el archivo `js/supabase-config.js`, cambiá la paleta de colores:

```javascript
export const UNIT_PALETTE = {
  1: '#EF4444',  // unidad 1 → rojo
  2: '#3B82F6',  // unidad 2 → azul
  3: '#22D3EE',  // unidad 3 → aqua
  4: '#84CC16',  // unidad 4 → verde
  5: '#38BDF8',  // unidad 5 → celeste
  6: '#F472B6',  // unidad 6 → rosa
  7: '#C084FC',  // unidad 7 → lila
};
```

Asignale un color distinto a cada unidad del nuevo complejo.
Si el complejo tiene menos unidades, dejá solo las que correspondan.
Si tiene más, agregá más números.

---

## PASO 5 — Configurar las unidades

### En el archivo `js/supabase-config.js`, cambiá los nombres:

```javascript
export const UNIT_NAMES = {
  1: 'Cabaña Lago',     // ejemplo para un complejo de cabañas
  2: 'Cabaña Bosque',
  3: 'Suite Vista',
  // etc.
};
```

### En el archivo `scripts/seed.sql`, actualizá las unidades:

```sql
INSERT INTO units (hotel_id, name, description, max_guests, floor, sort_order, color, is_active)
VALUES
  (v_hotel_id, 'Cabaña Lago',   'Cabaña con vista al lago. Hasta 6 personas.',  6, 'A', 1, '#EF4444', TRUE),
  (v_hotel_id, 'Cabaña Bosque', 'Cabaña rodeada de pinos. Hasta 4 personas.',   4, 'B', 2, '#3B82F6', TRUE),
  -- agregar todas las unidades del nuevo complejo
ON CONFLICT DO NOTHING;
```

Los campos son:
- **name:** nombre de la unidad
- **description:** descripción breve
- **max_guests:** máximo de personas
- **floor:** categoría o sector (texto libre)
- **sort_order:** número de orden (1, 2, 3...)
- **color:** color en hexadecimal

---

## PASO 6 — Cambiar el logo y nombre en la interfaz

### Nombre del sistema en el navegador

En el archivo `index.html`, buscá y cambiá:
```html
<title>Barranca de Termas · PMS</title>
```
por:
```html
<title>Nombre del Complejo · PMS</title>
```

### Nombre en el sidebar

En el mismo `index.html`, buscá:
```html
<span class="hotel-name">Barranca de Termas</span>
```
y cambialo con el nuevo nombre.

### Logo

Si el complejo tiene un logo:
1. Guardá el logo como `logo.png` en la carpeta raíz del proyecto
2. En `index.html`, reemplazá el ícono de la casa (🏠) con una imagen:
```html
<img src="/logo.png" alt="Logo" style="height:32px">
```

---

## PASO 7 — Cambiar los canales de origen (opcional)

Si el nuevo complejo no usa Booking o Airbnb, podés cambiar las fuentes en:

**`js/supabase-config.js`:**
```javascript
export const SOURCE_CONFIG = {
  direct:  { label: 'Directo',  ... },
  booking: { label: 'Booking',  ... },
  airbnb:  { label: 'Airbnb',   ... },
  family:  { label: 'Familia',  ... },
};
```

---

## PASO 8 — Publicar el nuevo sistema

Seguí exactamente la Guía 2 (Publicación), pero:
- Usá el nuevo repositorio de GitHub
- Configurá las credenciales del **nuevo** proyecto de Supabase en Vercel

---

## Checklist final

Antes de dar el sistema por listo para el nuevo complejo:

- [ ] El nombre del complejo aparece correctamente en la interfaz
- [ ] Se ven las unidades correctas en el calendario
- [ ] Cada unidad tiene su color asignado
- [ ] Se puede crear una reserva de prueba
- [ ] Los pagos se registran correctamente
- [ ] El PDF/WhatsApp del comprobante muestra el nombre correcto
- [ ] El login funciona para el administrador del nuevo complejo

---

## ¿Qué NO tocar?

Todo lo que no se menciona en esta guía **no necesita cambiarse**.
En especial:
- La lógica de reservas y pagos
- El sistema de roles y permisos
- Las estadísticas y P&L
- El calendario y filtros
- El sistema de colores de reservas

Esa lógica es genérica y funciona igual para cualquier complejo.

---

*¿Dudas? Consultá la documentación principal o al desarrollador del sistema.*
