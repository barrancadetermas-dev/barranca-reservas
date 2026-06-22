# MILA — Sistema Inteligente para Alojamientos

Sistema de gestión para apartamentos turísticos. Reservas, calendario, finanzas, operaciones y CRM de huéspedes.

## Stack
- **Frontend:** Vanilla JS + Vite
- **Backend:** Supabase (PostgreSQL + Auth + Realtime)
- **Deploy:** Vercel
- **PWA:** Instalable en iOS, Android y Desktop

## Instalación rápida

```bash
npm install
cp .env.example .env.local
# Editar .env.local con tus credenciales de Supabase
npm run dev
```

## Variables de entorno requeridas

```env
VITE_SUPABASE_URL=https://tuproyecto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...
VITE_HOTEL_SLUG=nombre-de-tu-complejo
VITE_DEMO_EMAIL=demo@milasistema.com    # opcional
VITE_DEMO_PASS=DemoPass2025!            # opcional
```

## Base de datos

Ejecutar `src/docs/mila-schema-completo.sql` en Supabase → SQL Editor.

## Deploy en Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Conectar repositorio GitHub
2. Agregar variables de entorno
3. Deploy automático

## Guía para principiantes

Ver `src/docs/GUIA-DEPLOY.md` — paso a paso con capturas sugeridas.

## Estructura del proyecto

```
src/
├── js/
│   ├── app.js                 # App principal
│   ├── supabase-config.js     # Cliente Supabase + constantes
│   ├── auth/permissions.js    # Roles y permisos
│   ├── components/
│   │   ├── booking-form.js    # Formulario de reservas
│   │   ├── calendar.js        # Calendario (mes/semana/lista)
│   │   ├── booking-list.js    # Listado de reservas
│   │   ├── dashboard.js       # Panel de hoy
│   │   ├── statistics.js      # Estadísticas y P&L
│   │   ├── guests.js          # CRM de huéspedes
│   │   ├── operations.js      # Limpieza/Mantenimiento/Stock
│   │   └── config-panel.js    # Configuración
│   └── services/
│       ├── dollar-api.js      # Cotización USD (3 fuentes)
│       ├── price-suggester.js # Sugeridor de precio dinámico
│       ├── arg-holidays.js    # Feriados argentinos
│       └── whatsapp-service.js
├── css/styles.css
├── index.html                 # App principal
├── landing.html               # Página de marketing
└── docs/
    ├── mila-schema-completo.sql
    └── GUIA-DEPLOY.md
```

## Changelog

### v7.0 (Junio 2026)
- Fix CRÍTICO: Formulario de reservas ahora guarda correctamente
  - async/await corregido en `_validateAll()`
  - Payload resiliente a columnas opcionales no creadas
  - Safety timeout de 30 segundos anti-freeze
  - Mensajes de error descriptivos en pantalla
- Fix visual: Vista semanal con bordes y estructura visible
- Fix CSS: Inputs dentro de modales con fondo distinguible
- Navegación persiste entre secciones (localStorage)
- Todos los canales visibles en filtros de reservas
- Bottom nav para mobile
- Timeline de cambios en detalle de reserva
- Color picker para unidades en configuración

### v6.5 (Junio 2026)
- Dólar: 3 fuentes (DolarAPI + Ámbito + Bluelytics) con promedio
- Fix login: ojito contraseña + manejo de errores mejorado
- SQL completo idempotente (mila-schema-completo.sql)

### v6.x (Mayo-Junio 2026)
- Feriados argentinos dinámicos + días pasados oscuros
- WhatsApp: template para encargada
- Selector pax (adultos + menores)
- Comisión por canal automática en breakdown
- PWA mejorada, offline support
