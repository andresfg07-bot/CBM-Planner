-- =======================================================================
-- MIGRACIÓN: Campos para REQ-02 (No respuesta de cliente en CSAT)
-- Ejecutar en Supabase → SQL Editor
-- =======================================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS client_no_response BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS evidence_notes     TEXT,
    ADD COLUMN IF NOT EXISTS evidence_files     JSONB DEFAULT '[]'::jsonb;


-- =======================================================================
-- STORAGE: Bucket para archivos de evidencia
-- Ejecutar también en Supabase → SQL Editor
-- (Alternativamente puedes crear el bucket desde Storage → New bucket)
-- =======================================================================

-- 1. Crear bucket público
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-files', 'evidence-files', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Permitir subida a usuarios autenticados
CREATE POLICY "Autenticados pueden subir evidencias"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'evidence-files');

-- 3. Lectura pública (para ver los archivos desde cualquier lugar)
CREATE POLICY "Lectura pública de evidencias"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'evidence-files');

-- 4. Eliminar propios archivos
CREATE POLICY "Autenticados pueden borrar sus evidencias"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'evidence-files');
