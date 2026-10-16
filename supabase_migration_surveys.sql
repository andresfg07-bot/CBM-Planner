-- ======================================================================================
-- MIGRACIÓN: Encuestas de satisfacción de clientes (rondas trimestrales)
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- survey_rounds     : una ronda (ej. "Encuesta Q4 2026") con su ventana de medición.
-- survey_invites    : cada cliente/contacto a llamar en la ronda (estado + intentos).
-- survey_responses  : respuestas de la encuesta de un contacto (una por invitación).
-- client_contacts   : contactos por empresa (hasta varios), reutilizables entre rondas.
--
-- Permisos:
--   · Ver resultados : admin, assistant, commercial, viewer  (el módulo muestra los resultados
--                      solo al admin por ahora; se habilita al resto desde la app).
--   · Crear/llenar   : admin y assistant (las practicantes usan un perfil asistente).
--   · Borrar         : solo el admin.
-- ======================================================================================

CREATE TABLE IF NOT EXISTS public.survey_rounds (
    id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    name          TEXT        NOT NULL,
    window_start  DATE,
    window_end    DATE,
    survey_date   DATE,                       -- fecha de referencia de la ronda (para ordenar y tendencias)
    status        TEXT        NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'cerrada')),
    source        TEXT        NOT NULL DEFAULT 'app',   -- 'app' | 'excel' (historial importado)
    notes         TEXT,
    created_by    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    closed_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.survey_invites (
    id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    round_id       UUID        NOT NULL REFERENCES public.survey_rounds(id) ON DELETE CASCADE,
    company_name   TEXT        NOT NULL,
    company_key    TEXT        NOT NULL,      -- nombre normalizado (minúsculas, sin tildes) para cruzar con clientes
    service_months TEXT,                      -- ej. "Jul, Ago"
    analysts       TEXT,                      -- analistas que atendieron en la ventana
    contact_name   TEXT,
    contact_role   TEXT,
    contact_email  TEXT,
    contact_phone  TEXT,
    status         TEXT        NOT NULL DEFAULT 'pendiente'
                       CHECK (status IN ('pendiente', 'contactado', 'respondida', 'sin_respuesta', 'omitida')),
    attempts       JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{at, channel, result, note, by}]
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_invites_round   ON public.survey_invites(round_id);
CREATE INDEX IF NOT EXISTS idx_survey_invites_company ON public.survey_invites(company_key);

CREATE TABLE IF NOT EXISTS public.survey_responses (
    id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    invite_id             UUID        NOT NULL UNIQUE REFERENCES public.survey_invites(id) ON DELETE CASCADE,
    answered_at           TIMESTAMPTZ DEFAULT NOW(),
    answered_by           TEXT,
    q_punctual            NUMERIC CHECK (q_punctual      BETWEEN 1 AND 5),   -- Cumplimiento de mediciones
    q_verbal              NUMERIC CHECK (q_verbal        BETWEEN 1 AND 5),   -- Acercamiento
    q_reports_time        NUMERIC CHECK (q_reports_time  BETWEEN 1 AND 5),   -- Cumplimiento de análisis
    q_clarity             NUMERIC CHECK (q_clarity       BETWEEN 1 AND 5),   -- Claridad
    q_accuracy            NUMERIC CHECK (q_accuracy      BETWEEN 1 AND 5),   -- Certeza
    q_closing_meeting     NUMERIC CHECK (q_closing_meeting BETWEEN 1 AND 5), -- NULL si no la conoce / no asistió
    closing_meeting_note  TEXT,
    emotion               TEXT CHECK (emotion IN ('positivas', 'negativas', 'neutras')),
    q_recommend           NUMERIC CHECK (q_recommend     BETWEEN 1 AND 5),   -- Recomendación
    q_ally                NUMERIC CHECK (q_ally          BETWEEN 1 AND 5),   -- Confianza (aliado)
    comments              TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_contacts (
    id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    company_key   TEXT        NOT NULL,
    company_name  TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    role          TEXT,
    email         TEXT,
    phone         TEXT,
    sort_order    INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_company ON public.client_contacts(company_key);

-- ── RLS ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.survey_rounds    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_invites   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_contacts  ENABLE ROW LEVEL SECURITY;

-- Lectura: admin, asistente, comercial y visor
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['survey_rounds', 'survey_invites', 'survey_responses', 'client_contacts'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Roles leen %1$s" ON public.%1$s', t);
        EXECUTE format($p$CREATE POLICY "Roles leen %1$s" ON public.%1$s FOR SELECT TO authenticated
            USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                           AND p.role IN ('admin', 'assistant', 'commercial', 'viewer')))$p$, t);
    END LOOP;
END $$;

-- Escritura (crear / llenar): admin y asistente
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['survey_rounds', 'survey_invites', 'survey_responses', 'client_contacts'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Admin y asistente insertan %1$s" ON public.%1$s', t);
        EXECUTE format($p$CREATE POLICY "Admin y asistente insertan %1$s" ON public.%1$s FOR INSERT TO authenticated
            WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                                AND p.role IN ('admin', 'assistant')))$p$, t);
        EXECUTE format('DROP POLICY IF EXISTS "Admin y asistente actualizan %1$s" ON public.%1$s', t);
        EXECUTE format($p$CREATE POLICY "Admin y asistente actualizan %1$s" ON public.%1$s FOR UPDATE TO authenticated
            USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')))
            WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'assistant')))$p$, t);
        EXECUTE format('DROP POLICY IF EXISTS "Admin borra %1$s" ON public.%1$s', t);
        EXECUTE format($p$CREATE POLICY "Admin borra %1$s" ON public.%1$s FOR DELETE TO authenticated
            USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')$p$, t);
    END LOOP;
END $$;

-- Verificación:
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename LIKE 'survey_%' OR tablename = 'client_contacts' ORDER BY 1, 3;
