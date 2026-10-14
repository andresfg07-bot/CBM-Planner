-- ======================================================================================
-- MIGRACIÓN: Checklist de servicio Rotodinámico (puntos críticos + datos de la medición)
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- Una fila por gestión (task_id). `data` (JSONB) guarda: estado y nota de cada punto,
-- gaps de las sondas, bitácora de eventos con hora, fotos del mapa de sensores, conteo
-- de equipos (salida y llegada) y novedades. Las horas de llegada y salida de planta
-- quedan en columnas propias para poder usarlas después (eficiencia, reportes).
-- Las fotos se suben al bucket existente `inventory-photos` (carpeta checklists/).
-- ======================================================================================

CREATE TABLE IF NOT EXISTS public.task_checklists (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id     TEXT        NOT NULL UNIQUE,
    template    TEXT        NOT NULL DEFAULT 'rotodinamico_v1',
    data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    arrived_at  TIMESTAMPTZ,
    left_at     TIMESTAMPTZ,
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.task_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth lee task_checklists" ON public.task_checklists;
CREATE POLICY "Auth lee task_checklists"
    ON public.task_checklists FOR SELECT TO authenticated USING (true);

-- Analistas y admin llenan el checklist
DROP POLICY IF EXISTS "Analista y admin insertan task_checklists" ON public.task_checklists;
CREATE POLICY "Analista y admin insertan task_checklists"
    ON public.task_checklists FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('analyst', 'admin')));

DROP POLICY IF EXISTS "Analista y admin actualizan task_checklists" ON public.task_checklists;
CREATE POLICY "Analista y admin actualizan task_checklists"
    ON public.task_checklists FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('analyst', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('analyst', 'admin')));

DROP POLICY IF EXISTS "Admin borra task_checklists" ON public.task_checklists;
CREATE POLICY "Admin borra task_checklists"
    ON public.task_checklists FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- Verificación:
-- SELECT * FROM public.task_checklists;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'task_checklists';
