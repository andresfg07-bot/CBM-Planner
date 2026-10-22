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

function extractNegocio(inv) {
    const extra = inv.array_options || {};
    const field = process.env.DOLIBARR_NEGOCIO_FIELD;
    const candidates = [
        field && extra[field],
        ...Object.values(extra),
        inv.ref_client, inv.ref_customer, inv.note_public, inv.note_private
    ];
    for(const c of candidates) {
        const m = NEGOCIO_RE.exec(String(c || ''));
        if(m) return 'N' + m[1];
    }
    return '';
}

/** true / false / null (desconocido). Hasta verificar el ERP, solo se usa un campo explícito si existe. */
function extractSent(inv) {
    const field = process.env.DOLIBARR_SENT_FIELD;
    if(field && inv.array_options && field in inv.array_options) {
        const v = inv.array_options[field];
        return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'si';
    }
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
