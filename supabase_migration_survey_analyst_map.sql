-- ======================================================================================
-- MIGRACIÓN: Equivalencias de analistas de las encuestas con los analistas del planner
-- Ejecutar en Supabase → SQL Editor (después de supabase_migration_surveys.sql)
-- ======================================================================================
--
-- Las encuestas guardan los analistas como texto libre (venían de un Excel), por eso un mismo
-- analista puede estar como "Nelson" y como "Nelson Morán". Cada fila de esta tabla dice qué
-- es un nombre de las encuestas:
--
--   kind = 'analista' → es el analista del planner indicado en planner_name (ej. "Nelson" → "Nelson Morán")
--   kind = 'ex'       → ya no está en la empresa: se conserva su nombre y se marca "(ya no está)"
--   kind = 'ignorar'  → no es un analista (ej. "Todos"): se deja de contar
--
-- No modifica las encuestas originales: la app aplica estas equivalencias al leer los datos
-- y se pueden deshacer desde la pestaña "Analistas" del módulo de Encuestas.
-- ======================================================================================

CREATE TABLE IF NOT EXISTS public.survey_analyst_map (
    survey_key    TEXT        PRIMARY KEY,   -- nombre normalizado (minúsculas, sin tildes) tal como quedó en la encuesta
    survey_name   TEXT        NOT NULL,      -- nombre tal como se escribió
    kind          TEXT        NOT NULL CHECK (kind IN ('analista', 'ex', 'ignorar')),
    planner_name  TEXT,                      -- nombre del analista del planner (solo si kind = 'analista')
    confirmed_by  TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.survey_analyst_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Roles leen survey_analyst_map" ON public.survey_analyst_map;
CREATE POLICY "Roles leen survey_analyst_map" ON public.survey_analyst_map FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                   AND p.role IN ('admin', 'assistant', 'commercial', 'viewer')));

DROP POLICY IF EXISTS "Admin y asistente insertan survey_analyst_map" ON public.survey_analyst_map;
CREATE POLICY "Admin y asistente insertan survey_analyst_map" ON public.survey_analyst_map FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')));

DROP POLICY IF EXISTS "Admin y asistente actualizan survey_analyst_map" ON public.survey_analyst_map;
CREATE POLICY "Admin y asistente actualizan survey_analyst_map" ON public.survey_analyst_map FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')));

DROP POLICY IF EXISTS "Admin y asistente borran survey_analyst_map" ON public.survey_analyst_map;
CREATE POLICY "Admin y asistente borran survey_analyst_map" ON public.survey_analyst_map FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')));

-- Verificación:
-- SELECT * FROM public.survey_analyst_map ORDER BY survey_name;
