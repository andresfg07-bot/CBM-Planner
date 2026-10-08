-- ======================================================================================
-- MIGRACIÓN: Consumibles de inventario (masas de balanceo, Loctite, shims, etc.)
-- Ejecutar en Supabase → SQL Editor
-- ======================================================================================
--
-- Un consumible NO se presta ni se devuelve: se gasta. Cada consumible tiene stock actual,
-- un punto de alerta (min_stock) y una cantidad sugerida de reposición (reorder_qty).
-- La categoría es solo una etiqueta (servicio con el que suele usarse); no restringe dónde
-- se puede consumir (ej. masas de balanceo dentro de una gestión de Vibraciones).
--
-- El consumo y las entradas se registran SIEMPRE por la función register_consumable_movement,
-- que actualiza el stock y guarda el movimiento en una sola transacción (sin condiciones de
-- carrera entre analistas) y genera/cierra la alerta de stock bajo para los admins.
-- ======================================================================================

-- 1. Tablas ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_consumables (
    id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    name         TEXT        NOT NULL,
    category     TEXT        DEFAULT 'General',
    unit         TEXT        NOT NULL DEFAULT 'unidades',
    stock        NUMERIC     NOT NULL DEFAULT 0 CHECK (stock >= 0),
    min_stock    NUMERIC     NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
    reorder_qty  NUMERIC     NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0),
    description  TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_consumable_movements (
    id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    consumable_id  UUID        NOT NULL REFERENCES public.inventory_consumables(id) ON DELETE CASCADE,
    type           TEXT        NOT NULL CHECK (type IN ('consumo','entrada','ajuste')),
    quantity       NUMERIC     NOT NULL,
    stock_before   NUMERIC     NOT NULL,
    stock_after    NUMERIC     NOT NULL,
    analyst_name   TEXT,
    task_id        TEXT,                -- gestión asociada (opcional, cualquier tipo de servicio)
    notes          TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consumable_mov_consumable
    ON public.inventory_consumable_movements(consumable_id, created_at DESC);

-- 2. RLS -------------------------------------------------------------------------------
ALTER TABLE public.inventory_consumables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_consumable_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth lee inventory_consumables" ON public.inventory_consumables;
CREATE POLICY "Auth lee inventory_consumables"
    ON public.inventory_consumables FOR SELECT TO authenticated USING (true);

-- El catálogo (crear/editar/borrar) es solo del admin. El stock NO se modifica con
-- UPDATE directo desde analistas: se hace por la función de abajo (SECURITY DEFINER).
DROP POLICY IF EXISTS "Admin inserta inventory_consumables" ON public.inventory_consumables;
CREATE POLICY "Admin inserta inventory_consumables"
    ON public.inventory_consumables FOR INSERT TO authenticated
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin actualiza inventory_consumables" ON public.inventory_consumables;
CREATE POLICY "Admin actualiza inventory_consumables"
    ON public.inventory_consumables FOR UPDATE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com')
    WITH CHECK ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Admin borra inventory_consumables" ON public.inventory_consumables;
CREATE POLICY "Admin borra inventory_consumables"
    ON public.inventory_consumables FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

DROP POLICY IF EXISTS "Auth lee inventory_consumable_movements" ON public.inventory_consumable_movements;
CREATE POLICY "Auth lee inventory_consumable_movements"
    ON public.inventory_consumable_movements FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin borra inventory_consumable_movements" ON public.inventory_consumable_movements;
CREATE POLICY "Admin borra inventory_consumable_movements"
    ON public.inventory_consumable_movements FOR DELETE TO authenticated
    USING ((auth.jwt() ->> 'email') = 'agonzalez@a-maq.com');

-- 3. Alerta de stock bajo (notificación in-app a todos los admin) -----------------------
-- Si stock <= min_stock: crea o actualiza UNA notificación activa por admin y consumible.
-- Si stock > min_stock: resuelve la notificación activa (reposición hecha).
CREATE OR REPLACE FUNCTION public.sync_consumable_alert(p_consumable_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c      public.inventory_consumables%ROWTYPE;
    v_admin UUID;
    v_title TEXT;
    v_body  TEXT;
    v_urgent BOOLEAN;
BEGIN
    SELECT * INTO c FROM public.inventory_consumables WHERE id = p_consumable_id;
    IF NOT FOUND THEN RETURN; END IF;

    IF c.stock <= c.min_stock THEN
        v_title  := 'Stock bajo: ' || c.name;
        v_body   := format('Quedan %s %s (mínimo %s).', trim_scale(c.stock)::text, c.unit, trim_scale(c.min_stock)::text);
        IF c.reorder_qty > 0 THEN
            v_body := v_body || format(' Programar fabricación/compra de %s %s.', trim_scale(c.reorder_qty)::text, c.unit);
        END IF;
        v_urgent := (c.stock <= 0);

        FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
            UPDATE public.notifications
               SET title = v_title, body = v_body, is_urgent = v_urgent,
                   read_at = NULL, created_at = NOW()
             WHERE user_id = v_admin
               AND type = 'consumible_bajo'
               AND data @> jsonb_build_object('consumable_id', p_consumable_id)
               AND resolved_at IS NULL;
            IF NOT FOUND THEN
                INSERT INTO public.notifications (user_id, type, title, body, data, is_urgent)
                VALUES (v_admin, 'consumible_bajo', v_title, v_body,
                        jsonb_build_object('consumable_id', p_consumable_id), v_urgent);
            END IF;
        END LOOP;
    ELSE
        UPDATE public.notifications
           SET resolved_at = NOW(), read_at = COALESCE(read_at, NOW())
         WHERE type = 'consumible_bajo'
           AND data @> jsonb_build_object('consumable_id', p_consumable_id)
           AND resolved_at IS NULL;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_consumable_alert(UUID) TO authenticated;

-- 4. Registro de movimientos (atómico) ---------------------------------------------------
--   consumo : resta p_quantity (cualquier usuario autenticado; falla si no alcanza el stock)
--   entrada : suma p_quantity (solo admin)  → reposición recibida / fabricada
--   ajuste  : fija el stock en p_quantity (solo admin) → conteo físico
-- Devuelve el stock resultante.
CREATE OR REPLACE FUNCTION public.register_consumable_movement(
    p_consumable_id UUID,
    p_type          TEXT,
    p_quantity      NUMERIC,
    p_analyst       TEXT DEFAULT NULL,
    p_task_id       TEXT DEFAULT NULL,
    p_notes         TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN := (auth.jwt() ->> 'email') = 'agonzalez@a-maq.com';
    v_before   NUMERIC;
    v_after    NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Debes iniciar sesión.';
    END IF;
    IF p_type NOT IN ('consumo','entrada','ajuste') THEN
        RAISE EXCEPTION 'Tipo de movimiento inválido: %', p_type;
    END IF;
    IF p_type IN ('entrada','ajuste') AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Solo el administrador puede registrar entradas o ajustes de stock.';
    END IF;
    IF p_quantity IS NULL OR p_quantity < 0 OR (p_type <> 'ajuste' AND p_quantity = 0) THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a cero.';
    END IF;

    SELECT stock INTO v_before
      FROM public.inventory_consumables
     WHERE id = p_consumable_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Consumible no encontrado.';
    END IF;

    IF p_type = 'consumo' THEN
        IF p_quantity > v_before THEN
            RAISE EXCEPTION 'Stock insuficiente: solo quedan %.', trim_scale(v_before)::text;
        END IF;
        v_after := v_before - p_quantity;
    ELSIF p_type = 'entrada' THEN
        v_after := v_before + p_quantity;
    ELSE
        v_after := p_quantity;
    END IF;

    UPDATE public.inventory_consumables SET stock = v_after WHERE id = p_consumable_id;

    INSERT INTO public.inventory_consumable_movements
        (consumable_id, type, quantity, stock_before, stock_after, analyst_name, task_id, notes)
    VALUES
        (p_consumable_id, p_type, p_quantity, v_before, v_after,
         NULLIF(TRIM(p_analyst), ''), NULLIF(TRIM(p_task_id), ''), NULLIF(TRIM(p_notes), ''));

    PERFORM public.sync_consumable_alert(p_consumable_id);
    RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_consumable_movement(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- 5. Ejemplos (opcional, descomentar y ajustar) -------------------------------------------
-- INSERT INTO public.inventory_consumables (name, category, unit, stock, min_stock, reorder_qty) VALUES
--   ('Masa de balanceo 15 g', 'Balanceo',     'unidades', 15, 5, 10),
--   ('Loctite 330',           'Rotodinámico', 'unidades',  6, 2,  4),
--   ('Shims',                 'Alineación',   'unidades', 50, 15, 30);

-- Verificación:
-- SELECT * FROM public.inventory_consumables;
-- SELECT proname FROM pg_proc WHERE proname IN ('register_consumable_movement','sync_consumable_alert');
