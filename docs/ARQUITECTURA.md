# Revisión de Arquitectura — Barranca de Termas PMS

## Contexto

Este documento analiza los elementos del sistema que fueron diseñados con lógica
"multi-hotel" (soporte para múltiples establecimientos) y evalúa qué conviene
mantener o simplificar dado que el objetivo es un **sistema de uso interno
para un único complejo**.

---

## Elementos multi-hotel encontrados

### 1. Tabla `hotels`
**Qué hace:** guarda nombre, slug, zona horaria y configuración del establecimiento.
**Estado actual:** tiene exactamente 1 fila: "Barranca de Termas".
**Riesgo de eliminar:** alto. Todas las demás tablas referencian `hotel_id`.
**Recomendación:** ✅ **Mantener.** No agrega complejidad — es simplemente
la configuración del complejo. Si en el futuro se instala para otro alojamiento,
se cambia esta fila.

---

### 2. Columna `hotel_id` en todas las tablas
**Qué hace:** filtra cada query para traer solo datos del establecimiento correcto.
**Estado actual:** siempre tiene el mismo valor.
**Riesgo de eliminar:** muy alto. Requeriría reescribir todas las queries y el RLS.
**Recomendación:** ✅ **Mantener.** Costo de mantenerlo: cero. Beneficio: seguridad
extra y compatibilidad futura. Si se duplica el proyecto para otro complejo,
cada instalación tiene su propio `hotel_id` en su propia base de datos.

---

### 3. Tabla `hotel_users`
**Qué hace:** asocia usuarios de Supabase Auth con el establecimiento y les
asigna un rol (admin / staff / demo).
**Riesgo de eliminar:** alto. Es la base del sistema de roles.
**Recomendación:** ✅ **Mantener.** Es la forma correcta de manejar roles
sin complejidad adicional. Para un sistema single-hotel, funciona igual de bien.

---

### 4. `HOTEL_SLUG = 'barranca-de-termas'` en supabase-config.js
**Qué hace:** identifica el hotel al arrancar la app y cargar su configuración.
**Riesgo de eliminar:** bajo. Podría reemplazarse por un `SELECT *` sin filtro
de slug, pero no tiene sentido.
**Recomendación:** ✅ **Mantener.** Es una constante de una línea. Si se
instala para otro complejo, se cambia esa línea.

---

### 5. RLS (Row Level Security) en Supabase
**Qué hace:** garantiza que cada usuario solo vea los datos de su hotel.
**Para un sistema single-hotel:** técnicamente innecesario, pero es la capa
de seguridad que previene que una URL mal construida devuelva datos ajenos.
**Riesgo de eliminar:** bajo. Pero sin RLS, cualquier bug podría exponer datos.
**Recomendación:** ✅ **Mantener.** El RLS no agrega complejidad de código
y protege los datos ante errores inesperados.

---

### 6. Función `loadHotelContext()` en supabase-config.js
**Qué hace:** al iniciar la app, busca el hotel por slug y carga sus unidades.
**Para single-hotel:** podría simplificarse a un query sin filtro de slug,
pero el resultado sería idéntico.
**Recomendación:** ✅ **Mantener tal cual.** Cambiarla no aporta ningún beneficio.

---

## Veredicto final

**No se recomienda ningún cambio arquitectural.**

La estructura "multi-hotel" presente en el código es en realidad una estructura
**correctamente normalizada** que no agrega complejidad alguna al uso cotidiano.

Todo el "soporte multi-hotel" se reduce a:
- Una constante `HOTEL_SLUG` de una línea
- Una columna `hotel_id` que siempre tiene el mismo valor
- Políticas RLS estándar

Eliminar cualquiera de estos elementos requeriría más trabajo del que ahorra,
y haría más difícil la futura reutilización para otro complejo.

**La estrategia de reutilización propuesta — duplicar el proyecto y ajustar
configuración — funciona perfectamente con la arquitectura actual.**

Para adaptar a otro complejo:
1. Duplicar el repositorio de GitHub
2. Crear un nuevo proyecto en Supabase
3. Ejecutar los mismos scripts SQL
4. Cambiar `HOTEL_SLUG`, nombre y unidades en los archivos de configuración
5. Publicar en Vercel

---

*Generado: Junio 2026*
