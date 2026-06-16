# Guía 1 — Instalación desde cero

Esta guía es para alguien que **nunca usó GitHub ni Supabase**.
Seguí los pasos en orden. No te saltes ninguno.

---

## Antes de empezar

Necesitás:
- Una computadora con internet
- Una dirección de email para crear las cuentas
- El archivo ZIP del sistema (que te compartieron)
- Aproximadamente 1 hora de tu tiempo

---

## PARTE 1 — GitHub (donde se guarda el código)

### ¿Qué es GitHub?

Pensalo como un "Google Drive para código". Es donde vas a guardar todos los
archivos del sistema. Desde ahí, Vercel (el hosting) los va a leer para
publicar tu sitio web.

Es **gratuito** para lo que necesitamos.

---

### Paso 1 — Crear cuenta en GitHub

1. Abrí el navegador y entrá a: **https://github.com**
2. Hacé clic en el botón verde **"Sign up"** (arriba a la derecha)
3. Escribí tu email y elegí una contraseña
4. Verificá tu email cuando llegue el correo de GitHub
5. Completá el formulario de bienvenida (podés poner que es para uso personal)

✅ Ya tenés cuenta en GitHub.

---

### Paso 2 — Crear un repositorio

Un repositorio es como una carpeta en GitHub donde va a vivir el proyecto.

1. Una vez dentro de GitHub, hacé clic en el botón **"New"** (verde, arriba a la izquierda)
   — o entrá a: **https://github.com/new**
2. En **"Repository name"** escribí: `barranca-termas-pms`
3. En **"Description"** podés escribir: `Sistema de gestión de reservas`
4. **MUY IMPORTANTE:** Seleccioná **"Private"** (repositorio privado)
   Esto es para que nadie más pueda ver el código con tus credenciales.
5. Hacé clic en **"Create repository"**

✅ Tu repositorio está creado.

---

### Paso 3 — Subir los archivos del proyecto

1. Descomprimí el archivo ZIP del sistema en tu computadora
   (hacé clic derecho → Extraer todo / Descomprimir)
2. Dentro de GitHub, en tu repositorio vacío, vas a ver un texto que dice
   **"uploading an existing file"** — hacé clic en eso
3. Se abre una ventana para subir archivos.
   **Arrastrá TODA la carpeta** descomprimida hasta esa ventana.
   GitHub va a subir todos los archivos automáticamente.
4. Bajá hasta el final de la página y hacé clic en **"Commit changes"**

⏳ Esperá unos minutos mientras se suben todos los archivos.

✅ El código está en GitHub.

---

### ¿Cómo actualizar archivos en el futuro?

Cuando recibas una nueva versión del sistema:
1. Entrá a tu repositorio en GitHub
2. Hacé clic en el archivo que querés actualizar
3. Hacé clic en el ícono del lápiz (✏️) para editar
4. Pegá el nuevo contenido
5. Hacé clic en **"Commit changes"**

O para subir archivos nuevos: usá el mismo proceso de arrastrar que usaste
en el Paso 3.

---

## PARTE 2 — Supabase (donde se guardan los datos)

### ¿Qué es Supabase?

Es la base de datos del sistema. Acá es donde se guardan todas las reservas,
los huéspedes, los pagos y toda la información del complejo.

Es **gratuito** para el uso que vamos a darle.

---

### Paso 4 — Crear cuenta en Supabase

1. Entrá a: **https://supabase.com**
2. Hacé clic en **"Start your project"** (botón verde)
3. Podés registrarte con tu cuenta de GitHub (recomendado, es más rápido)
   o con tu email
4. Verificá tu email si te piden hacerlo

✅ Cuenta creada.

---

### Paso 5 — Crear un proyecto en Supabase

1. Una vez adentro, hacé clic en **"New project"**
2. Completá los campos:
   - **Name:** `barranca-termas` (o el nombre que prefieras)
   - **Database Password:** elegí una contraseña segura y **ANOTALA** en algún lugar seguro
   - **Region:** elegí **South America (São Paulo)** — es la más cercana a Argentina
3. Hacé clic en **"Create new project"**

⏳ Esperá 2-3 minutos mientras Supabase crea la base de datos.
Vas a ver un círculo girando. Cuando aparezca el dashboard, está listo.

✅ Tu base de datos está creada.

---

### Paso 6 — Ejecutar los scripts SQL (crear las tablas)

Ahora tenés que crear la estructura de la base de datos. Esto se hace
ejecutando unos archivos SQL en orden.

1. En el menú izquierdo de Supabase, hacé clic en **"SQL Editor"**
   (tiene un ícono de terminal `>_`)
2. Hacé clic en **"New query"**

Ahora vas a ejecutar los siguientes archivos **en este orden exacto**.
Para cada uno:
- Abrí el archivo en tu computadora con el Bloc de Notas
- Seleccioná todo el texto (Ctrl+A)
- Copialo (Ctrl+C)
- Pegalo en el SQL Editor de Supabase (Ctrl+V)
- Hacé clic en el botón **"Run"** (arriba a la derecha, con un ▶️)
- Esperá que diga "Success" antes de continuar con el siguiente

### Orden de ejecución:

