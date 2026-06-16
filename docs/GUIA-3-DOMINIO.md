# Guía 3 — Conectar un dominio propio

Por defecto tu sistema está en una dirección como:
`https://barranca-termas-pms.vercel.app`

Esta guía explica cómo usar una dirección personalizada como:
`https://reservas.barrancadetermas.com`

---

## ¿Necesitás un dominio propio?

Un dominio propio es **opcional**. El sistema funciona perfectamente con
la dirección de Vercel. Un dominio propio sirve para:
- Verse más profesional ante los clientes
- Ser más fácil de recordar
- Agregar identidad de marca

Si no lo necesitás ahora, podés saltarte esta guía y volver cuando quieras.

---

## PARTE 1 — Comprar un dominio

### Registradores recomendados para Argentina

- **NIC Argentina** (https://nic.ar) — para dominios `.com.ar` (más baratos, ~$1.000/año)
- **Namecheap** (https://namecheap.com) — para dominios `.com` (~$10/año, pago con tarjeta internacional)
- **GoDaddy** (https://godaddy.com) — alternativa popular

### Paso 1 — Elegir el nombre

Pensá en algo corto y relacionado con el complejo:
- `barrancadetermas.com`
- `reservasbarranca.com`
- `barrancatermas.com.ar`

Verificá que el nombre esté disponible en el registrador antes de pagar.

### Paso 2 — Comprar el dominio

Seguí el proceso de compra del registrador que elijas.
Vas a necesitar una tarjeta de crédito y tus datos personales.

✅ Dominio comprado.

---

## PARTE 2 — Conectar el dominio a Vercel

### Paso 3 — Agregar el dominio en Vercel

1. Entrá a tu proyecto en Vercel
2. Hacé clic en **"Settings"** (arriba)
3. Hacé clic en **"Domains"** en el menú izquierdo
4. En el campo de texto, escribí tu dominio (ej: `barrancadetermas.com`)
5. Hacé clic en **"Add"**
6. Vercel te va a mostrar unos datos de DNS. **Anotalos** — los vas a necesitar en el siguiente paso.

---

### Paso 4 — Configurar los DNS en tu registrador

Los DNS son como una "guía telefónica de internet" que le dice a los
visitantes dónde está tu sitio.

#### Si compraste en NIC Argentina:
1. Entrá a nic.ar con tu cuenta
2. Buscá la opción "Gestionar DNS" o "Nameservers"
3. Agregá los registros que te dio Vercel (generalmente son tipo `A` o `CNAME`)

#### Si compraste en Namecheap:
1. Entrá a namecheap.com → Dashboard → Manage
2. Hacé clic en "Advanced DNS"
3. Agregá los registros que te dio Vercel

#### ¿Qué registros agregar?

Vercel generalmente pide esto:

**Para el dominio principal** (`barrancadetermas.com`):
- Tipo: `A`
- Host: `@`
- Valor: `76.76.21.21`

**Para `www`** (`www.barrancadetermas.com`):
- Tipo: `CNAME`
- Host: `www`
- Valor: `cname.vercel-dns.com`

⚠️ Siempre verificá los valores exactos en tu panel de Vercel, pueden variar.

---

### Paso 5 — Esperar la propagación

Los cambios de DNS pueden tardar entre **10 minutos y 48 horas** en
aplicarse globalmente. En la mayoría de los casos, funciona en menos de 1 hora.

Para verificar que está funcionando:
1. Abrí una nueva pestaña del navegador
2. Escribí tu dominio y presioná Enter
3. Si abre el sistema, ¡está listo!

---

## Certificado SSL (candado verde 🔒)

Vercel agrega el certificado SSL automáticamente. No necesitás hacer nada.
Cuando el dominio esté conectado, ya va a tener el candado verde en el navegador.

---

## Errores comunes

**El dominio no abre el sistema**
→ Los DNS todavía no se propagaron. Esperá unas horas e intentá de nuevo.

**El navegador dice "Sitio no seguro"**
→ El certificado SSL todavía se está generando. Esperá 10-15 minutos.

**Vercel dice "Domain already in use"**
→ El dominio ya está asociado a otro proyecto de Vercel. Tenés que
eliminarlo de ese proyecto primero.

---

*Siguiente paso: cómo hacer backups y mantener el sistema → [GUIA-4-MANTENIMIENTO.md](GUIA-4-MANTENIMIENTO.md)*
