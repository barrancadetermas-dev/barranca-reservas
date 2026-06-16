# Guía 2 — Publicar el sistema en internet con Vercel

Una vez que instalaste la base de datos (Guía 1), es hora de publicar
el sistema para poder usarlo desde cualquier dispositivo.

Vamos a usar **Vercel**, un servicio de hosting gratuito que además
sabe cómo construir proyectos con Vite (el bundler del sistema).

---

## ¿Cómo funciona el flujo de publicación?

Cuando hacés un deploy, Vercel hace tres cosas automáticamente:
1. **Descarga** el código de tu repositorio de GitHub
2. **Construye** el proyecto con `npm run build` (Vite genera la carpeta `dist/`)
3. **Publica** la carpeta `dist/` como sitio web accesible desde internet

Las credenciales de Supabase **no van en el código** — las configurás como
Variables de Entorno en Vercel, y Vite las inyecta durante el build.

---

### Paso 1 — Crear cuenta en Vercel

1. Entrá a: **https://vercel.com**
2. Hacé clic en **"Sign Up"**
3. Seleccioná **"Continue with GitHub"** — así los repositorios se conectan solos
4. Autorizá cuando GitHub te lo pida

✅ Cuenta creada y conectada a GitHub.

---

### Paso 2 — Importar el proyecto

1. Dentro de Vercel, hacé clic en **"Add New..."** → **"Project"**
2. Aparece la lista de tus repositorios de GitHub.
   Buscá **`barranca-termas-pms`** y hacé clic en **"Import"**
3. Vercel detecta automáticamente que es un proyecto Vite.
   En la sección **"Framework Preset"** debería decir **"Vite"**.
   Si no lo detecta, seleccionalo manualmente.
4. Verificá que esté configurado así:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
   Si dice otra cosa, corregilo antes de continuar.

---

### Paso 3 — Configurar las variables de entorno ⚠️ Crítico

Sin este paso, el sistema no puede conectarse a Supabase.

1. Buscá la sección **"Environment Variables"** (antes del botón Deploy)
2. Agregá estas dos variables exactamente así (sin comillas, sin espacios):

**Variable 1:**
- Name: `VITE_SUPABASE_URL`
- Value: tu URL de Supabase (algo como `https://abcdef.supabase.co`)

**Variable 2:**
- Name: `VITE_SUPABASE_ANON_KEY`
- Value: tu clave anon (la que empieza con `eyJ...`)

¿Dónde están esos valores? En **Supabase → Settings → API**.

⚠️ Los nombres deben empezar con `VITE_` exactamente así, con mayúsculas.
Vite solo inyecta en el bundle las variables que empiecen con `VITE_`.

---

### Paso 4 — Publicar

1. Hacé clic en **"Deploy"**
2. Vercel empieza a construir el proyecto. Vas a ver logs en tiempo real:
   - `Installing dependencies...` (descarga los paquetes de npm)
   - `Building...` (Vite compila el proyecto)
   - `Deploying...` (sube el resultado a la red)
3. ⏳ El proceso tarda entre 1 y 3 minutos.
4. Al terminar aparece: **"🎉 Congratulations!"** y un link a tu sitio.

El link va a ser algo como: `https://barranca-termas-pms.vercel.app`

---

### Paso 5 — Probar

1. Abrí el link que te dio Vercel
2. Deberías ver la pantalla de login del sistema
3. Ingresá con el email y contraseña del administrador (creado en Guía 1)
4. Si aparece el calendario con los departamentos, ¡funciona! ✅

---

### Paso 6 — Guardar en el celular como app

**En iPhone (Safari):**
1. Abrí el link del sistema en Safari
2. Tocá el botón de compartir (cuadrado con flecha hacia arriba)
3. Seleccioná "Agregar a pantalla de inicio"
4. Poné el nombre que quieras y confirmá

**En Android (Chrome):**
1. Abrí el link en Chrome
2. Tocá los tres puntos (menú superior derecho)
3. Seleccioná "Agregar a pantalla de inicio" o "Instalar app"

El sistema queda como una app nativa en tu celular, incluso funciona offline.

---

## Cómo actualizar el sistema en el futuro

1. Actualizá los archivos en GitHub (cargá la nueva versión)
2. Vercel detecta el cambio automáticamente en segundos
3. Lanza un nuevo build — en 2 minutos el sitio está actualizado

No necesitás hacer nada más en Vercel.

---

## Errores comunes y soluciones

**"Build failed: Cannot find module 'vite'"**
→ Vercel no ejecutó `npm install`. Verificá que el **Install Command** sea `npm install`.
   En el dashboard: Settings → General → Build & Development Settings.

**"Build failed: VITE_SUPABASE_URL is not defined"**
→ Las variables de entorno no están configuradas o tienen nombre incorrecto.
   Verificá que se llamen exactamente `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
   Después: Deployments → último deploy → "Redeploy".

**El sitio abre pero no carga datos**
→ Las variables de entorno existen pero tienen un valor incorrecto.
   Copiá la URL y la clave de Supabase de nuevo, sin espacios extra.

**"Error 404" al navegar entre secciones**
→ El `vercel.json` incluido en el proyecto ya maneja esto con un rewrite.
   Si lo modificaste, restauralo desde el repositorio original.

**Subiste código nuevo a GitHub pero el sitio no se actualizó**
→ Vercel solo monitorea la rama principal (`main` o `master`).
   Verificá que subiste los cambios a esa rama, no a otra.

---

*Siguiente paso: conectar un dominio propio → [GUIA-3-DOMINIO.md](GUIA-3-DOMINIO.md)*
