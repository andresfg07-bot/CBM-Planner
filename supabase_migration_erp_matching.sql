-- ======================================================================================
-- MIGRACIÓN: Conciliador de facturas del ERP (cruce por cliente y valor)
-- Ejecutar en Supabase → SQL Editor (después de supabase_migration_erp_billing.sql)
-- ======================================================================================
--
-- 1. tasks.erp_invoice_ref : factura del ERP con la que se conciliaron las gestiones (ej. FEV-3487).
-- 2. erp_billing_log.state : se agregan los estados del conciliador:
--      sugerido   → el sistema encontró una posible factura y espera que alguien la confirme
--      confirmado → una persona confirmó el cruce y la gestión pasó a facturada
--      descartado → una persona dijo "no es esta factura" (no se vuelve a sugerir)
-- ======================================================================================

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS erp_invoice_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_erp_invoice_ref ON public.tasks(erp_invoice_ref);

ALTER TABLE public.erp_billing_log DROP CONSTRAINT IF EXISTS erp_billing_log_state_check;
ALTER TABLE public.erp_billing_log ADD CONSTRAINT erp_billing_log_state_check
    CHECK (state IN ('propuesto', 'aplicado', 'por_revisar', 'resuelto', 'sugerido', 'confirmado', 'descartado'));

-- Verificación:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'erp_billing_log_state_check';
