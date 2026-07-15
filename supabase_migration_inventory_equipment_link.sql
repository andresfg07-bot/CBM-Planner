-- ======================================================================================
-- MIGRACIÓN: Vínculo opcional entre inventory_items y equipment
-- Ejecutar en Supabase → SQL Editor del proyecto STAGING
--
-- No fusiona las tablas. Un ítem del inventario puede opcionalmente apuntar a un
-- registro de "equipment" (los equipos que ya se asignan a gestiones). Los ítems que
-- no son equipos de gestión (sensores, cables, cargadores, correas) simplemente
-- dejan esta columna en NULL.
-- ======================================================================================

ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS equipment_id UUID REFERENCES public.equipment(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_equipment_id ON public.inventory_items(equipment_id);

-- Verificación:
-- SELECT i.name, i.category, e.name AS equipo_vinculado FROM public.inventory_items i
-- LEFT JOIN public.equipment e ON e.id = i.equipment_id;
