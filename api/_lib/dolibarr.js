// ======================================================================================
// Conector de SOLO LECTURA con el ERP (Dolibarr). Solo existe la función GET: no hay forma
// de enviar POST/PUT/DELETE al ERP desde este módulo.
//
// PENDIENTE DE VERIFICAR con respuestas reales del ERP personalizado:
//   - dónde vive el N° de negocio (ref_client, proyecto, campo extra, notas…)
//   - cómo se registra que la factura fue enviada al cliente
// Variables de entorno: DOLIBARR_URL, DOLIBARR_API_KEY (usuario de solo lectura),
// opcionales: DOLIBARR_NEGOCIO_FIELD (nombre del campo extra), DOLIBARR_SENT_FIELD.
// ======================================================================================

const NEGOCIO_RE = /\bN\s?-?(\d{3,6})\b/i;

async function erpGet(path, params = {}) {
    const base = (process.env.DOLIBARR_URL || '').replace(/\/+$/, '');
    const key = process.env.DOLIBARR_API_KEY;
    if(!base || !key) throw new Error('Falta configurar DOLIBARR_URL / DOLIBARR_API_KEY');
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${base}/api/index.php${path}${qs ? '?' + qs : ''}`, {
        method: 'GET',                                   // única operación permitida
        headers: { DOLAPIKEY: key, Accept: 'application/json' }
    });
    if(res.status === 404) return [];                    // Dolibarr responde 404 cuando la lista está vacía
    if(!res.ok) throw new Error(`ERP respondió ${res.status} en ${path}`);
    return res.json();
}

/** Comprueba que la URL y la clave del ERP sean válidas (a diferencia de las listas, aquí un 404 es un error). */
async function erpPing() {
    const base = (process.env.DOLIBARR_URL || '').replace(/\/+$/, '');
    const key = process.env.DOLIBARR_API_KEY;
    if(!base || !key) throw new Error('Falta configurar DOLIBARR_URL / DOLIBARR_API_KEY');
    const res = await fetch(`${base}/api/index.php/status`, { method: 'GET', headers: { DOLAPIKEY: key, Accept: 'application/json' } });
    if(res.status === 401 || res.status === 403) throw new Error('El ERP rechazó la clave de API');
    if(!res.ok) throw new Error(`No se pudo conectar con el ERP (respuesta ${res.status}); revisa DOLIBARR_URL y que el módulo API REST esté activo`);
    const j = await res.json().catch(() => ({}));
    return j?.success?.dolibarr_version || 'ok';
}

/** El ERP guarda el negocio como número en el campo extra "acrm_negocio" (ej. "3293"); el planner lo escribe N3293. */
function extractNegocio(inv) {
    const extra = inv.array_options || {};
    const field = process.env.DOLIBARR_NEGOCIO_FIELD || 'options_acrm_negocio';
    const direct = String(extra[field] ?? '').trim();
    if(/^\d{1,7}$/.test(direct)) return 'N' + direct;
    const m = NEGOCIO_RE.exec(direct);
    return m ? 'N' + m[1] : '';
}

/**
 * true / false / null (desconocido). Una factura cuenta como enviada si el ERP registró un envío por correo
 * (email_sent_counter) o si hay acuse/recibo de la DIAN. Si no hay rastro, queda desconocido (null) para que
 * la revise una persona, en vez de asumir que no se envió.
 */
function extractSent(inv) {
    const extra = inv.array_options || {};
    if(Number(inv.email_sent_counter) > 0) return true;
    if(String(extra.options_amaq_dian_acuse || '').trim() || String(extra.options_amaq_dian_recibo || '').trim()) return true;
    return null;
}

/** Facturas de venta recientes, ya en la forma que espera el motor. */
async function fetchInvoices({ limit = 100, pages = 5 } = {}) {
    const out = [];
    for(let page = 0; page < pages; page++) {
        const rows = await erpGet('/invoices', { sortfield: 't.rowid', sortorder: 'DESC', limit, page });
        if(!Array.isArray(rows) || !rows.length) break;
        rows.forEach(r => out.push({
            ref: r.ref,
            negocio: extractNegocio(r),
            total_ht: Number(r.total_ht),
            type: Number(r.type),
            status: Number(r.status ?? r.statut),
            sent: extractSent(r)
        }));
        if(rows.length < limit) break;
    }
    return out;
}

module.exports = { erpGet, erpPing, fetchInvoices, extractNegocio, extractSent };
