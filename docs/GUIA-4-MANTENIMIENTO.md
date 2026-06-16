# Guía 4 — Mantenimiento del sistema

Esta guía explica cómo hacer backups, exportar datos, actualizar el sistema
y qué hacer si algo sale mal.

---

## PARTE 1 — Backups de la base de datos

### ¿Por qué hacer backups?

Los datos de las reservas y huéspedes son valiosos. Aunque Supabase
tiene sus propios respaldos automáticos, es buena práctica tener
copias propias.

---

### Backup automático de Supabase

Supabase hace backups automáticos diarios en los planes pagos.
En el plan gratuito, podés hacer backups manuales.

#### Cómo hacer un backup manual:

1. Entrá a tu proyecto en Supabase
2. En el menú izquierdo, hacé clic en **"Settings"** → **"Database"**
3. Bajá hasta la sección **"Backups"**
4. Hacé clic en **"Create backup"**
5. Cuando esté listo, hacé clic en **"Download"**

Guardá el archivo descargado en un lugar seguro (Google Drive, pendrive, etc.)

⏰ **Recomendación:** hacé un backup al menos una vez por mes.

---

### Exportar datos desde el sistema

El sistema tiene exportación CSV integrada:

1. Andá a la sección **"Reservas"** en el sistema
2. Aplicá los filtros que necesitás (período, estado, canal)
3. Hacé clic en **"📥 Exportar CSV"**
4. El archivo se descarga automáticamente y se puede abrir en Excel

Para el reporte P&L:
1. Andá a **"Estadísticas"** → pestaña **"P&L del Período"**
2. Hacé clic en **"📥 Exportar"**

---

## PARTE 2 — Actualizar el sistema

Cuando recibas una nueva versión del sistema, seguí estos pasos:

### Actualización simple (un archivo)

Si solo cambia un archivo:
1. Entrá a tu repositorio en GitHub
2. Navegá hasta el archivo que necesitás actualizar
3. Hacé clic en el ícono del lápiz (✏️)
4. Reemplazá el contenido con el nuevo
5. Hacé clic en **"Commit changes"**
6. Vercel detecta el cambio y actualiza el sitio en 1-2 minutos

### Actualización masiva (muchos archivos)

Si hay muchos archivos para actualizar:
1. Descargá el nuevo ZIP del sistema
2. Descomprimilo en tu computadora
3. En GitHub, subí los archivos actualizados (arrastrando como hiciste la primera vez)

⚠️ **Nunca toques los archivos de la carpeta `scripts/`** a menos que
se te indique explícitamente. Son los scripts SQL de la base de datos.

---

### Si hay cambios en la base de datos

Cuando la actualización incluye un nuevo archivo SQL de migración,
tenés que ejecutarlo en Supabase:

1. Entrá al SQL Editor de Supabase
2. Abrí el nuevo archivo SQL
3. Copiá el contenido
4. Pegalo en el SQL Editor
5. Hacé clic en "Run"
6. Verificá que diga "Success"

Los archivos de migración siempre están en la carpeta `scripts/` y tienen
nombres como `migration_v5_algofuncion.sql`.

**Orden de ejecución (siempre este orden, nunca alterarlo):**
1. `schema.sql`
2. `seed.sql`
3. `migration_guests_crm.sql`
4. `migration_v3_identification.sql`
5. `migration_v4_operations.sql`
6. (nuevas migraciones futuras en orden numérico)

---

## PARTE 3 — Cómo volver atrás si algo falla

### Si el sitio dejó de funcionar después de una actualización

**Opción 1 — Volver a la versión anterior en Vercel:**
1. Entrá a tu proyecto en Vercel
2. Hacé clic en **"Deployments"**
3. Buscá el último deployment que funcionaba bien
4. Hacé clic en los tres puntos `...` → **"Promote to Production"**
5. El sitio vuelve a la versión anterior en segundos

**Opción 2 — Revertir el cambio en GitHub:**
1. Entrá a tu repositorio en GitHub
2. Hacé clic en **"Commits"**
3. Encontrá el commit justo antes del cambio problemático
4. Hacé clic en `<>` para ver los archivos en ese estado
5. Copiá el contenido del archivo que se dañó y restauralo

---

### Si perdiste datos en la base de datos

1. Entrá a Supabase → Settings → Backups
2. Restaurá desde el backup más reciente
3. Si el backup de Supabase no alcanza, usá el CSV que exportaste

⚠️ La restauración de backups en Supabase gratuito es manual.
Si los datos son críticos, considerá actualizar al plan Pro de Supabase
que incluye restauración automática.

---

## PARTE 4 — Agregar o quitar usuarios

### Agregar un nuevo usuario (staff)

1. En Supabase → Authentication → Users, hacé clic en "Add user"
2. Completá email y contraseña
3. En el SQL Editor, ejecutá:
```sql
INSERT INTO hotel_users (hotel_id, user_id, role)
SELECT
  (SELECT id FROM hotels WHERE slug = 'barranca-de-termas'),
  'UUID-DEL-NUEVO-USUARIO',
  'staff';  -- o 'admin' o 'demo'
```

### Cambiar el rol de un usuario

```sql
UPDATE hotel_users
SET role = 'staff'  -- cambiar al rol deseado: 'admin', 'staff' o 'demo'
WHERE user_id = 'UUID-DEL-USUARIO';
```

### Desactivar un usuario

En Supabase → Authentication → Users, hacé clic en el usuario
y seleccioná "Ban" o simplemente cambiá su contraseña.

---

## Mantenimiento preventivo recomendado

| Tarea | Frecuencia |
|---|---|
| Backup manual de Supabase | Mensual |
| Exportar CSV de reservas del mes | Mensual |
| Revisar recordatorios pendientes | Semanal |
| Verificar que el sistema abre correctamente | Semanal |

---

*Siguiente paso: adaptar el sistema para otro alojamiento → [GUIA-5-PERSONALIZACION.md](GUIA-5-PERSONALIZACION.md)*
