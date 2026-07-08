-- ======================================================================================
-- MIGRACIÓN: Alinear categorías de inventory_items con los tipos de servicio de gestiones
-- Ejecutar en Supabase → SQL Editor del proyecto STAGING (la tabla ya existe)
--
-- Antes: 'vibraciones','alineacion','rotodinamico','general'
-- Ahora: los mismos valores que usa taskServiceType, para poder cruzar inventario
--        con el tipo de gestión más adelante. Se excluyen las ausencias
--        (Vacaciones, Incapacidad, Compensatorio, etc.) porque no requieren equipo.
-- ======================================================================================

-- 1. Quitar el CHECK viejo
ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS inventory_items_category_check;

-- 2. Traducir valores existentes al nuevo vocabulario (por si ya hay ítems cargados)
UPDATE public.inventory_items SET category = 'Vibraciones'  WHERE category = 'vibraciones';
UPDATE public.inventory_items SET category = 'Alineación'   WHERE category = 'alineacion';
UPDATE public.inventory_items SET category = 'Rotodinámico' WHERE category = 'rotodinamico';
UPDATE public.inventory_items SET category = 'General'      WHERE category = 'general';

-- 3. Nuevo CHECK con el vocabulario completo (gestiones productivas, sin ausencias)
ALTER TABLE public.inventory_items
    ADD CONSTRAINT inventory_items_category_check
    CHECK (category IN ('Vibraciones','Termografía','Ultrasonido','Balanceo','Alineación','Rotodinámico','Capacitación','General'));

-- 4. Nuevo default
ALTER TABLE public.inventory_items ALTER COLUMN category SET DEFAULT 'General';

-- Verificación:
-- SELECT DISTINCT category FROM public.inventory_items;
