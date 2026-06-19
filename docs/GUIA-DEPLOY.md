# MILA — Guía de Instalación y Uso para Principiantes

> Esta guía está escrita para alguien que **nunca programó**. Seguí los pasos exactamente como están y vas a tener el sistema funcionando.

---

## ¿Qué vas a necesitar?

- Una computadora con Windows, Mac o Linux
- Conexión a internet
- Aproximadamente 1 hora de tiempo

---

## PASO 1 — Descargar el proyecto

1. Descargá el archivo ZIP de MILA desde el link que te compartieron
2. Hacé **doble clic** en el archivo ZIP para descomprimirlo
3. Vas a ver una carpeta llamada `mila-pms-v6.x` (o similar)
4. Movela a un lugar fácil de encontrar, por ejemplo: `Documentos/MILA`

📸 *[Captura recomendada: carpeta MILA abierta en el explorador de archivos]*

---

## PASO 2 — Instalar las herramientas necesarias

### Instalar Node.js

Node.js es el programa que hace funcionar MILA en tu computadora.

1. Abrí el navegador y andá a: **https://nodejs.org**
2. Hacé clic en el botón verde grande que dice **"LTS"** (versión recomendada)
3. Descargá e instalá el archivo (siguiente, siguiente, finalizar)
4. Para verificar: abrí el programa **Terminal** (Mac/Linux) o **Command Prompt** (Windows) y escribí:
   ```
   node --version
   ```
   Si ves algo como `v20.x.x`, está instalado correctamente ✓

### Instalar Git

Git es la herramienta para subir el código a GitHub.

1. Andá a: **https://git-scm.com/downloads**
2. Descargá e instalá para tu sistema operativo
3. En la instalación, dejá todas las opciones por defecto

📸 *[Captura recomendada: página de descarga de Node.js con el botón LTS resaltado]*

---

## PASO 3 — Crear una cuenta en GitHub

GitHub es donde se guarda el código de MILA.

1. Andá a: **https://github.com**
2. Hacé clic en **"Sign up"** (Registrarse)
3. Completá:
   - Email: tu correo
   - Password: una contraseña segura
   - Username: un nombre de usuario (ej: `mariano-mila`)
4. Verificá tu email haciendo clic en el link que te llegó

📸 *[Captura recomendada: formulario de registro de GitHub]*

---

## PASO 4 — Crear un repositorio en GitHub

1. Una vez logueado en GitHub, hacé clic en el botón verde **"New"** o **"+ New repository"**
2. Completá:
   - **Repository name:** `mila-pms`
   - **Description:** `Sistema de gestión de alojamientos MILA`
   - Seleccioná: **Private** (para que solo vos lo veas)
3. NO marques ninguna opción adicional
4. Hacé clic en **"Create repository"**
5. Vas a ver una página con instrucciones — no la cierres todavía

📸 *[Captura recomendada: formulario "Create new repository"]*

---

## PASO 5 — Subir el proyecto a GitHub

Abrí la Terminal (Mac/Linux) o Command Prompt (Windows):

```bash
# 1. Ir a la carpeta del proyecto (cambiá la ruta según donde lo guardaste)
cd C:\Users\TuNombre\Documentos\MILA\mila-pms-v6

# En Mac/Linux:
cd ~/Documentos/MILA/mila-pms-v6

# 2. Inicializar Git
git init

# 3. Agregar todos los archivos
git add .

# 4. Hacer el primer commit (guardar)
git commit -m "Primera versión de MILA"

# 5. Conectar con GitHub (reemplazá TU-USUARIO con tu nombre de GitHub)
git remote add origin https://github.com/TU-USUARIO/mila-pms.git

# 6. Subir el código
git branch -M main
git push -u origin main
```

Si te pide usuario y contraseña, ingresá los de GitHub.

📸 *[Captura recomendada: Terminal con los comandos ejecutados exitosamente]*

---

## PASO 6 — Crear una cuenta en Supabase

Supabase es donde se guarda la base de datos de MILA.

1. Andá a: **https://supabase.com**
2. Hacé clic en **"Start your project"**
3. Creá una cuenta con GitHub (opción recomendada) o con email
4. Una vez dentro, hacé clic en **"New project"**
5. Completá:
   - **Organization:** tu nombre o el nombre del complejo
   - **Project name:** `mila-barranca` (o el nombre de tu complejo)
   - **Database Password:** inventá una contraseña muy segura y **guardala** en un lugar seguro
   - **Region:** South America (São Paulo) — el más cercano a Argentina
