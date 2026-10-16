-- ======================================================================================
-- MIGRACIÓN: Conciliación de compañías de las encuestas con los clientes del planner
-- Ejecutar en Supabase → SQL Editor (después de supabase_migration_surveys.sql)
-- ======================================================================================
--
-- Cada fila dice a qué cliente del planner corresponde un nombre de compañía de las
-- encuestas (ej. "ELECTRO PORCELANAS GAMMA - CORONA" → "Gamma"). No modifica las encuestas
-- originales: la app aplica esta correspondencia al cargar los datos, y se puede deshacer.
-- planner_key NULL = esa compañía de la encuesta no existe como cliente en el planner.
-- ======================================================================================

CREATE TABLE IF NOT EXISTS public.survey_company_map (
    survey_key    TEXT        PRIMARY KEY,   -- nombre normalizado tal como quedó en la encuesta
    survey_name   TEXT        NOT NULL,
    planner_key   TEXT,                      -- nombre normalizado del cliente del planner
    planner_name  TEXT,
    confirmed_by  TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.survey_company_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Roles leen survey_company_map" ON public.survey_company_map;
CREATE POLICY "Roles leen survey_company_map" ON public.survey_company_map FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                   AND p.role IN ('admin', 'assistant', 'commercial', 'viewer')));

DROP POLICY IF EXISTS "Admin y asistente insertan survey_company_map" ON public.survey_company_map;
CREATE POLICY "Admin y asistente insertan survey_company_map" ON public.survey_company_map FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')));

DROP POLICY IF EXISTS "Admin y asistente actualizan survey_company_map" ON public.survey_company_map;
CREATE POLICY "Admin y asistente actualizan survey_company_map" ON public.survey_company_map FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')));

DROP POLICY IF EXISTS "Admin y asistente borran survey_company_map" ON public.survey_company_map;
CREATE POLICY "Admin y asistente borran survey_company_map" ON public.survey_company_map FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')));

-- Verificación:
-- SELECT * FROM public.survey_company_map;
