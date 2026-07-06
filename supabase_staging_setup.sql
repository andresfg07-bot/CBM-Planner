-- ======================================================================================
-- SETUP COMPLETO PARA AMBIENTE DE STAGING (planner-cbm-staging)
-- Ejecutar en Supabase → SQL Editor del proyecto staging
--
-- Este script crea todas las tablas, índices, RLS y el perfil de admin.
-- Corre todo de una vez. Es idempotente (IF NOT EXISTS en todas las tablas).
-- ======================================================================================


-- ══════════════════════════════════════════════════════════════
-- 1. TABLA: clients
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.clients (
    id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    company_name TEXT        NOT NULL,
    plant        TEXT,
    contact_name TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados (clients)" ON public.clients;
CREATE POLICY "Permitir lectura a usuarios autenticados (clients)"
    ON public.clients FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin puede escribir clients" ON public.clients;
CREATE POLICY "Admin puede escribir clients"
    ON public.clients FOR ALL TO authenticated
    USING    ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');


-- ══════════════════════════════════════════════════════════════
-- 2. TABLA: analysts
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.analysts (
    id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
    name       TEXT    NOT NULL,
    specialty  TEXT,
    is_active  BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.analysts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados (analysts)" ON public.analysts;
CREATE POLICY "Permitir lectura a usuarios autenticados (analysts)"
    ON public.analysts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin puede escribir analysts" ON public.analysts;
CREATE POLICY "Admin puede escribir analysts"
    ON public.analysts FOR ALL TO authenticated
    USING    ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');


-- ══════════════════════════════════════════════════════════════
-- 3. TABLA: equipment
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.equipment (
    id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
    name          TEXT    NOT NULL,
    serial_number TEXT,
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados (equipment)" ON public.equipment;
CREATE POLICY "Permitir lectura a usuarios autenticados (equipment)"
    ON public.equipment FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin puede escribir equipment" ON public.equipment;
CREATE POLICY "Admin puede escribir equipment"
    ON public.equipment FOR ALL TO authenticated
    USING    ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');


-- ══════════════════════════════════════════════════════════════
-- 4. TABLA: client_plants
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.client_plants (
    id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id  UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_plants_client_id
    ON public.client_plants(client_id);

ALTER TABLE public.client_plants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados pueden ver plantas" ON public.client_plants;
CREATE POLICY "Autenticados pueden ver plantas"
    ON public.client_plants FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin puede escribir plantas" ON public.client_plants;
CREATE POLICY "Admin puede escribir plantas"
    ON public.client_plants FOR ALL TO authenticated
    USING    ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');


-- ══════════════════════════════════════════════════════════════
-- 5. TABLA: client_analyst_preferences
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.client_analyst_preferences (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    analyst_id     UUID NOT NULL REFERENCES public.analysts(id) ON DELETE CASCADE,
    priority_level TEXT DEFAULT 'titular',
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, analyst_id)
);

ALTER TABLE public.client_analyst_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados (client_analyst_preferences)" ON public.client_analyst_preferences;
CREATE POLICY "Permitir lectura a usuarios autenticados (client_analyst_preferences)"
    ON public.client_analyst_preferences FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin puede escribir client_analyst_preferences" ON public.client_analyst_preferences;
CREATE POLICY "Admin puede escribir client_analyst_preferences"
    ON public.client_analyst_preferences FOR ALL TO authenticated
    USING    ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');


-- ══════════════════════════════════════════════════════════════
-- 6. TABLA: tasks
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tasks (
    id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    client              TEXT,
    analyst             TEXT,
    budget              NUMERIC     DEFAULT 0,
    days_field          INTEGER     DEFAULT 1,
    days_report         INTEGER     DEFAULT 0,
    scheduled_days      JSONB       DEFAULT '[]'::jsonb,
    status              TEXT        DEFAULT 'proyectada',
    period              TEXT,
    equipment_id        UUID        REFERENCES public.equipment(id) ON DELETE SET NULL,
    service_type        TEXT,
    is_absence          BOOLEAN     DEFAULT FALSE,
    csat_score          TEXT,
    csat_observations   TEXT,
    alertvox_checked    BOOLEAN     DEFAULT FALSE,
    client_no_response  BOOLEAN     DEFAULT FALSE,
    evidence_notes      TEXT,
    evidence_files      JSONB       DEFAULT '[]'::jsonb,
    service_details     TEXT,
    mes_facturacion     TEXT,
    analysts_assignment JSONB       DEFAULT '[]'::jsonb,
    plant_id            UUID        REFERENCES public.client_plants(id) ON DELETE SET NULL,
    plant_name          TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_period_idx    ON public.tasks(period);
CREATE INDEX IF NOT EXISTS tasks_status_idx    ON public.tasks(status);
CREATE INDEX IF NOT EXISTS tasks_mes_fact_idx  ON public.tasks(mes_facturacion);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados (tasks)" ON public.tasks;
CREATE POLICY "Permitir lectura a usuarios autenticados (tasks)"
    ON public.tasks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin puede insertar tasks" ON public.tasks;
CREATE POLICY "Admin puede insertar tasks"
    ON public.tasks FOR INSERT TO authenticated
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin puede actualizar tasks" ON public.tasks;
CREATE POLICY "Admin puede actualizar tasks"
    ON public.tasks FOR UPDATE TO authenticated
    USING    ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin puede eliminar tasks" ON public.tasks;
CREATE POLICY "Admin puede eliminar tasks"
    ON public.tasks FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');


-- ══════════════════════════════════════════════════════════════
-- 7. TABLA: profiles
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
    id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    display_name TEXT,
    role         TEXT NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('admin', 'analyst', 'assistant', 'commercial', 'viewer')),
    analyst_name TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles(role);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario puede leer su propio perfil" ON public.profiles;
CREATE POLICY "Usuario puede leer su propio perfil"
    ON public.profiles FOR SELECT TO authenticated
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admin puede leer todos los perfiles" ON public.profiles;
CREATE POLICY "Admin puede leer todos los perfiles"
    ON public.profiles FOR SELECT TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin puede escribir perfiles" ON public.profiles;
CREATE POLICY "Admin puede escribir perfiles"
    ON public.profiles FOR ALL TO authenticated
    USING    ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');


-- ══════════════════════════════════════════════════════════════
-- 8. TRIGGER: crear perfil 'viewer' automáticamente al registrar usuario
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'viewer')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ══════════════════════════════════════════════════════════════
-- 9. TABLA: notifications
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notifications (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type        TEXT        NOT NULL,
    title       TEXT        NOT NULL,
    body        TEXT        DEFAULT '',
    data        JSONB       DEFAULT '{}'::jsonb,
    is_urgent   BOOLEAN     DEFAULT FALSE,
    read_at     TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
    ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON public.notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario ve sus notificaciones" ON public.notifications;
CREATE POLICY "Usuario ve sus notificaciones"
    ON public.notifications FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Autenticados pueden crear notificaciones" ON public.notifications;
CREATE POLICY "Autenticados pueden crear notificaciones"
    ON public.notifications FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Autenticados actualizan notificaciones" ON public.notifications;
CREATE POLICY "Autenticados actualizan notificaciones"
    ON public.notifications FOR UPDATE TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Autenticados borran notificaciones" ON public.notifications;
CREATE POLICY "Autenticados borran notificaciones"
    ON public.notifications FOR DELETE TO authenticated
    USING (true);


-- ══════════════════════════════════════════════════════════════
-- 10. PERFIL DE ADMIN
--
-- Busca el UUID de tu usuario en:
--   Supabase → Authentication → Users → copia el UUID de agonzalez@a-maq.com
-- Luego reemplaza <UUID-DEL-ADMIN> y ejecuta solo este bloque:
-- ══════════════════════════════════════════════════════════════
INSERT INTO public.profiles (id, email, display_name, role)
VALUES (
    '<UUID-DEL-ADMIN>',
    'agonzalez@a-maq.com',
    'Andres González',
    'admin'
)
ON CONFLICT (id) DO UPDATE
    SET role = 'admin', display_name = 'Andres González', updated_at = NOW();


-- ══════════════════════════════════════════════════════════════
-- VERIFICACIÓN — ejecuta esto al final para confirmar:
-- ══════════════════════════════════════════════════════════════
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT id, email, role FROM public.profiles;
