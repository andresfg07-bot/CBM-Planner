// ======================================================================================
// Conciliador: propone qué factura del ERP corresponde a qué gestiones "ejecutadas" del planner,
// comparando CLIENTE (por parecido de nombre) y VALOR antes de IVA. Funciones puras.
// Nunca decide solo: devuelve sugerencias que una persona confirma en el planner.
// ======================================================================================

const STOP = new Set(['sas', 's', 'a', 'sa', 'ltda', 'y', 'e', 'de', 'del', 'la', 'el', 'los', 'las', 'cia', 'compania', 'sociedad',
    'por', 'acciones', 'simplificada', 'limitada', 'eu', 'u', 'en', 'liquidacion', 'ese', 'esp', 'sau', 'sca', 'bic', 'co', 'ltd', 'inc']);

function tokens(name) {
    return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 2 && !STOP.has(w));
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** Parecido entre dos nombres de empresa. */
function nameScore(a, b) {
    if(!a.length || !b.length) return { ok: false, jaccard: 0 };
    const setB = new Set(b);
    const inter = a.filter(w => setB.has(w)).length;
    const union = new Set([...a, ...b]).size;
    const jaccard = inter / union;
    return { ok: inter >= 1 && inter / Math.min(a.length, b.length) >= 0.8 && jaccard >= 0.5, jaccard };
}

function companyOf(client) { return String(client || '').split(' - ')[0].trim(); }

/** Subconjuntos (hasta 4 gestiones) cuya suma de valores coincide con el total; devuelve los de menor tamaño. */
function findSubsets(tasks, target, tol = 1) {
    const list = tasks.slice(0, 14);
    for(let size = 1; size <= 4; size++) {
        const found = [];
        const rec = (start, chosen, sum) => {
            if(found.length >= 5) return;
            if(chosen.length === size) { if(Math.abs(sum - target) <= tol) found.push([...chosen]); return; }
            for(let i = start; i < list.length; i++) { chosen.push(list[i]); rec(i + 1, chosen, sum + num(list[i].budget)); chosen.pop(); }
        };
        rec(0, [], 0);
        if(found.length) return found;
    }
    return [];
}

function groupByCompany(tasks) {
    const groups = new Map();
    tasks.filter(t => num(t.budget) > 0).forEach(t => {
        const name = companyOf(t.client);
        const key = tokens(name).join(' ') || name.toLowerCase();
        if(!groups.has(key)) groups.set(key, { name, tokens: tokens(name), tasks: [] });
        groups.get(key).tasks.push(t);
    });
    return [...groups.values()];
}

/** Facturas cuyo valor podría corresponder a alguna gestión: sirve para consultar solo los clientes necesarios. */
function candidateInvoices(invoices, tasks) {
    const groups = groupByCompany(tasks);
    const all = tasks.filter(t => num(t.budget) > 0);
    return invoices.filter(inv => {
        const total = num(inv.total_ht);
        if(total <= 0) return false;
        if(all.some(t => Math.abs(num(t.budget) - total) <= 1)) return true;
        return groups.some(g => g.tasks.length > 1 && findSubsets(g.tasks, total).length);
    });
}

/**
 * @param {Array} p.tasks      gestiones ejecutadas sin factura: { id, client, budget }
 * @param {Array} p.invoices   facturas con el nombre del cliente del ERP: { ref, total_ht, date, client_name }
 * @param {Set}   p.excluded   referencias de factura que ya se usaron
 */
function planMatches({ tasks, invoices, excluded = new Set() }) {
    const out = [];
    const groups = groupByCompany(tasks);
    const all = tasks.filter(t => num(t.budget) > 0);
    const countByTotal = new Map();
    invoices.forEach(i => { const k = Math.round(num(i.total_ht)); countByTotal.set(k, (countByTotal.get(k) || 0) + 1); });

    invoices.forEach(inv => {
        if(excluded.has(inv.ref)) return;
        const total = num(inv.total_ht);
        if(total <= 0) return;
        const invTokens = tokens(inv.client_name);
        let found = false;

        groups.forEach(g => {
            const sc = nameScore(g.tokens, invTokens);
            if(!sc.ok) return;
            findSubsets(g.tasks, total).forEach(sub => {
                found = true;
                out.push({ confidence: sc.jaccard >= 0.9 ? 'alta' : 'media', invoice_ref: inv.ref, invoice_total: total, invoice_date: inv.date || null,
                    erp_client: inv.client_name, planner_company: g.name,
                    tasks: sub.map(t => ({ id: t.id, client: t.client, budget: num(t.budget) })) });
            });
        });

        // Sin parecido de nombre (siglas, razón social distinta): solo si el valor es único en ambos lados
        if(!found && total >= 1000000 && countByTotal.get(Math.round(total)) === 1) {
            const cands = all.filter(t => Math.abs(num(t.budget) - total) <= 1);
            if(cands.length === 1) {
                out.push({ confidence: 'baja', invoice_ref: inv.ref, invoice_total: total, invoice_date: inv.date || null,
                    erp_client: inv.client_name, planner_company: companyOf(cands[0].client),
                    tasks: [{ id: cands[0].id, client: cands[0].client, budget: num(cands[0].budget) }] });
            }
        }
    });
    return out.slice(0, 60);
}

function matchFingerprint(s) {
    return `cruce:${s.invoice_ref}:${s.tasks.map(t => t.id).sort().join(',')}`;
}

module.exports = { tokens, nameScore, findSubsets, candidateInvoices, planMatches, matchFingerprint };
