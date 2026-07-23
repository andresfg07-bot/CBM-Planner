-- ======================================================================================
-- MIGRACIÓN: Kits de inventario (checklist por maleta/equipo compuesto)
-- Ejecutar en Supabase → SQL Editor
--
-- Un kit (ej. "Maleta Rotodinámico ASDAQ 1") agrupa ítems que YA existen en
-- inventory_items bajo un QR maestro. Al escanear el QR del kit se muestra un
-- checklist de sus ítems. Un ítem pertenece a UN SOLO kit (o a ninguno) —
-- si se necesita suelto para otro trabajo, se escanea de forma independiente.
-- ======================================================================================

-- 1. Tabla de kits
CREATE TABLE IF NOT EXISTS public.inventory_kits (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT        NOT NULL,
    category    TEXT        DEFAULT 'General'
                    CHECK (category IN ('Vibraciones','Termografía','Ultrasonido','Balanceo','Alineación','Rotodinámico','Capacitación','General')),
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Membresía: un ítem pertenece a un solo kit (o ninguno)
ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS kit_id UUID REFERENCES public.inventory_kits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_kit_id ON public.inventory_items(kit_id);

-- 3. RLS: inventory_kits (mismo patrón que inventory_items)
ALTER TABLE public.inventory_kits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth lee inventory_kits" ON public.inventory_kits;
CREATE POLICY "Auth lee inventory_kits"
    ON public.inventory_kits FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin inserta inventory_kits" ON public.inventory_kits;
CREATE POLICY "Admin inserta inventory_kits"
    ON public.inventory_kits FOR INSERT TO authenticated
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin actualiza inventory_kits" ON public.inventory_kits;
CREATE POLICY "Admin actualiza inventory_kits"
    ON public.inventory_kits FOR UPDATE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin borra inventory_kits" ON public.inventory_kits;
CREATE POLICY "Admin borra inventory_kits"
    ON public.inventory_kits FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- Verificación:
-- SELECT k.name, count(i.id) AS n_items FROM public.inventory_kits k
-- LEFT JOIN public.inventory_items i ON i.kit_id = k.id GROUP BY k.id, k.name;
