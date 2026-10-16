-- ======================================================================================
-- MIGRACIÓN: Excluir compañías de las encuestas (sin borrar el historial)
-- Ejecutar en Supabase → SQL Editor (después de supabase_migration_survey_company_map.sql)
-- ======================================================================================
-- excluded = true: la compañía deja de aparecer en rondas, resultados, filtros y contactos,
-- pero sus datos siguen en la base de datos y se pueden restaurar desde "Conciliar clientes".
-- ======================================================================================

ALTER TABLE public.survey_company_map ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false;