6. Hacé clic en **"Create new project"**
7. Esperá unos 2 minutos mientras se crea

📸 *[Captura recomendada: página de creación de proyecto en Supabase]*

---

## PASO 7 — Configurar la base de datos de MILA

1. Dentro de tu proyecto en Supabase, hacé clic en **"SQL Editor"** en el menú izquierdo
2. Hacé clic en **"New query"**
3. Abrí el archivo `docs/mila-schema-completo.sql` que está dentro de la carpeta MILA con un editor de texto (Bloc de notas en Windows)
4. Seleccioná todo el texto (Ctrl+A), copialo (Ctrl+C)
5. Pegalo en el SQL Editor de Supabase (Ctrl+V)
6. Hacé clic en el botón **"Run"** (o el ícono de play ▶)
7. Si aparece `MILA SQL OK ✓` en el resultado, todo salió bien ✓

📸 *[Captura recomendada: SQL Editor de Supabase con el resultado "MILA SQL OK"]*

---

## PASO 8 — Obtener las claves de Supabase

1. En Supabase, hacé clic en **"Settings"** (ícono de engranaje, abajo en el menú)
2. Hacé clic en **"API"**
3. Vas a ver dos valores que necesitás copiar y guardar:
   - **Project URL:** algo como `https://xxxxx.supabase.co`
   - **anon public key:** una cadena larga que empieza con `eyJhbG...`

Guardá estos dos valores en un archivo de texto seguro. Los necesitás en el siguiente paso.

📸 *[Captura recomendada: página de API de Supabase con las claves resaltadas (tapando los valores reales)]*

---

## PASO 9 — Crear una cuenta en Vercel

Vercel es donde se publica MILA para que sea accesible desde internet.

1. Andá a: **https://vercel.com**
2. Hacé clic en **"Sign Up"**
3. Elegí **"Continue with GitHub"** (la opción más fácil)
4. Autorizá a Vercel a acceder a tu GitHub

📸 *[Captura recomendada: página de registro de Vercel]*

---

## PASO 10 — Conectar GitHub con Vercel y hacer el primer deploy

1. En Vercel, hacé clic en **"Add New..."** → **"Project"**
2. Buscá tu repositorio `mila-pms` y hacé clic en **"Import"**
3. En la sección **"Configure Project"**:
   - **Framework Preset:** Vite (debería detectarse automáticamente)
   - **Root Directory:** `./` (dejar así)
   - **Build Command:** `npm run build` (dejar así)
   - **Output Directory:** `dist` (dejar así)
4. Expandí **"Environment Variables"** — aquí es donde ponés las claves de Supabase:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | (pegá tu Project URL de Supabase) |
| `VITE_SUPABASE_ANON_KEY` | (pegá tu anon public key de Supabase) |
| `VITE_HOTEL_SLUG` | `barranca-de-termas` (o el nombre de tu complejo sin espacios) |

5. Hacé clic en **"Deploy"**
6. Esperá 2-3 minutos. Vas a ver una animación mientras compila.
7. Cuando aparezca **"Congratulations!"**, hacé clic en **"Visit"** para ver MILA funcionando

📸 *[Captura recomendada: página "Congratulations" de Vercel con el link de la app]*

---

## PASO 11 — Crear el primer usuario administrador

1. En Supabase → **Authentication** → **Users** → **"Add user"** → **"Create new user"**
2. Completá:
   - Email: tu correo de trabajo
   - Password: contraseña segura (mínimo 8 caracteres)
   - **Auto Confirm User:** activar ✓
3. Hacé clic en **"Create user"**
4. Copiá el **"User UID"** (una cadena como `c65d1934-...`)
5. En **SQL Editor**, ejecutá:

```sql
INSERT INTO hotel_users (hotel_id, user_id, role)
SELECT id, 'PEGAR-AQUI-EL-USER-UID', 'admin'
FROM hotels
WHERE slug = 'barranca-de-termas'  -- cambiá por tu VITE_HOTEL_SLUG
LIMIT 1;
```

6. ¡Listo! Ya podés ingresar a MILA con ese email y contraseña.

---

## PASO 12 — Actualizar la aplicación cuando haya cambios

Cuando recibas una nueva versión de MILA:

1. Descomprimí el nuevo ZIP
2. Copiá los archivos nuevos sobre los anteriores (reemplazá todo)
3. Abrí la Terminal en la carpeta de MILA y ejecutá:

