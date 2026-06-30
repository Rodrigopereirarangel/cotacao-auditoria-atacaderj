import assert from 'node:assert';
import { packsize, descMaxFrac, regraBind, auditarItens } from './auditoria-calc.mjs';

// packsize
assert.equal(packsize('FD 12'), 12);
assert.equal(packsize('CX24'), 24);
assert.equal(packsize('UN'), 1);
assert.equal(packsize(null), 1);

// descMaxFrac
assert.equal(descMaxFrac(10, 5, undefined), 0.05);   // teto demais 5%
assert.equal(descMaxFrac(10, 5, 'A'), 0.03);          // teto A 3%
assert.equal(descMaxFrac(10, null, undefined), 0);
assert.equal(descMaxFrac(10, 0, undefined), 0);
const d = descMaxFrac(10, 9.5, undefined);            // markup ~5.3% -> piso manda
assert.ok(d > 0 && d < 0.05);

// regraBind
assert.equal(regraBind(10, 5, undefined), 'teto 5%');
assert.equal(regraBind(10, 5, 'A'), 'teto 3%');
assert.equal(regraBind(10, 9.5, undefined), 'piso 10%');

// auditarItens
const catMap = {
  1: { v: 10, cv: undefined },   // teto 5% -> min 9.50
  2: { v: 10, cv: 'A' },         // teto 3% -> min 9.70
  3: { v: 20, cv: undefined },
};
const itens = [
  { cod: 1, qt: 3, val: 9.40, emb: 'UN', custo: 5 },   // 9.40 < 9.50 -> diverge
  { cod: 1, qt: 1, val: 9.50, emb: 'UN', custo: 5 },   // 9.50 == 9.50 -> NÃO diverge
  { cod: 2, qt: 2, val: 9.60, emb: 'UN', custo: 5 },   // 9.60 < 9.70 (curva A) -> diverge
  { cod: 3, qt: 2, val: 240, emb: 'FD 12', custo: 10 },// unit=240/12=20 == min(20) -> NÃO diverge
  { cod: 99, qt: 1, val: 5, emb: 'UN', custo: 1 },     // sem cadastro
  { cod: 1, qt: 0, val: 1, emb: 'UN', custo: 5 },      // qt 0 -> ignora
];
const r = auditarItens(itens, catMap);
assert.equal(r.auditados, 4);
assert.equal(r.divergencias.length, 2);
assert.equal(r.semCadastro.length, 1);
const d1 = r.divergencias.find(x => x.cod === 1);
assert.equal(d1.precoMin, 9.5);
assert.equal(d1.A, false);
assert.equal(Math.round(d1.falta * 100) / 100, 0.10);
// cod 1: base 10, custo 5 -> markup 100%, descMargem=0.45; como 0.45 > teto 0.05, prende no teto
assert.equal(d1.regra, 'teto 5%');
console.log('OK auditoria-calc');
