-- ======================================================================================
-- SETUP: Módulo de Control de Inventario CBM
-- Ejecutar en Supabase → SQL Editor del proyecto STAGING primero
-- ======================================================================================

-- ── 1. Tabla de ítems del inventario ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    name                    TEXT        NOT NULL,
    category                TEXT        DEFAULT 'General'
                                CHECK (category IN ('Vibraciones','Termografía','Ultrasonido','Balanceo','Alineación','Rotodinámico','Capacitación','General')),
    serial_number           TEXT,
    description             TEXT,
    is_permanently_assigned BOOLEAN     DEFAULT FALSE,
    assigned_analyst        TEXT,       -- solo cuando is_permanently_assigned = TRUE
    status                  TEXT        DEFAULT 'disponible'
                                CHECK (status IN ('disponible','prestado','dañado','perdido')),
    equipment_id            UUID        REFERENCES public.equipment(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_equipment_id ON public.inventory_items(equipment_id);

-- ── 2. Tabla de préstamos (movimientos de salida/entrada) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_loans (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id         UUID        NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    analyst_name    TEXT        NOT NULL,
    checked_out_at  TIMESTAMPTZ DEFAULT NOW(),
    checked_in_at   TIMESTAMPTZ,           -- NULL = sigue fuera
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loans_item_id  ON public.inventory_loans(item_id);
CREATE INDEX IF NOT EXISTS idx_loans_active   ON public.inventory_loans(item_id) WHERE checked_in_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_loans_analyst  ON public.inventory_loans(analyst_name);

-- ── 3. RLS: inventory_items ───────────────────────────────────────────────────────────
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth lee inventory_items"  ON public.inventory_items;
CREATE POLICY "Auth lee inventory_items"
    ON public.inventory_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin escribe inventory_items" ON public.inventory_items;
CREATE POLICY "Admin escribe inventory_items"
    ON public.inventory_items FOR ALL TO authenticated
    USING    ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- ── 4. RLS: inventory_loans ───────────────────────────────────────────────────────────
ALTER TABLE public.inventory_loans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth lee inventory_loans" ON public.inventory_loans;
CREATE POLICY "Auth lee inventory_loans"
    ON public.inventory_loans FOR SELECT TO authenticated USING (true);

-- Cualquier usuario autenticado puede registrar salidas/entradas
DROP POLICY IF EXISTS "Auth inserta loans" ON public.inventory_loans;
CREATE POLICY "Auth inserta loans"
    ON public.inventory_loans FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Auth actualiza loans" ON public.inventory_loans;
CREATE POLICY "Auth actualiza loans"
    ON public.inventory_loans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin borra loans" ON public.inventory_loans;
CREATE POLICY "Admin borra loans"
    ON public.inventory_loans FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- ── Verificación ──────────────────────────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename IN ('inventory_items','inventory_loans') ORDER BY tablename, cmd;
