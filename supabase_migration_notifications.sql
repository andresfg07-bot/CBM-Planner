-- ======================================================================================
-- MIGRACIÓN: Sistema de Notificaciones In-App (Fase 1 — Infraestructura)
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- Cada usuario ve solo SUS notificaciones. La app (autenticada) puede insertar
-- notificaciones dirigidas a cualquier usuario (para que un evento del analista
-- pueda notificar al admin, etc.).
-- ======================================================================================

-- 1. Tabla
CREATE TABLE IF NOT EXISTS public.notifications (
    id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type         TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    body         TEXT        DEFAULT '',
    data         JSONB       DEFAULT '{}'::jsonb,
    is_urgent    BOOLEAN     DEFAULT FALSE,
    read_at      TIMESTAMPTZ,
    resolved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
    ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON public.notifications(user_id) WHERE read_at IS NULL;

-- 3. Row-Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Cada usuario ve sus propias notificaciones
DROP POLICY IF EXISTS "Usuario ve sus notificaciones" ON public.notifications;
CREATE POLICY "Usuario ve sus notificaciones"
    ON public.notifications FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Cualquier usuario autenticado puede crear notificaciones (la app dispara eventos
-- para otros usuarios: ej. asignar gestión al analista dispara notif hacia él).
DROP POLICY IF EXISTS "Autenticados pueden crear notificaciones" ON public.notifications;
CREATE POLICY "Autenticados pueden crear notificaciones"
    ON public.notifications FOR INSERT TO authenticated
    WITH CHECK (true);

-- Cada usuario puede actualizar sus notificaciones (marcar leídas / resueltas)
DROP POLICY IF EXISTS "Usuario actualiza sus notificaciones" ON public.notifications;
CREATE POLICY "Usuario actualiza sus notificaciones"
    ON public.notifications FOR UPDATE TO authenticated
    USING    (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Cada usuario puede borrar sus notificaciones (por si quisiera limpiar)
DROP POLICY IF EXISTS "Usuario borra sus notificaciones" ON public.notifications;
CREATE POLICY "Usuario borra sus notificaciones"
    ON public.notifications FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- 4. Verificación
-- SELECT count(*) FROM public.notifications;
-- SELECT policyname FROM pg_policies WHERE tablename = 'notifications';
