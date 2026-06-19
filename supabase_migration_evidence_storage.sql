-- ======================================================================================
-- MIGRACIÓN: Acceso de lectura a las evidencias (Supabase Storage)
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- Problema: el comercial y el administrador no podían ABRIR los archivos de evidencia
-- (fotos/documentos) que sube el analista cuando el cliente no responde la encuesta.
--
-- Causa: el bucket "evidence-files" es privado, por lo que las URLs públicas no funcionan.
-- Solución: la app ahora genera URLs FIRMADAS temporales al hacer clic. Para que el
-- usuario autenticado pueda firmar/leer el archivo, necesita una política de SELECT
-- sobre storage.objects para ese bucket.
-- ======================================================================================

-- 1. Asegurar que el bucket exista (si no, créalo en Storage → New bucket, privado)
--    El nombre debe ser exactamente: evidence-files

-- 2. Política de LECTURA para usuarios autenticados
DROP POLICY IF EXISTS "Autenticados pueden leer evidencias" ON storage.objects;
CREATE POLICY "Autenticados pueden leer evidencias"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'evidence-files');

-- 3. Política de SUBIDA (por si los analistas aún no la tienen).
--    Permite a cualquier usuario autenticado subir evidencias.
DROP POLICY IF EXISTS "Autenticados pueden subir evidencias" ON storage.objects;
CREATE POLICY "Autenticados pueden subir evidencias"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'evidence-files');

-- ======================================================================================
-- ALTERNATIVA SIMPLE (menos segura):
-- En Supabase → Storage → bucket "evidence-files" → marcarlo como PÚBLICO.
-- Con eso las URLs públicas funcionan sin firmar, pero cualquier persona con el
-- enlace podría abrir el archivo. Para datos de clientes se recomienda mantenerlo
-- privado y usar las políticas de arriba (URLs firmadas).
-- ======================================================================================
