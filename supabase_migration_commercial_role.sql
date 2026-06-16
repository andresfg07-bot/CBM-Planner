-- ======================================================================================
-- MIGRACIÓN: Nuevo rol "commercial" (Comercial — solo lectura)
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- El perfil Comercial puede VISUALIZAR (sin modificar nada):
--   Dashboard, Gestiones, Planeación (calendario), Finanzas y Reportes.
-- No tiene acceso a Admin de datos ni a "Mis Gestiones".
-- ======================================================================================


-- ─── 1. Permitir el rol 'commercial' en la restricción CHECK de profiles ──────────────
-- La tabla profiles solo aceptaba: admin, analyst, assistant, viewer.
-- Hay que ampliar la restricción para que acepte también 'commercial'.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'analyst', 'assistant', 'commercial', 'viewer'));


-- ─── 2. Crear los usuarios en Supabase Auth ───────────────────────────────────────────
-- Esto NO se hace por SQL. Ve a:
--   Supabase → Authentication → Users → Add user → Create new user
--
-- Crea uno por uno (marca "Auto Confirm User"):
--   • mriano@a-maq.com
--   • jrestrepo@a-maq.com
--
-- La contraseña la defines tú en la interfaz de Supabase y se la compartes
-- al usuario por un canal seguro para que la cambie al ingresar.
--
-- Al crear cada usuario, el trigger on_auth_user_created genera automáticamente
-- su fila en profiles con role = 'viewer'.


-- ─── 3. Asignar rol 'commercial' y nombre a cada perfil ───────────────────────────────
-- Ejecutar DESPUÉS de haber creado los usuarios en Authentication.

UPDATE public.profiles
SET role = 'commercial', display_name = 'Marta Liliana Riaño'
WHERE email = 'mriano@a-maq.com';

UPDATE public.profiles
SET role = 'commercial', display_name = 'Johan Emilio Restrepo'
WHERE email = 'jrestrepo@a-maq.com';


-- ─── 4. Verificación ──────────────────────────────────────────────────────────────────
-- SELECT email, display_name, role
-- FROM profiles
-- WHERE email IN ('mriano@a-maq.com', 'jrestrepo@a-maq.com');


-- ======================================================================================
-- NOTA SOBRE SEGURIDAD (RLS):
-- Las políticas de escritura en 'tasks' y 'profiles' solo permiten modificar a
-- agonzalez@a-maq.com. El rol 'commercial' NO tiene ninguna política de escritura,
-- por lo que aunque la UI fallara, la base de datos rechaza cualquier cambio.
-- No se requiere agregar políticas nuevas para que el comercial funcione (solo lee).
-- ======================================================================================
