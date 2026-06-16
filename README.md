# 🏨 Barranca de Termas — Sistema de Gestión de Reservas

Sistema propio de administración hotelera para **Barranca de Termas**,
un complejo de 7 apartamentos turísticos.

---

## ¿Qué es este sistema?

Es una aplicación web que reemplaza las planillas de Excel o los cuadernos
para gestionar las reservas, pagos y operativa diaria del complejo.

Funciona desde cualquier celular, tablet o computadora con internet.
No requiere instalar nada. Se abre desde el navegador como cualquier sitio web.

---

## ¿Qué puede hacer?

### Reservas
- Crear, editar y cancelar reservas
- Ver disponibilidad en un calendario visual por departamento
- Detectar solapamientos automáticamente
- Duplicar reservas para huéspedes recurrentes
- Filtrar por canal (Booking, Airbnb, directo, familia)
- Exportar listado a Excel (CSV)

### Pagos
- Registrar pagos parciales o totales
- Editar y eliminar cobros registrados
- Ver el saldo pendiente de cada reserva
- Gestionar devoluciones al cancelar

### Departamentos
- Sistema de colores único por departamento
- Identificación visual inmediata en todas las pantallas
- Notas internas por unidad (solo visibles para el equipo)

### Huéspedes
- Ficha completa con historial de estadías
- Registro de mala experiencia con observaciones
- Búsqueda rápida por nombre, DNI o teléfono

### Estadísticas
- Ocupación mensual por unidad
- Ingresos brutos y netos por canal
- Estado de resultados (P&L): ingresos vs gastos
- Comisiones de Booking y Airbnb ya descontadas

### Operativa diaria
- Panel con llegadas y salidas del día
- Marcado de check-in y check-out
- Recordatorios y tareas de mantenimiento
- Cotización del dólar en tiempo real

### Modos de usuario
- **Admin:** control total del sistema
- **Staff:** operativa diaria sin acceso a finanzas globales
- **Demo:** navegación libre con datos de ejemplo, sin guardar nada

### Tecnología
- Funciona offline (instalable como app en el celular)
- Actualización en tiempo real entre dispositivos
- Exportación de comprobantes por WhatsApp
- Modo oscuro incluido

---

## Para quién está pensado

Para el propietario y el personal de **Barranca de Termas**. No es un SaaS
ni una plataforma pública. Es una herramienta interna del complejo.

---

## Documentación completa

Ver la carpeta `docs/` para las guías detalladas:

| Guía | Contenido |
|---|---|
| [GUIA-1-INSTALACION.md](docs/GUIA-1-INSTALACION.md) | GitHub + Supabase + primer usuario |
| [GUIA-2-PUBLICACION.md](docs/GUIA-2-PUBLICACION.md) | Publicar con Vercel |
| [GUIA-3-DOMINIO.md](docs/GUIA-3-DOMINIO.md) | Conectar dominio propio |
| [GUIA-4-MANTENIMIENTO.md](docs/GUIA-4-MANTENIMIENTO.md) | Backups y actualizaciones |
| [GUIA-5-PERSONALIZACION.md](docs/GUIA-5-PERSONALIZACION.md) | Adaptar para otro complejo |
| [ARQUITECTURA.md](docs/ARQUITECTURA.md) | Análisis técnico de la arquitectura |

---

## Stack tecnológico

- **Frontend:** HTML5 + CSS3 + JavaScript ES6 (sin frameworks)
- **Base de datos:** Supabase (PostgreSQL en la nube)
- **Hosting:** Vercel (gratuito para este uso)
- **Autenticación:** Supabase Auth
- **Tiempo real:** Supabase Realtime

---

*Sistema desarrollado para uso interno. Versión 4.1 — Junio 2026.*
