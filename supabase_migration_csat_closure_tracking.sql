-- ======================================================================================
-- MIGRACIÓN: Trazabilidad del cierre CSAT (días de pendiente desde ejecución real)
-- Ejecutar en Supabase → SQL Editor
--
-- Antes: "días pendiente" se calculaba desde el último día de INFORME programado en
-- el calendario, no desde que el analista realmente marcó la gestión como ejecutada.
-- Ahora se guardan dos timestamps:
--   - executed_at:    momento exacto en que la gestión pasó a 'ejecutada'.
--   - csat_closed_at: momento exacto en que se registró la calificación CSAT
--                      (o "cliente no respondió"), para poder ver cuánto tardó
--                      el analista en cerrar.
-- ======================================================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS executed_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS csat_closed_at TIMESTAMPTZ;

-- Verificación:
-- SELECT id, client, status, executed_at, csat_closed_at FROM public.tasks WHERE status = 'ejecutada' ORDER BY executed_at DESC NULLS LAST LIMIT 20;
