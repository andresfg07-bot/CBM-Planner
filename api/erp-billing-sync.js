// Sincroniza la facturación del ERP (solo lectura) con el planner.
// Llamada: POST desde el planner (JWT de admin/asistente) o GET desde un cron (Bearer CRON_SECRET).
// Modo 'prueba': solo registra lo que haría. Modo 'activo': pasa ejecutada → facturada.

const { fetchInvoices, erpPing, fetchThirdpartyName } = require('./_lib/dolibarr');
const { planBilling, fingerprintOf } = require('./_lib/billing-engine');
const { candidateInvoices, planMatches, matchFingerprint } = require('./_lib/billing-matcher');

const SB_URL = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sb(path, { method = 'GET', body, prefer } = {}) {
    const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
        method,
        headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    if(!res.ok) throw new Error(`Supabase ${res.status} en ${path}: ${await res.text()}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
}

async function authorize(req) {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if(process.env.CRON_SECRET && token === process.env.CRON_SECRET) return { who: 'cron' };
    if(!token) return { error: 'Falta la sesión (vuelve a iniciar sesión en el planner)' };
    const u = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: SB_KEY(), Authorization: `Bearer ${token}` } });
    if(!u.ok) return { error: 'Sesión no válida o SUPABASE_URL / clave de servicio incorrectas en Vercel' };
    const user = await u.json();
    const prof = await sb(`profiles?id=eq.${user.id}&select=role`);
    if(!prof?.[0]) return { error: 'No se pudo leer el perfil: SUPABASE_SERVICE_ROLE_KEY probablemente no es la clave service_role' };
    if(!['admin', 'assistant'].includes(prof[0].role)) return { error: `Tu rol (${prof[0].role}) no puede sincronizar` };
    return { who: user.email };
}

module.exports = async function handler(req, res) {
    try {
        if(!SB_URL() || !SB_KEY()) return res.status(500).json({ error: 'Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' });
        const caller = await authorize(req);
        if(caller.error) return res.status(401).json({ error: caller.error });

        const settings = (await sb('erp_sync_settings?id=eq.1&select=mode'))?.[0] || { mode: 'prueba' };
        const active = settings.mode === 'activo';

        const erpVersion = await erpPing();   // falla con un mensaje claro si la URL o la clave del ERP no sirven

        const [invoices, tasks] = await Promise.all([
            fetchInvoices(),
            sb('tasks?negocio=not.is.null&is_absence=eq.false&select=id,negocio,status,budget,client,service_type')
        ]);
        // Yoli envía la factura desde Siigo y después la registra en el ERP: una factura validada en el ERP ya cuenta como facturada.
        const actions = planBilling({ invoices, tasks, requireSent: false });
        const summary = { mode: settings.mode, erp: erpVersion, invoices: invoices.length, tasks_with_negocio: tasks.length, applied: 0, proposed: 0, review: 0, skipped: 0 };

        for(const a of actions) {
            const state = a.kind === 'review' ? 'por_revisar' : (active ? 'aplicado' : 'propuesto');
            const fingerprint = fingerprintOf(a, state);
            const existing = await sb(`erp_billing_log?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=id`);
            if(existing?.length) { summary.skipped++; continue; }

            if(state === 'aplicado') {
                const now = new Date().toISOString();
                for(const u of a.updates) {
                    const patch = { status: 'facturada' };
                    if(u.new_budget !== null) patch.budget = u.new_budget;
                    // condición status=ejecutada: nunca pisa una gestión que cambió entre la lectura y la escritura
                    await sb(`tasks?id=eq.${u.task_id}&status=eq.ejecutada`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
                    await sb(`notifications?type=in.(lista_facturar,gestion_ejecutada)&resolved_at=is.null&data->>task_id=eq.${u.task_id}`,
                        { method: 'PATCH', body: { resolved_at: now, read_at: now }, prefer: 'return=minimal' });
                }
            }
            await sb('erp_billing_log', { method: 'POST', prefer: 'return=minimal', body: {
                fingerprint, negocio: a.negocio, invoice_refs: a.invoice_refs, invoiced_total: a.invoiced_total,
                task_ids: a.task_ids, state, reason: a.reason, details: { ...a.details, updates: a.updates, by: caller.who }
            }});
            if(state === 'aplicado') summary.applied++; else if(state === 'propuesto') summary.proposed++; else summary.review++;
        }

        // ── Conciliador: facturas del mismo cliente y valor que gestiones ejecutadas (las confirma una persona) ──
        summary.suggested = 0;
        try {
            const handled = new Set(actions.flatMap(a => a.task_ids));
            const pending = (await sb('tasks?status=eq.ejecutada&is_absence=eq.false&erp_invoice_ref=is.null&select=id,client,budget'))
                .filter(t => !handled.has(t.id));
            const usedRows = await sb('erp_billing_log?state=in.(aplicado,confirmado)&select=invoice_refs');
            const excluded = new Set((usedRows || []).flatMap(r => r.invoice_refs || []));
            const billed = await sb('tasks?erp_invoice_ref=not.is.null&select=erp_invoice_ref');
            (billed || []).forEach(t => t.erp_invoice_ref.split(',').forEach(r => excluded.add(r.trim())));

            const candidates = candidateInvoices(
                invoices.filter(i => Number(i.status) >= 1 && Number(i.type) !== 2 && !excluded.has(i.ref)), pending);
            const socids = [...new Set(candidates.map(i => i.socid).filter(Boolean))].slice(0, 30);
            const names = {};
            await Promise.all(socids.map(async id => { try { names[id] = await fetchThirdpartyName(id); } catch(e) { names[id] = ''; } }));

            const suggestions = planMatches({ tasks: pending, invoices: candidates.map(i => ({ ...i, client_name: names[i.socid] || '' })), excluded });
            for(const s of suggestions) {
                const fingerprint = matchFingerprint(s);
                const existing = await sb(`erp_billing_log?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=id`);
                if(existing?.length) continue;
                await sb('erp_billing_log', { method: 'POST', prefer: 'return=minimal', body: {
                    fingerprint, negocio: 'CRUCE', invoice_refs: [s.invoice_ref], invoiced_total: s.invoice_total,
                    task_ids: s.tasks.map(t => t.id), state: 'sugerido', reason: 'posible_factura',
                    details: { confidence: s.confidence, erp_client: s.erp_client, planner_company: s.planner_company, invoice_date: s.invoice_date, tasks: s.tasks, by: caller.who }
                }});
                summary.suggested++;
            }
        } catch(e) {
            summary.matching_error = e.message;   // p. ej. falta ejecutar supabase_migration_erp_matching.sql
        }

        await sb('erp_sync_settings?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { last_run_at: new Date().toISOString(), last_result: summary } });
        return res.status(200).json(summary);
    } catch(e) {
        console.error('erp-billing-sync:', e);
        return res.status(500).json({ error: e.message });
    }
};
