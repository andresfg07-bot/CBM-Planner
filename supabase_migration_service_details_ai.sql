-- ======================================================================================
-- MIGRACIÓN: Estructuración por IA de los detalles del servicio + estado de lectura
-- Ejecutar en Supabase → SQL Editor
--
-- service_details ya existía (texto libre/estructurado que ve el comercial).
-- Se agrega:
--   - service_details_raw:      texto original dictado, antes de pasar por la IA
--                                (auditoría / para poder reprocesar si hace falta).
--   - service_details_read_at:  NULL = no leído. Se pone en NULL cada vez que el
--                                analista registra un dato nuevo, y se llena con la
--                                fecha/hora cuando un comercial/admin/viewer abre el
--                                detalle y lo lee por primera vez.
-- ======================================================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS service_details_raw     TEXT,
    ADD COLUMN IF NOT EXISTS service_details_read_at  TIMESTAMPTZ;

-- Antes, comercial y viewer solo podían LEER tasks (ninguna política de UPDATE).
-- Ahora necesitan poder marcar el detalle como leído al abrirlo.
DROP POLICY IF EXISTS "Comercial y viewer marcan detalles como leidos" ON public.tasks;
CREATE POLICY "Comercial y viewer marcan detalles como leidos"
    ON public.tasks FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('commercial', 'viewer'))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('commercial', 'viewer'))
    );

-- Verificación:
-- SELECT id, service_details_raw, service_details_read_at FROM public.tasks WHERE service_details IS NOT NULL LIMIT 10;
