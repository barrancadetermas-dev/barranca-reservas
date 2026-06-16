# Backup Automático Semanal — MILA

## Deploy

```bash
# 1. Instalar Supabase CLI
npm install -g supabase

# 2. Login
supabase login

# 3. Link con tu proyecto
supabase link --project-ref tuneeinpudlsezzmvaro

# 4. Configurar secrets
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxx
supabase secrets set ADMIN_EMAIL=tumail@gmail.com
supabase secrets set HOTEL_NAME="Barranca de Termas"

# 5. Deploy la función
supabase functions deploy weekly-backup
```

## Configurar Resend (gratis hasta 3000 emails/mes)

1. Crear cuenta en https://resend.com
2. Agregar y verificar tu dominio
3. Crear API Key
4. Usar en `supabase secrets set RESEND_API_KEY=...`

## Activar el cron

En Supabase → SQL Editor, ejecutar el contenido de `schedule.sql`.

## Probar manualmente

```bash
curl -X POST https://<ref>.functions.supabase.co/weekly-backup \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json"
```
