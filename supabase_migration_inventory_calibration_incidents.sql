-- ======================================================================================
-- MIGRACIÓN: Calibración programada + Auditoría de daño/pérdida (inventario CBM)
-- Ejecutar en Supabase → SQL Editor del proyecto STAGING
-- ======================================================================================

-- ── 1. Calibración periódica en inventory_items ──────────────────────────────────────
ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS requires_calibration      BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_calibration_date      DATE,
    ADD COLUMN IF NOT EXISTS calibration_interval_days  INTEGER DEFAULT 365;

-- ── 1b. FIX DE RLS: permitir que analistas (no solo admin) actualicen inventory_items ──
-- La política original ("Admin escribe inventory_items" FOR ALL) bloqueaba en silencio
-- cualquier UPDATE de un analista al escanear un QR para llevar/devolver un ítem, porque
-- solo el admin pasaba el filtro. Solo se probó con la cuenta admin, por eso no se notó.
-- Se separa en INSERT/DELETE (solo admin, controla el catálogo) y UPDATE (cualquier
-- autenticado, necesario para el flujo de escaneo y para reportar incidentes).
DROP POLICY IF EXISTS "Admin escribe inventory_items" ON public.inventory_items;

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

-- ── 2. Tabla de incidentes (daño/pérdida) con nota obligatoria ───────────────────────
-- Un sistema de inventario serio no permite marcar "dañado" o "perdido" sin dejar
-- constancia de qué pasó y quién lo reportó. Esta tabla es el registro de auditoría;
-- inventory_items.status solo refleja el estado actual.
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

ALTER TABLE public.inventory_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth lee inventory_incidents" ON public.inventory_incidents;
CREATE POLICY "Auth lee inventory_incidents"
    ON public.inventory_incidents FOR SELECT TO authenticated USING (true);

-- Cualquier usuario autenticado puede reportar un incidente (el analista que rompe/pierde algo)
DROP POLICY IF EXISTS "Auth reporta inventory_incidents" ON public.inventory_incidents;
CREATE POLICY "Auth reporta inventory_incidents"
    ON public.inventory_incidents FOR INSERT TO authenticated WITH CHECK (true);

-- Cualquier usuario autenticado puede resolver (marcar reparado/recuperado)
DROP POLICY IF EXISTS "Auth resuelve inventory_incidents" ON public.inventory_incidents;
CREATE POLICY "Auth resuelve inventory_incidents"
    ON public.inventory_incidents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin borra inventory_incidents" ON public.inventory_incidents;
CREATE POLICY "Admin borra inventory_incidents"
    ON public.inventory_incidents FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- Verificación:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'inventory_items' AND column_name LIKE '%calibr%';
-- SELECT * FROM public.inventory_incidents ORDER BY created_at DESC;
