-- ============================================================================
-- SERVICIOS FACTURADOS POR EJECUTAR ("deuda con el cliente")
-- ============================================================================
-- Caso: una factura abarca varias gestiones y una de ellas todavía no se ha
-- programado (o ejecutado). Al pasar a 'facturada' queda bloqueada y se perdía
-- de vista. Con estas dos columnas la gestión sigue facturada, pero con la marca
-- de "servicio pendiente" hasta que se ejecute.
--
--   service_pending:    true mientras la gestión está facturada pero el servicio
--                       no se ha ejecutado. Al ejecutarlo vuelve a false.
--   advance_billed_at:  momento en que se registró la facturación anticipada.
--                       De aquí salen los recordatorios de 30 / 60 / 90 días.
--
-- No cambia ninguna política: las de UPDATE que ya existen (admin y analista
-- asignado) cubren las columnas nuevas.
--
-- EJECUTAR en Supabase → SQL Editor. Es seguro correrlo más de una vez.
-- ============================================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS service_pending   BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS advance_billed_at TIMESTAMPTZ;

-- Para listar rápido las deudas abiertas.
CREATE INDEX IF NOT EXISTS idx_tasks_service_pending
    ON public.tasks (service_pending) WHERE service_pending = TRUE;

-- Verificación:
-- SELECT id, client, status, service_pending, advance_billed_at FROM public.tasks WHERE service_pending ORDER BY advance_billed_at;
