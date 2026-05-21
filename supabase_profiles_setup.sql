-- ======================================================================================
-- CONFIGURACIÓN DE PERFILES Y ROLES DE USUARIO
-- Ejecutar este script en Supabase → SQL Editor
-- Prerequisito: supabase_rls_policies.sql ya debe estar aplicado
-- ======================================================================================


-- ─── 1. Tabla de perfiles de usuario ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    display_name TEXT,
    role         TEXT NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('admin', 'analyst', 'assistant', 'viewer')),
    analyst_name TEXT,   -- Coincide con analysts.name cuando role = 'analyst'
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas por rol
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles(role);


-- ─── 2. RLS en la tabla profiles ─────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Cada usuario puede leer su propio perfil
CREATE POLICY "Usuario puede leer su propio perfil"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = id);

-- Admin puede leer todos los perfiles
CREATE POLICY "Admin puede leer todos los perfiles"
ON public.profiles FOR SELECT TO authenticated
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

-- Admin puede insertar perfiles
CREATE POLICY "Admin puede insertar perfiles"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

-- Admin puede actualizar perfiles
CREATE POLICY "Admin puede actualizar perfiles"
ON public.profiles FOR UPDATE TO authenticated
USING    (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'))
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

-- Admin puede eliminar perfiles
CREATE POLICY "Admin puede eliminar perfiles"
ON public.profiles FOR DELETE TO authenticated
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));


-- ─── 3. Trigger: crear perfil automáticamente al registrar usuario ────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'viewer')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Eliminar trigger si ya existe, luego recrear
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ─── 4. Función trigger para actualizar updated_at automáticamente ────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();


-- ─── 5. Política UPDATE en tasks: permitir analistas y asistentes ─────────────
-- NOTA: Primero eliminamos la política restrictiva existente y la reemplazamos.

DROP POLICY IF EXISTS "Permitir update a admin (tasks)" ON public.tasks;

-- Nueva política: admin puede actualizar todo
CREATE POLICY "Admin puede actualizar tasks"
ON public.tasks FOR UPDATE TO authenticated
USING    (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'))
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

-- Analista puede actualizar SÓLO las tareas donde está asignado
-- (para marcar como ejecutada y llenar CSAT)
CREATE POLICY "Analista puede actualizar sus tasks"
ON public.tasks FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(tasks.analysts_assignment::jsonb, '[]'::jsonb)
        ) AS elem
        WHERE p.id = auth.uid()
          AND p.role = 'analyst'
          AND p.analyst_name IS NOT NULL
          AND elem->>'name' = p.analyst_name
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'analyst'
    )
);

-- Asistente puede actualizar cualquier tarea (ej: marcar como facturada)
CREATE POLICY "Asistente puede actualizar tasks"
ON public.tasks FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'assistant'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'assistant'
    )
);


-- ─── 6. Insertar perfil inicial para el admin ─────────────────────────────────
-- Ajusta el UUID real del admin en Supabase → Authentication → Users
-- Luego ejecuta esto manualmente con el UUID correcto:
--
-- INSERT INTO public.profiles (id, email, display_name, role)
-- VALUES (
--     '<UUID-DEL-ADMIN>',
--     'agonzalez@a-maq.com',
--     'Andres González',
--     'admin'
-- )
-- ON CONFLICT (id) DO UPDATE SET role = 'admin', display_name = 'Andres González';


-- ─── 7. Verificación ─────────────────────────────────────────────────────────
-- Ejecuta esto para verificar que todo quedó bien:
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('profiles', 'tasks') ORDER BY tablename, cmd;
