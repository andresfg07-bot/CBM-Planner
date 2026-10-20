-- ======================================================================================
-- MIGRACIÓN: Facturación automática desde el ERP (Dolibarr) hacia el planner
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- 1. tasks.negocio            : N° de negocio del ERP (ej. "N2939"). Varias gestiones pueden compartirlo.
-- 2. erp_billing_log          : historial de lo que la sincronización detectó, aplicó o dejó por revisar.
-- 3. erp_sync_settings        : una fila con el modo (prueba / activo) y el resultado de la última corrida.
--
-- La sincronización corre en el servidor (api/erp-billing-sync) con la clave de servicio de Supabase,
-- que NO está en el navegador. El ERP solo se CONSULTA (GET); nunca se escribe en él.
-- ======================================================================================

-- 1. Campo de negocio en la gestión ---------------------------------------------------
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS negocio TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_negocio ON public.tasks(negocio);

-- 2. Historial de la sincronización ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_billing_log (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    fingerprint     TEXT        NOT NULL UNIQUE,      -- evita registrar dos veces lo mismo
    negocio         TEXT        NOT NULL,
    invoice_refs    TEXT[]      NOT NULL DEFAULT '{}',
    invoiced_total  NUMERIC,                          -- suma antes de IVA de las facturas enviadas
    task_ids        TEXT[]      NOT NULL DEFAULT '{}',
    state           TEXT        NOT NULL CHECK (state IN ('propuesto', 'aplicado', 'por_revisar', 'resuelto')),
    reason          TEXT,
    details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    resolved_by     TEXT,
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_erp_billing_log_state ON public.erp_billing_log(state, created_at DESC);

-- 3. Ajustes y última corrida ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_sync_settings (
    id           INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    mode         TEXT        NOT NULL DEFAULT 'prueba' CHECK (mode IN ('prueba', 'activo')),
    last_run_at  TIMESTAMPTZ,
    last_result  JSONB
);
INSERT INTO public.erp_sync_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS ---------------------------------------------------------------------------------
ALTER TABLE public.erp_billing_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sync_settings   ENABLE ROW LEVEL SECURITY;

-- Lectura: admin, asistente y visor
DROP POLICY IF EXISTS "Roles leen erp_billing_log" ON public.erp_billing_log;
CREATE POLICY "Roles leen erp_billing_log" ON public.erp_billing_log FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant', 'viewer')));

DROP POLICY IF EXISTS "Roles leen erp_sync_settings" ON public.erp_sync_settings;
CREATE POLICY "Roles leen erp_sync_settings" ON public.erp_sync_settings FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant', 'viewer')));

-- Admin y asistente marcan como resuelto lo que quedó por revisar
DROP POLICY IF EXISTS "Admin y asistente resuelven erp_billing_log" ON public.erp_billing_log;
CREATE POLICY "Admin y asistente resuelven erp_billing_log" ON public.erp_billing_log FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')));

-- Solo el admin cambia el modo (prueba ↔ activo)
DROP POLICY IF EXISTS "Admin cambia erp_sync_settings" ON public.erp_sync_settings;
CREATE POLICY "Admin cambia erp_sync_settings" ON public.erp_sync_settings FOR UPDATE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- Las escrituras de la sincronización las hace el servidor con la clave de servicio (salta RLS).

-- Verificación:
-- SELECT * FROM public.erp_sync_settings;
