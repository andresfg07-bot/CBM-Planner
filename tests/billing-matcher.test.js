// Ejecutar: node tests/billing-matcher.test.js
const assert = require('assert');
const { nameScore, tokens, candidateInvoices, planMatches } = require('../api/_lib/billing-matcher');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }
const task = (id, client, budget) => ({ id, client, budget });
const inv = (ref, total_ht, client_name) => ({ ref, total_ht, client_name, date: 1792386000 });

t('nombres: razón social completa vs nombre corto del planner', () => {
    assert.ok(nameScore(tokens('Inversiones Mineras Santa Ana'), tokens('INVERSIONES MINERAS SANTA ANA S.A.S')).ok);
});
t('nombres: empresas distintas no coinciden', () => {
    assert.ok(!nameScore(tokens('Ecopetrol'), tokens('INVERSIONES MINERAS SANTA ANA S.A.S')).ok);
});
t('una gestión del mismo cliente y valor → sugerencia alta', () => {
    const r = planMatches({ tasks: [task('a', 'Inversiones Mineras Santa Ana - Planta 1', 6100000)], invoices: [inv('FEV-1', 6100000, 'INVERSIONES MINERAS SANTA ANA S.A.S')] });
    assert.equal(r.length, 1); assert.equal(r[0].confidence, 'alta'); assert.equal(r[0].tasks[0].id, 'a');
});
t('varias gestiones del cliente que suman el valor de la factura', () => {
    const r = planMatches({ tasks: [task('a', 'CHEC - X', 3000000), task('b', 'CHEC - Y', 2000000), task('c', 'CHEC - Z', 9000000)], invoices: [inv('FEV-2', 5000000, 'CHEC')] });
    assert.equal(r.length, 1); assert.deepEqual(r[0].tasks.map(x => x.id).sort(), ['a', 'b']);
});
t('mismo valor pero otro cliente y no único → no sugiere', () => {
    const r = planMatches({ tasks: [task('a', 'Cliente Uno', 4000000), task('b', 'Cliente Dos', 4000000)], invoices: [inv('FEV-3', 4000000, 'OTRA EMPRESA SAS')] });
    assert.equal(r.length, 0);
});
t('nombre distinto pero valor único en ambos lados → sugerencia baja', () => {
    const r = planMatches({ tasks: [task('a', 'CHEC', 7234656)], invoices: [inv('FEV-4', 7234656, 'CENTRAL HIDROELECTRICA DE CALDAS S.A. E.S.P.')] });
    assert.equal(r.length, 1); assert.equal(r[0].confidence, 'baja');
});
t('dos gestiones del mismo cliente con el mismo valor → dos opciones para elegir', () => {
    const r = planMatches({ tasks: [task('a', 'Acme - P1', 1000000), task('b', 'Acme - P2', 1000000)], invoices: [inv('FEV-5', 1000000, 'ACME SAS')] });
    assert.equal(r.length, 2);
});
t('factura ya usada se excluye', () => {
    const r = planMatches({ tasks: [task('a', 'Acme', 1000000)], invoices: [inv('FEV-6', 1000000, 'ACME SAS')], excluded: new Set(['FEV-6']) });
    assert.equal(r.length, 0);
});
t('candidateInvoices filtra por valor', () => {
    const c = candidateInvoices([inv('X', 1000000, 'a'), inv('Y', 999, 'b')], [task('a', 'Acme', 1000000)]);
    assert.deepEqual(c.map(i => i.ref), ['X']);
});
console.log(`\n${n} pruebas OK`);
