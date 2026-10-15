-- ======================================================================================
-- MIGRACIÓN: Enlace lista A001 ↔ Inventario
-- Ejecutar en Supabase → SQL Editor (después de supabase_migration_checklist_a001.sql)
-- ======================================================================================
--
-- inventory_items.a001_item_id : a qué línea de la lista A001 corresponde el equipo
--                                (ej. los 8 drivers → línea "Drivers"). Se asigna desde
--                                el editor de la lista A001 (botón 🔗).
-- inventory_loans.task_id      : gestión para la que salió el equipo (checklist Rotodinámico).
-- ======================================================================================

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS a001_item_id TEXT;
ALTER TABLE public.inventory_loans ADD COLUMN IF NOT EXISTS task_id TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_items_a001 ON public.inventory_items(a001_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_loans_task ON public.inventory_loans(task_id);

-- Verificación:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name IN ('inventory_items','inventory_loans') AND column_name IN ('a001_item_id','task_id');
