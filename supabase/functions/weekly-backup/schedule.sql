-- ══════════════════════════════════════════════════
-- Programar backup semanal con pg_cron
-- Ejecutar en Supabase → SQL Editor → Run
-- Requiere extensión pg_cron activada
-- ══════════════════════════════════════════════════

-- Verificar que pg_cron esté activo
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Programar backup cada lunes a las 8:00 UTC
-- (= 5:00 AM ARG)
SELECT cron.schedule(
  'mila-weekly-backup',
  '0 8 * * 1',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/weekly-backup',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Listar cron jobs activos
SELECT jobname, schedule, command FROM cron.job;

-- Para cancelar el backup si fuera necesario:
-- SELECT cron.unschedule('mila-weekly-backup');
