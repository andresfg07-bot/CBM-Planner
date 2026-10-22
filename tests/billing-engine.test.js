// Ejecutar: node tests/billing-engine.test.js
const assert = require('assert');
const { planBilling } = require('../api/_lib/billing-engine');

const inv = (o) => ({ ref: 'FA1', negocio: 'N1', total_ht: 1000, type: 0, status: 1, sent: true, ...o });
const task = (o) => ({ id: 't1', negocio: 'N1', status: 'ejecutada', budget: 1000, ...o });
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

t('1 gestión, valor igual → apply sin cambio de valor', () => {
    const a = planBilling({ invoices: [inv()], tasks: [task()] });
    assert.equal(a.length, 1); assert.equal(a[0].kind, 'apply'); assert.equal(a[0].updates[0].new_budget, null);
});
t('1 gestión, diferencia pequeña → corrige valor', () => {
    const a = planBilling({ invoices: [inv({ total_ht: 1050 })], tasks: [task()] });
    assert.equal(a[0].kind, 'apply'); assert.equal(a[0].updates[0].new_budget, 1050); assert.equal(a[0].reason, 'valor_corregido');
});
t('1 gestión, diferencia > 15% → por revisar', () => {
    const a = planBilling({ invoices: [inv({ total_ht: 2000 })], tasks: [task()] });
    assert.equal(a[0].kind, 'review'); assert.equal(a[0].reason, 'diferencia_mayor');
});
t('varias gestiones, total coincide → todas se facturan', () => {
    const a = planBilling({ invoices: [inv({ total_ht: 3000 })], tasks: [task({ id: 'a', budget: 1000 }), task({ id: 'b', budget: 1000 }), task({ id: 'c', budget: 1000 })] });
    assert.equal(a[0].kind, 'apply'); assert.equal(a[0].updates.length, 3);
});
t('varias gestiones, total no coincide → por revisar, sin cambios', () => {
    const a = planBilling({ invoices: [inv({ total_ht: 2500 })], tasks: [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })] });
    assert.equal(a[0].kind, 'review'); assert.equal(a[0].updates.length, 0);
});
t('factura no enviada → no hace nada', () => {
    assert.equal(planBilling({ invoices: [inv({ sent: false })], tasks: [task()] }).length, 0);
});
t('envío desconocido → por revisar', () => {
    assert.equal(planBilling({ invoices: [inv({ sent: null })], tasks: [task()] })[0].reason, 'envio_desconocido');
});
t('borrador → no hace nada', () => {
    assert.equal(planBilling({ invoices: [inv({ status: 0 })], tasks: [task()] }).length, 0);
});
t('nota crédito → por revisar', () => {
    assert.equal(planBilling({ invoices: [inv(), inv({ ref: 'NC1', type: 2, total_ht: -100 })], tasks: [task()] })[0].reason, 'nota_credito');
});
t('negocio que no está en el planner → se ignora', () => {
    assert.equal(planBilling({ invoices: [inv({ negocio: 'N9' })], tasks: [task()] }).length, 0);
});
t('gestión que no está ejecutada → no se toca', () => {
    assert.equal(planBilling({ invoices: [inv()], tasks: [task({ status: 'programada' })] }).length, 0);
});
t('negocio con espacios/minúsculas coincide', () => {
    assert.equal(planBilling({ invoices: [inv({ negocio: 'n 1' })], tasks: [task()] }).length, 1);
});
t('negocio numérico del ERP ("1") coincide con "N1" del planner', () => {
    assert.equal(planBilling({ invoices: [inv({ negocio: '1' })], tasks: [task({ negocio: 'N-1' })] }).length, 1);
});

const { extractNegocio, extractSent } = require('../api/_lib/dolibarr');
t('conector: negocio desde options_acrm_negocio', () => {
    assert.equal(extractNegocio({ array_options: { options_acrm_negocio: '3293' } }), 'N3293');
    assert.equal(extractNegocio({ array_options: { options_acrm_negocio: '' } }), '');
});
t('conector: envío por correo o acuse DIAN = enviada; sin rastro = desconocido', () => {
    assert.equal(extractSent({ email_sent_counter: '1', array_options: {} }), true);
    assert.equal(extractSent({ email_sent_counter: '0', array_options: { options_amaq_dian_acuse: 'x' } }), true);
    assert.equal(extractSent({ email_sent_counter: '0', array_options: { options_amaq_dian_acuse: '' } }), null);
});
console.log(`\n${n} pruebas OK`);
