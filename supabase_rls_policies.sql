-- ======================================================================================
-- POLÍTICAS DE SEGURIDAD RLS (Row Level Security) PARA MÚLTIPLES TABLAS EN SUPABASE
-- IMPORTANTE: Este script ya está configurado para: agonzalez@a-maq.com
-- Puedes agregar más administradores separándolos por comas, ej: IN ('agonzalez@a-maq.com', 'otro@amaq.com')
-- ======================================================================================

-- 1. Habilitar la seguridad RLS en todas las tablas
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_analyst_preferences ENABLE ROW LEVEL SECURITY;


-- ======================================================================================
-- 2. POLÍTICAS DE LECTURA (SELECT) 
-- Todo usuario que tenga cuenta e inicie sesión podrá visualizar los dashboards e información.
-- Los anónimos (sin sesión) serán rechazados por la DB automáticamente.
-- ======================================================================================
CREATE POLICY "Permitir lectura a usuarios autenticados (tasks)" 
ON public.tasks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir lectura a usuarios autenticados (clients)" 
ON public.clients FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir lectura a usuarios autenticados (analysts)" 
ON public.analysts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir lectura a usuarios autenticados (equipment)" 
ON public.equipment FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir lectura a usuarios autenticados (client_analyst_preferences)" 
ON public.client_analyst_preferences FOR SELECT TO authenticated USING (true);


-- ======================================================================================
-- 3. POLÍTICAS DE ESCRITURA (INSERT, UPDATE, DELETE)
-- Limitadas rígidamente solo a los usuarios autenticados cuyo correo (email) coincida.
-- ======================================================================================

-- === Tabla: tasks ===
CREATE POLICY "Permitir insert a admin (tasks)"
ON public.tasks FOR INSERT TO authenticated
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir update a admin (tasks)"
ON public.tasks FOR UPDATE TO authenticated
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'))
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir delete a admin (tasks)"
ON public.tasks FOR DELETE TO authenticated
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

-- Asistente (ypalacio@a-maq.com): puede actualizar gestiones del cliente METRO
-- Cubre: cambiar estado a 'facturada', registrar CSAT y editar valor presupuestal.
CREATE POLICY "Permitir update a asistente en tareas METRO (tasks)"
ON public.tasks FOR UPDATE TO authenticated
USING (
    auth.jwt() ->> 'email' = 'ypalacio@a-maq.com'
    AND client = 'METRO'
)
WITH CHECK (
    auth.jwt() ->> 'email' = 'ypalacio@a-maq.com'
    AND client = 'METRO'
);


-- === Tabla: clients ===
CREATE POLICY "Permitir insert a admin (clients)" 
ON public.clients FOR INSERT TO authenticated 
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir update a admin (clients)" 
ON public.clients FOR UPDATE TO authenticated 
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir delete a admin (clients)" 
ON public.clients FOR DELETE TO authenticated 
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));


-- === Tabla: analysts ===
CREATE POLICY "Permitir insert a admin (analysts)" 
ON public.analysts FOR INSERT TO authenticated 
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir update a admin (analysts)" 
ON public.analysts FOR UPDATE TO authenticated 
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir delete a admin (analysts)" 
ON public.analysts FOR DELETE TO authenticated 
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));


-- === Tabla: equipment ===
CREATE POLICY "Permitir insert a admin (equipment)" 
ON public.equipment FOR INSERT TO authenticated 
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir update a admin (equipment)" 
ON public.equipment FOR UPDATE TO authenticated 
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir delete a admin (equipment)" 
ON public.equipment FOR DELETE TO authenticated 
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));


-- === Tabla: client_analyst_preferences ===
CREATE POLICY "Permitir insert a admin (preferences)" 
ON public.client_analyst_preferences FOR INSERT TO authenticated 
WITH CHECK (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir update a admin (preferences)" 
ON public.client_analyst_preferences FOR UPDATE TO authenticated 
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));

CREATE POLICY "Permitir delete a admin (preferences)" 
ON public.client_analyst_preferences FOR DELETE TO authenticated 
USING (auth.jwt() ->> 'email' IN ('agonzalez@a-maq.com'));