```bash
git add .
git commit -m "Actualización a nueva versión"
git push
```

4. Vercel detecta el cambio automáticamente y redeploya en ~2 minutos ✓

---

## PASO 13 — Hacer una copia de seguridad

### Copia del código (automática via Git)
El código siempre está guardado en GitHub. Mientras hagas `git push`, está respaldado.

### Copia de la base de datos (Supabase)
1. En Supabase → **Settings** → **Database** → **Backups**
2. Verás las copias automáticas diarias de los últimos 7 días (plan gratuito)
3. Para exportar manualmente: **SQL Editor** → ejecutá:

```sql
-- Esto exporta todas las reservas a CSV
COPY (SELECT * FROM bookings) TO '/tmp/backup-reservas.csv' CSV HEADER;
```

O usá el botón **"Export as CSV"** en el Table Editor para cada tabla.

---

## PASO 14 — Restaurar una copia de seguridad

En Supabase → Settings → Database → Backups → elegí una fecha → **"Restore"**

> ⚠️ Esto reemplaza TODA la base de datos con la versión del backup. Hacelo solo si es necesario.

---

## PASO 15 — Usar MILA desde la computadora

1. Abrí tu navegador (Chrome recomendado)
2. Andá a la URL de tu app: `https://mila-pms.vercel.app` (o la URL que te dio Vercel)
3. Ingresá con tu email y contraseña
4. ¡Listo! MILA funciona como una página web normal.

---

## PASO 16 — Instalar MILA como aplicación (PWA)

MILA funciona como una "app" instalable en cualquier dispositivo.

### En Windows (Chrome o Edge):
1. Abrí MILA en Chrome
2. Hacé clic en el ícono ✦ que aparece a la derecha de la barra de direcciones
3. Hacé clic en **"Instalar"**
4. MILA aparece como una app en tu escritorio y menú inicio ✓

### En iPhone:
1. Abrí MILA en Safari (debe ser Safari, no Chrome)
2. Tocá el botón de compartir (cuadrado con flecha hacia arriba) 
3. Deslizá hacia abajo y tocá **"Agregar a pantalla de inicio"**
4. Tocá **"Agregar"**
5. MILA aparece como un ícono en tu pantalla de inicio ✓

### En Android:
1. Abrí MILA en Chrome
2. Tocá el menú (3 puntitos arriba a la derecha)
3. Tocá **"Agregar a pantalla de inicio"** o **"Instalar app"**
4. Confirmá tocando **"Agregar"**
5. MILA aparece en tu pantalla de inicio ✓

📸 *[Captura recomendada: MILA instalada como app en el escritorio de Windows]*

---

## PASO 17 — Compartir con otros usuarios

Para que otra persona use MILA (ej: la encargada del complejo):

1. En Supabase → **Authentication** → **Users** → **"Add user"**
2. Ingresá el email de la persona y una contraseña temporal
3. En **SQL Editor**:

```sql
INSERT INTO hotel_users (hotel_id, user_id, role)
SELECT h.id, u.id, 'staff'  -- 'staff' para personal, 'admin' para administrador
FROM hotels h, auth.users u
WHERE h.slug = 'barranca-de-termas'
  AND u.email = 'email-de-la-persona@gmail.com';
```

4. Enviále la URL de MILA y sus credenciales por WhatsApp o email

---

## PASO 18 — Verificar que todo funciona

Checklist final:

- [ ] Podés ingresar con tu usuario y contraseña
- [ ] El Panel de Hoy carga correctamente
- [ ] El calendario muestra los departamentos
- [ ] Podés crear una reserva nueva (completar todos los pasos y guardar)
- [ ] La reserva aparece en el calendario y en el listado
- [ ] El cotizador del dólar muestra un valor actualizado
- [ ] Podés instalar la app en tu celular

Si algo no funciona, revisá:
1. Las variables de entorno en Vercel (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY)
2. Que ejecutaste el SQL completo en Supabase
3. Que el usuario tiene permisos en `hotel_users`

---

## Contacto y soporte

¿Algo no funciona? Revisá:
- Los logs en Vercel → Deployments → tu último deploy → **"Functions"** o **"Build"**
- Los errores en Supabase → **Logs** → **API**
- La consola del navegador (F12 → Console)

---

*MILA Sistema Inteligente para Alojamientos · Guía v7.0 · Junio 2026*
