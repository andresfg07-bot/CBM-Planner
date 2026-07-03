-- ======================================================================================
-- MIGRACIÓN v2: Permitir limpieza automática de notificaciones entre usuarios
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- Problema: cuando el ADMIN devuelve una gestión de programada → proyectada, la app
-- debe borrar la notificación "Nueva gestión" que pertenece al ANALISTA. La política
-- original de DELETE/UPDATE solo permitía tocar las notificaciones PROPIAS
-- (auth.uid() = user_id), por lo que el borrado cruzado fallaba en silencio
-- (RLS filtra las filas: 0 afectadas, sin error).
--
-- Lo mismo aplica al auto-cierre: cuando el asistente factura, hay que resolver
-- notificaciones del propio asistente Y de los comerciales.
--
-- Solución: ampliar UPDATE y DELETE a cualquier usuario autenticado. Es coherente
-- con el INSERT (que ya permite crear notifs para otros) y aceptable en esta app
-- interna donde todos los usuarios son de confianza.
-- ======================================================================================

-- UPDATE: cualquier autenticado puede actualizar (auto-cierre entre usuarios)
DROP POLICY IF EXISTS "Usuario actualiza sus notificaciones" ON public.notifications;
DROP POLICY IF EXISTS "Autenticados actualizan notificaciones" ON public.notifications;
CREATE POLICY "Autenticados actualizan notificaciones"
    ON public.notifications FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

-- DELETE: cualquier autenticado puede borrar (auto-borrado entre usuarios)
DROP POLICY IF EXISTS "Usuario borra sus notificaciones" ON public.notifications;
DROP POLICY IF EXISTS "Autenticados borran notificaciones" ON public.notifications;
CREATE POLICY "Autenticados borran notificaciones"
    ON public.notifications FOR DELETE TO authenticated
    USING (true);

-- SELECT se mantiene restringido: cada usuario solo VE las suyas.
-- (No se toca la política "Usuario ve sus notificaciones".)

-- Verificación:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notifications' ORDER BY cmd;
