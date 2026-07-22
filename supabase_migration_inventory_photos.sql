-- ======================================================================================
-- MIGRACIÓN: Fotos de ítems del inventario (Supabase Storage, no la base de datos)
-- Ejecutar en Supabase → SQL Editor
--
-- Las fotos NO se guardan en la tabla (evita llenar la cuota de Postgres). Se suben
-- comprimidas (<150KB) a un bucket de Storage y solo se guarda la URL pública en
-- inventory_items.photo_url.
-- ======================================================================================

-- 1. Columna para la URL de la foto
ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 2. Bucket de Storage (público de solo lectura; escritura controlada por políticas abajo)
INSERT INTO storage.buckets (id, name, public)
VALUES ('inventory-photos', 'inventory-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Políticas del bucket
DROP POLICY IF EXISTS "Cualquiera ve fotos de inventario" ON storage.objects;
CREATE POLICY "Cualquiera ve fotos de inventario"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'inventory-photos');

DROP POLICY IF EXISTS "Auth sube fotos de inventario" ON storage.objects;
CREATE POLICY "Auth sube fotos de inventario"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'inventory-photos');

DROP POLICY IF EXISTS "Auth actualiza fotos de inventario" ON storage.objects;
CREATE POLICY "Auth actualiza fotos de inventario"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'inventory-photos') WITH CHECK (bucket_id = 'inventory-photos');

DROP POLICY IF EXISTS "Admin borra fotos de inventario" ON storage.objects;
CREATE POLICY "Admin borra fotos de inventario"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'inventory-photos' AND (auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- Verificación:
-- SELECT * FROM storage.buckets WHERE id = 'inventory-photos';
-- SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';
