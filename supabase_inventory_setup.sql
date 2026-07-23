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
    requires_calibration      BOOLEAN DEFAULT FALSE,
    last_calibration_date     DATE,
    calibration_interval_days INTEGER DEFAULT 365,
    photo_url                TEXT,       -- URL pública en Supabase Storage (bucket inventory-photos), no en la BD
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_equipment_id ON public.inventory_items(equipment_id);

-- Kits: agrupan ítems ya existentes bajo un QR maestro para checklist (ej. "Maleta Rotodinámico ASDAQ 1")
CREATE TABLE IF NOT EXISTS public.inventory_kits (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT        NOT NULL,
    category    TEXT        DEFAULT 'General'
                    CHECK (category IN ('Vibraciones','Termografía','Ultrasonido','Balanceo','Alineación','Rotodinámico','Capacitación','General')),
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Membresía: un ítem pertenece a un solo kit (o ninguno) — se agrega después porque
-- inventory_kits debe existir primero.
ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS kit_id UUID REFERENCES public.inventory_kits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_kit_id ON public.inventory_items(kit_id);

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

-- Bucket de Storage para fotos (comprimidas <150KB desde el navegador antes de subir)
INSERT INTO storage.buckets (id, name, public)
VALUES ('inventory-photos', 'inventory-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Cualquiera ve fotos de inventario" ON storage.objects;
CREATE POLICY "Cualquiera ve fotos de inventario"
    ON storage.objects FOR SELECT USING (bucket_id = 'inventory-photos');

DROP POLICY IF EXISTS "Auth sube fotos de inventario" ON storage.objects;
CREATE POLICY "Auth sube fotos de inventario"
    ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'inventory-photos');

DROP POLICY IF EXISTS "Auth actualiza fotos de inventario" ON storage.objects;
CREATE POLICY "Auth actualiza fotos de inventario"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'inventory-photos') WITH CHECK (bucket_id = 'inventory-photos');

DROP POLICY IF EXISTS "Admin borra fotos de inventario" ON storage.objects;
CREATE POLICY "Admin borra fotos de inventario"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'inventory-photos' AND (auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- Auditoría de daño/pérdida: nota obligatoria, quién lo reportó, si ya se resolvió
CREATE TABLE IF NOT EXISTS public.inventory_incidents (
    id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id          UUID        NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    type             TEXT        NOT NULL CHECK (type IN ('dañado','perdido')),
    note             TEXT        NOT NULL,
    reported_by      TEXT        NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    resolved_at      TIMESTAMPTZ,
    resolution_note  TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_incidents_item ON public.inventory_incidents(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_incidents_open ON public.inventory_incidents(item_id) WHERE resolved_at IS NULL;

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

-- INSERT/DELETE controlan el catálogo (solo admin). UPDATE se abre a cualquier
-- autenticado porque el flujo de escaneo QR y el reporte de incidentes los
-- ejecuta el analista, no el admin.
DROP POLICY IF EXISTS "Admin inserta inventory_items" ON public.inventory_items;
CREATE POLICY "Admin inserta inventory_items"
    ON public.inventory_items FOR INSERT TO authenticated
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Auth actualiza inventory_items" ON public.inventory_items;
CREATE POLICY "Auth actualiza inventory_items"
    ON public.inventory_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin borra inventory_items" ON public.inventory_items;
CREATE POLICY "Admin borra inventory_items"
    ON public.inventory_items FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- ── 3b. RLS: inventory_incidents ──────────────────────────────────────────────────────
ALTER TABLE public.inventory_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth lee inventory_incidents" ON public.inventory_incidents;
CREATE POLICY "Auth lee inventory_incidents"
    ON public.inventory_incidents FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth reporta inventory_incidents" ON public.inventory_incidents;
CREATE POLICY "Auth reporta inventory_incidents"
    ON public.inventory_incidents FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Auth resuelve inventory_incidents" ON public.inventory_incidents;
CREATE POLICY "Auth resuelve inventory_incidents"
    ON public.inventory_incidents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin borra inventory_incidents" ON public.inventory_incidents;
CREATE POLICY "Admin borra inventory_incidents"
    ON public.inventory_incidents FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

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
