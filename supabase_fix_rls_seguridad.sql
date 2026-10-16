-- ======================================================================================
-- ARREGLO DE SEGURIDAD: cerrar el acceso sin sesión a tasks, clients, analysts,
-- equipment y client_analyst_preferences
-- Ejecutar en Supabase → SQL Editor (todo de una vez; va dentro de una transacción)
-- ======================================================================================
--
-- PROBLEMA ENCONTRADO
--   Estas tablas tenían políticas "ALL" (leer, crear, modificar y borrar) abiertas al rol
--   `anon`, es decir, a cualquiera que tuviera la clave pública que va dentro de app.js,
--   sin necesidad de iniciar sesión.
--
-- QUÉ HACE ESTE SCRIPT
--   1. Elimina TODA política de esas tablas que incluya a los roles anon o public.
--   2. Crea las políticas correctas: leer = cualquier usuario con sesión;
--      escribir = según el rol (admin, asistente, comercial/visor), igual que usa la app.
--   Las políticas de UPDATE para admin, analista y asistente que ya existen NO se tocan.
--
-- SI ALGO FALLA, la transacción se revierte sola y no queda nada a medias.
-- ======================================================================================

BEGIN;

-- 1. RLS activo en las tablas ---------------------------------------------------------
ALTER TABLE public.tasks                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_analyst_preferences ENABLE ROW LEVEL SECURITY;

-- 2. Quitar toda política abierta a visitantes sin sesión (anon / public) --------------
DO $$
DECLARE p RECORD;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN ('tasks', 'clients', 'analysts', 'equipment', 'client_analyst_preferences')
           AND (roles && ARRAY['anon', 'public']::name[])
    LOOP
        RAISE NOTICE 'Eliminando política abierta: %.% → "%"', p.schemaname, p.tablename, p.policyname;
        EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    END LOOP;
END $$;

-- 3. TASKS -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Auth lee tasks" ON public.tasks;
CREATE POLICY "Auth lee tasks"
    ON public.tasks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin inserta tasks" ON public.tasks;
CREATE POLICY "Admin inserta tasks"
    ON public.tasks FOR INSERT TO authenticated
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- La asistente (y las practicantes con perfil asistente) registran ausencias
DROP POLICY IF EXISTS "Asistente inserta ausencias" ON public.tasks;
CREATE POLICY "Asistente inserta ausencias"
    ON public.tasks FOR INSERT TO authenticated
    WITH CHECK (
        is_absence = true
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'assistant')
    );

DROP POLICY IF EXISTS "Admin borra tasks" ON public.tasks;
CREATE POLICY "Admin borra tasks"
    ON public.tasks FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- Comercial y visor marcan como leído el detalle del servicio
DROP POLICY IF EXISTS "Comercial y viewer marcan detalles como leidos" ON public.tasks;
CREATE POLICY "Comercial y viewer marcan detalles como leidos"
    ON public.tasks FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('commercial', 'viewer')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('commercial', 'viewer')));

-- 4. CLIENTS, ANALYSTS, EQUIPMENT, CLIENT_ANALYST_PREFERENCES --------------------------
-- Leer: cualquier usuario con sesión. Crear / modificar / borrar: solo el admin.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['clients', 'analysts', 'equipment', 'client_analyst_preferences'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Auth lee %1$s" ON public.%1$s', t);
        EXECUTE format('CREATE POLICY "Auth lee %1$s" ON public.%1$s FOR SELECT TO authenticated USING (true)', t);

        EXECUTE format('DROP POLICY IF EXISTS "Admin inserta %1$s" ON public.%1$s', t);
        EXECUTE format($p$CREATE POLICY "Admin inserta %1$s" ON public.%1$s FOR INSERT TO authenticated
            WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')$p$, t);

        EXECUTE format('DROP POLICY IF EXISTS "Admin actualiza %1$s" ON public.%1$s', t);
        EXECUTE format($p$CREATE POLICY "Admin actualiza %1$s" ON public.%1$s FOR UPDATE TO authenticated
            USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
            WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')$p$, t);

        EXECUTE format('DROP POLICY IF EXISTS "Admin borra %1$s" ON public.%1$s', t);
        EXECUTE format($p$CREATE POLICY "Admin borra %1$s" ON public.%1$s FOR DELETE TO authenticated
            USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')$p$, t);
    END LOOP;
END $$;

-- 5. Verificación: aquí NO debe aparecer anon ni public en ninguna fila ---------------
SELECT tablename, policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('tasks', 'clients', 'analysts', 'equipment', 'client_analyst_preferences')
 ORDER BY tablename, cmd, policyname;

COMMIT;

-- ======================================================================================
-- OPCIONAL: buscar otras políticas abiertas a visitantes sin sesión en CUALQUIER tabla
-- ======================================================================================
-- SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--  WHERE schemaname = 'public' AND (roles && ARRAY['anon', 'public']::name[])
--  ORDER BY tablename;
--
-- Y tablas sin RLS activo:
-- SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
--
-- SI ALGO DEJARA DE FUNCIONAR EN LA APP (no debería), se restaura el acceso SOLO para
-- usuarios con sesión (nunca para anon), por ejemplo:
-- CREATE POLICY "temporal tasks" ON public.tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