**Archivo 1:** `scripts/schema.sql`
> Crea todas las tablas del sistema.
> Cuando termine, vas a ver muchas líneas verdes. Eso es correcto.

**Archivo 2:** `scripts/seed.sql`
> Carga los datos iniciales: los 7 departamentos con sus colores y nombres.

**Archivo 3:** `scripts/migration_guests_crm.sql`
> Agrega funcionalidades del módulo de huéspedes.

**Archivo 4:** `scripts/migration_v3_identification.sql`
> Actualiza los colores oficiales de cada departamento.

**Archivo 5:** `scripts/migration_v4_operations.sql`
> Agrega funcionalidades de operativa: check-in, auditoría, temporadas.

⚠️ Si alguno muestra un error en rojo, **no continuás con el siguiente**.
Copiá el mensaje de error y consultalo.

✅ La base de datos está configurada.

---

### Paso 7 — Verificar que todo quedó bien

1. En el menú izquierdo de Supabase, hacé clic en **"Table Editor"**
2. Deberías ver varias tablas: `hotels`, `units`, `bookings`, `guests`, etc.
3. Hacé clic en la tabla `units`
4. Deberías ver 7 filas, una por cada departamento

Si ves las 7 filas, todo salió bien. ✅

---

### Paso 8 — Obtener las credenciales

Las credenciales son los datos que el sistema necesita para conectarse
a tu base de datos.

1. En el menú izquierdo de Supabase, hacé clic en **"Settings"** (ícono de engranaje ⚙️)
2. Hacé clic en **"API"**
3. Vas a ver dos datos importantes. **Anotalos en algún lugar seguro:**

   - **Project URL:** algo como `https://abcdefgh.supabase.co`
   - **anon public key:** una cadena larga que empieza con `eyJ...`

⚠️ La `anon public key` es segura compartir — es de solo lectura pública.
Nunca compartas la `service_role key` (la que dice "secret").

---

### Paso 9 — Configurar las credenciales en el código

Las credenciales se configuran usando un archivo `.env.local` (para desarrollo local)
y variables de entorno en Vercel (para producción). Nunca se guardan en el código.

**Para desarrollo local:**

1. En la carpeta del proyecto en tu computadora, buscá el archivo `.env.example`
2. Copialo y renombrá la copia como `.env.local`
3. Abrí `.env.local` con el Bloc de Notas y reemplazá los valores:

```
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...TU_CLAVE...
```

4. Guardá el archivo. **No subas este archivo a GitHub** (está en .gitignore automáticamente).

**Para Vercel (producción):** Ver Paso 3 de la Guía 2.

✅ Las credenciales están configuradas.

---

## PARTE 3 — Crear el primer usuario administrador

### Paso 10 — Crear usuario en Supabase Auth

1. En Supabase, hacé clic en **"Authentication"** (ícono de persona 👤)
2. Hacé clic en **"Users"**
3. Hacé clic en **"Invite user"** o **"Add user"**
4. Ingresá el email del administrador y una contraseña
5. Hacé clic en **"Create user"**

---

### Paso 11 — Obtener el UUID del usuario

El UUID es un identificador único que Supabase le asigna a cada usuario.

1. En la lista de usuarios, hacé clic en el que acabás de crear
2. Copiá el campo **"User UID"** — es algo como `550e8400-e29b-41d4-a716-446655440000`

---

### Paso 12 — Asociar el usuario al hotel

1. En Supabase, andá al **SQL Editor**
2. Pegá y ejecutá este código (reemplazando los valores):

```sql
INSERT INTO hotel_users (hotel_id, user_id, role)
SELECT
  (SELECT id FROM hotels WHERE slug = 'barranca-de-termas'),
  'PEGAR-AQUI-EL-UUID-DEL-USUARIO',
  'admin';
```

3. Hacé clic en **"Run"**

✅ El usuario administrador está configurado.

---

### Paso 13 — Verificar acceso

Para verificar antes de publicar:
1. Si tenés el proyecto corriendo localmente (abriendo `index.html` en el navegador),
   probá entrar con el email y contraseña del usuario que creaste.
2. Debería abrir el panel de control con el calendario y los departamentos.

Si ves el sistema, ¡todo está funcionando! ✅

---

## Errores comunes y soluciones

**Error: "Hotel no encontrado"**
→ El `HOTEL_SLUG` en `config.js` no coincide con el slug de la tabla `hotels`.
Verificá que en la tabla `hotels` exista una fila con `slug = 'barranca-de-termas'`.

**Error: "Invalid API key"**
→ La `SUPABASE_ANON_KEY` en `config.js` está mal copiada.
Copiala de nuevo desde Supabase Settings → API.

**El SQL muestra un error de "relation already exists"**
→ Probablemente ejecutaste el mismo script dos veces.
Podés ignorar ese error y continuar con el siguiente archivo.

**No veo los 7 departamentos**
→ El archivo `seed.sql` no se ejecutó o tuvo un error.
Ejecutalo de nuevo desde el SQL Editor.

---

*Siguiente paso: publicar el sistema en internet → [GUIA-2-PUBLICACION.md](GUIA-2-PUBLICACION.md)*
