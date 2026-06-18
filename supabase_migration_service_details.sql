-- ======================================================================================
-- MIGRACIÓN: Detalles del servicio para el comercial
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- Campo de texto libre donde el analista, al finalizar una gestión, registra la
-- información que necesita el comercial: # de subsistemas medidos, horas de servicio
-- (entrada/salida), cantidad de equipos, etc.
-- Visible para el comercial y el administrador en Gestiones y en Reportes.
-- ======================================================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS service_details TEXT;

-- No requiere políticas RLS adicionales:
--   • Lectura: ya cubierta por la política de SELECT para autenticados.
--   • Escritura: el analista asignado puede actualizar sus gestiones (política existente),
--     y el admin puede actualizar cualquiera. El comercial solo lee.
