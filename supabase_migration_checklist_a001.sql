-- ======================================================================================
-- MIGRACIÓN: Lista A001 editable (alistamiento de equipos del checklist Rotodinámico)
-- Ejecutar en Supabase → SQL Editor (después de supabase_migration_task_checklists.sql)
-- ======================================================================================
--
-- La lista base viene en la app; al pulsar "Guardar lista base y editar" se copia a esta
-- tabla y desde ahí el admin puede agregar, renombrar, mover o quitar elementos.
-- Las cantidades que salen en cada gestión se guardan dentro de task_checklists.data.
-- ======================================================================================

CREATE TABLE IF NOT EXISTS public.checklist_a001_items (
    id          TEXT        PRIMARY KEY,
    group_name  TEXT        NOT NULL DEFAULT 'Otros',
    name        TEXT        NOT NULL,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.checklist_a001_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth lee checklist_a001_items" ON public.checklist_a001_items;
CREATE POLICY "Auth lee checklist_a001_items"
    ON public.checklist_a001_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin inserta checklist_a001_items" ON public.checklist_a001_items;
CREATE POLICY "Admin inserta checklist_a001_items"
    ON public.checklist_a001_items FOR INSERT TO authenticated
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin actualiza checklist_a001_items" ON public.checklist_a001_items;
CREATE POLICY "Admin actualiza checklist_a001_items"
    ON public.checklist_a001_items FOR UPDATE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin borra checklist_a001_items" ON public.checklist_a001_items;
CREATE POLICY "Admin borra checklist_a001_items"
    ON public.checklist_a001_items FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- Verificación:
-- SELECT * FROM public.checklist_a001_items ORDER BY sort_order;
