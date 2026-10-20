// ======================================================================================
// Motor de decisión: facturas del ERP → cambios en las gestiones del planner.
// Funciones PURAS (no consultan ni escriben nada): reciben datos y devuelven acciones.
//
// Reglas (opción A acordada):
//  - Solo se actúa sobre negocios que existan en el planner (campo tasks.negocio).
//  - Solo cuentan facturas de venta normales, validadas y ENVIADAS al cliente.
//  - Solo se pasa de 'ejecutada' a 'facturada'. Nunca se retrocede ni se toca otro estado.
//  - Negocio con UNA sola gestión: se factura y, si el valor difiere, se corrige al de la
//    factura (antes de IVA) siempre que la diferencia no supere AUTO_CORRECT_MAX_PCT.
//  - Negocio con VARIAS gestiones: solo se aplica si el total facturado coincide con la suma
//    de las gestiones ejecutadas/facturadas; si no coincide, queda "por revisar".
//  - Notas crédito, envío desconocido o diferencias grandes → "por revisar".
// ======================================================================================

function normNegocio(v) {
    return String(v || '').toUpperCase().replace(/\s+/g, '').trim();
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * @param {object} p
 * @param {Array}  p.invoices  [{ ref, negocio, total_ht, type, status, sent }]  sent: true | false | null (desconocido)
 * @param {Array}  p.tasks     [{ id, negocio, status, budget, client, service_type }]
 * @param {number} [p.tolerance=1]            diferencia máxima (pesos) para considerar que "coincide"
 * @param {number} [p.autoCorrectMaxPct=15]   % máximo de diferencia para corregir solo el valor (1 gestión)
 * @param {boolean} [p.requireSent=true]      exigir que la factura haya sido enviada al cliente
 * @returns {Array} acciones: { kind: 'apply' | 'review', negocio, invoice_refs, invoiced_total, task_ids, updates, reason, details }
 */
function planBilling({ invoices, tasks, tolerance = 1, autoCorrectMaxPct = 15, requireSent = true }) {
    const actions = [];

    // gestiones del planner por negocio
    const tasksByNeg = new Map();
    (tasks || []).forEach(t => {
        const n = normNegocio(t.negocio);
        if(!n) return;
        if(!tasksByNeg.has(n)) tasksByNeg.set(n, []);
        tasksByNeg.get(n).push(t);
    });

    // facturas del ERP por negocio (solo los que existen en el planner)
    const invByNeg = new Map();
    (invoices || []).forEach(inv => {
        const n = normNegocio(inv.negocio);
        if(!n || !tasksByNeg.has(n)) return;
        if(!invByNeg.has(n)) invByNeg.set(n, []);
        invByNeg.get(n).push(inv);
    });

    invByNeg.forEach((invs, negocio) => {
        const group = tasksByNeg.get(negocio);
        const executed = group.filter(t => t.status === 'ejecutada');
        if(!executed.length) return;   // nada pendiente de facturar en este negocio

        const base = { negocio, task_ids: executed.map(t => t.id) };
        const refsAll = invs.map(i => i.ref);

        // notas crédito / abonos: revisión humana
        const credit = invs.filter(i => Number(i.type) === 2 || num(i.total_ht) < 0);
        if(credit.length) {
            actions.push({ ...base, kind: 'review', invoice_refs: refsAll, invoiced_total: null, updates: [],
                reason: 'nota_credito', details: { credit_refs: credit.map(i => i.ref) } });
            return;
        }

        // solo facturas validadas (estado >= 1)
        const valid = invs.filter(i => Number(i.status) >= 1);
        if(!valid.length) return;       // borradores: aún no cuentan

        let eligible = valid;
        if(requireSent) {
            if(valid.some(i => i.sent === null || i.sent === undefined)) {
                actions.push({ ...base, kind: 'review', invoice_refs: valid.map(i => i.ref), invoiced_total: round2(valid.reduce((s, i) => s + num(i.total_ht), 0)),
                    updates: [], reason: 'envio_desconocido', details: { refs_sin_dato_de_envio: valid.filter(i => i.sent === null || i.sent === undefined).map(i => i.ref) } });
                return;
            }
            eligible = valid.filter(i => i.sent === true);
            if(!eligible.length) return;   // todavía no se envió al cliente
        }

        const invoiced = round2(eligible.reduce((s, i) => s + num(i.total_ht), 0));
        const refs = eligible.map(i => i.ref);
        const billedTasks = group.filter(t => t.status === 'facturada');
        const plannerTotal = round2([...executed, ...billedTasks].reduce((s, t) => s + num(t.budget), 0));

        if(group.length === 1) {
            const t = executed[0];
            const budget = num(t.budget);
            const diff = round2(invoiced - budget);
            if(Math.abs(diff) <= tolerance) {
                actions.push({ ...base, kind: 'apply', invoice_refs: refs, invoiced_total: invoiced,
                    updates: [{ task_id: t.id, old_budget: budget, new_budget: null }], reason: 'coincide', details: { diff } });
            } else if(budget > 0 && Math.abs(diff) / budget * 100 <= autoCorrectMaxPct) {
                actions.push({ ...base, kind: 'apply', invoice_refs: refs, invoiced_total: invoiced,
                    updates: [{ task_id: t.id, old_budget: budget, new_budget: invoiced }], reason: 'valor_corregido', details: { diff, pct: round2(Math.abs(diff) / budget * 100) } });
            } else {
                actions.push({ ...base, kind: 'review', invoice_refs: refs, invoiced_total: invoiced, updates: [],
                    reason: 'diferencia_mayor', details: { planner_total: budget, diff } });
            }
            return;
        }

        // varias gestiones: solo si el total coincide
        if(Math.abs(invoiced - plannerTotal) <= tolerance) {
            actions.push({ ...base, kind: 'apply', invoice_refs: refs, invoiced_total: invoiced,
                updates: executed.map(t => ({ task_id: t.id, old_budget: num(t.budget), new_budget: null })),
                reason: 'coincide_varias', details: { planner_total: plannerTotal, gestiones: group.length } });
        } else {
            actions.push({ ...base, kind: 'review', invoice_refs: refs, invoiced_total: invoiced, updates: [],
                reason: 'no_coincide_varias', details: { planner_total: plannerTotal, diff: round2(invoiced - plannerTotal), gestiones: group.length } });
        }
    });

    return actions;
}

/** Huella estable para no registrar dos veces lo mismo. */
function fingerprintOf(action, state) {
    const key = [action.negocio, [...action.invoice_refs].sort().join(','), [...action.task_ids].sort().join(','), state, action.invoiced_total ?? ''].join('|');
    let h = 5381;
    for(let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
    return `${action.negocio}:${state}:${(h >>> 0).toString(16)}`;
}

module.exports = { planBilling, normNegocio, fingerprintOf };
