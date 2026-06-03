-- =======================================================================
-- MIGRACIÓN: Campos para REQ-02 (No respuesta de cliente en CSAT)
-- Ejecutar en Supabase → SQL Editor
-- =======================================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS client_no_response BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS evidence_notes     TEXT;
