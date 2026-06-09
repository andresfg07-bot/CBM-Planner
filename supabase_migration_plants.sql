-- =======================================================================
-- MIGRACIÓN: Tabla de Plantas / Sedes por Cliente
-- Ejecutar en Supabase → SQL Editor
-- =======================================================================

-- 1. Tabla de plantas vinculadas a cada cliente
CREATE TABLE IF NOT EXISTS public.client_plants (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id   UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Índice para consultas rápidas por cliente
CREATE INDEX IF NOT EXISTS idx_client_plants_client_id
    ON public.client_plants(client_id);

-- 3. RLS: todos los autenticados leen; solo el admin puede escribir
ALTER TABLE public.client_plants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados pueden ver plantas"
    ON public.client_plants FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin puede insertar plantas"
    ON public.client_plants FOR INSERT TO authenticated
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

CREATE POLICY "Admin puede actualizar plantas"
    ON public.client_plants FOR UPDATE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

CREATE POLICY "Admin puede eliminar plantas"
    ON public.client_plants FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');


-- =======================================================================
-- Columnas en la tabla tasks
-- =======================================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS plant_id   UUID REFERENCES public.client_plants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS plant_name TEXT;
