// Smoke test do storage v2 por geracoes (envelope real + chave envenenada + commit atomico).
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('app/cotacao-auditoria-atacaderj.html', 'utf8');
let falhas = 0;
const assert = (c, m) => { if (!c) { falhas++; console.error('FALHOU:', m); } else { console.log('ok:', m); } };

const hoje = new Date();
const isoHoje = hoje.toISOString();
const catStr = JSON.stringify({
  produtos: Array.from({ length: 60 }, (_, i) => ({ c: i + 1, p: 'PRODUTO V2 ' + String(i + 1).padStart(3, '0'), q: 1, v: 2 + i })),
  data: hoje.toLocaleDateString('pt-BR'), gerado_em: isoHoje, origem: 'robo',
});
const pvStr = JSON.stringify({ gerado_em: isoHoje, janela_dias: 7, pedidos: [{ dia: isoHoje.slice(0, 10), ped: 1, itens: [[1, 'UN', 1, 9.9, 5]] }] });
const verStr = JSON.stringify({ gerado_em: isoHoje, origem: 'robo' });

const ops = [];
let envenenarPrimeiroBloco = null; // nome da 1a chave de bloco tentada apos armar
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.org/app.html',
  beforeParse(window) {
    window.storage = {
      _data: new Map(),
      async get(k, s) { ops.push(['get', k]); return { key: k, value: this._data.has(k) ? this._data.get(k) : null, shared: !!s }; },
      async set(k, v, s) {
        ops.push(['set', k]);
        if (envenenarPrimeiroBloco === true && k.startsWith('atacaderj_v2_d')) { envenenarPrimeiroBloco = k; throw new Error('Internal server error while processing action'); }
        if (envenenarPrimeiroBloco === k) throw new Error('Internal server error while processing action');
        this._data.set(k, v); return { key: k, value: v, shared: !!s };
      },
      async delete(k) { ops.push(['del', k]); this._data.delete(k); return {}; },
    };
    // estado pre-existente: geracao 100 publicada
    window.storage._data.set('atacaderj_v2_p', JSON.stringify({ g: 100, ver: JSON.parse(verStr) }));
    window.storage._data.set('atacaderj_v2_d100', JSON.stringify({ c: catStr, p: pvStr, v: verStr }));
  },
});
const { window } = dom;
await new Promise(r => setTimeout(r, 600));

// 1) boot semeia do v2
assert(window.eval('CATALOG.length') === 60 && window.eval("CATALOG.some(p=>p.p.startsWith('PRODUTO V2'))"), 'boot carregou catálogo do bloco v2 (geração 100)');
assert(window.eval('_catVersaoAplicada') === isoHoje, 'versão aplicada veio do ponteiro v2');

// 2) setItem legado NÃO vai à rede (só cache)
const setsAntes = ops.filter(o => o[0] === 'set' && o[1] === 'atacaderj_catalogo').length;
window.eval("_store.setItem('atacaderj_catalogo','xxx')");
await new Promise(r => setTimeout(r, 200));
assert(ops.filter(o => o[0] === 'set' && o[1] === 'atacaderj_catalogo').length === setsAntes, 'chave legada não gera escrita de rede (v2 gerencia)');

// 3) commit atômico: bloco antes, releitura, ponteiro por último
ops.length = 0;
const ok3 = await window.eval(`_v2Commit(${JSON.stringify(catStr)}, ${JSON.stringify(pvStr)}, ${JSON.stringify(verStr)})`);
assert(ok3 === true, '_v2Commit resolveu true');
const setsSeq = ops.filter(o => o[0] === 'set').map(o => o[1]);
const iBloco = setsSeq.findIndex(k => k.startsWith('atacaderj_v2_d'));
const iPonteiro = setsSeq.findIndex(k => k === 'atacaderj_v2_p');
assert(iBloco !== -1 && iPonteiro !== -1 && iBloco < iPonteiro, `bloco gravado ANTES do ponteiro (${setsSeq.join(' → ')})`);
const pont = JSON.parse(window.storage._data.get('atacaderj_v2_p'));
assert(window.storage._data.has('atacaderj_v2_d' + pont.g), 'ponteiro aponta para bloco existente');

// 4) chave de bloco envenenada → rotação de geração
envenenarPrimeiroBloco = true;
ops.length = 0;
const t0 = Date.now();
const ok4 = await window.eval(`_v2Commit(${JSON.stringify(catStr)}, ${JSON.stringify(pvStr)}, ${JSON.stringify(verStr)})`);
assert(ok4 === true, `commit sobreviveu a chave envenenada via rotação (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const pont2 = JSON.parse(window.storage._data.get('atacaderj_v2_p'));
assert('atacaderj_v2_d' + pont2.g !== envenenarPrimeiroBloco && window.storage._data.has('atacaderj_v2_d' + pont2.g), 'geração final abandonou a chave envenenada');
envenenarPrimeiroBloco = null;

// 5) polling detecta geração nova e aplica (carrinho vazio)
const iso2 = new Date(Date.now() + 60000).toISOString();
const cat2 = catStr.replace('PRODUTO V2', 'PRODUTO V3').replace(isoHoje, iso2);
window.storage._data.set('atacaderj_v2_d999', JSON.stringify({ c: cat2.replace(isoHoje, iso2), p: pvStr, v: verStr.replace(isoHoje, iso2) }));
window.storage._data.set('atacaderj_v2_p', JSON.stringify({ g: 999, ver: { gerado_em: iso2, origem: 'robo' } }));
await window._catVerificarAtualizacao();
assert(window.eval("CATALOG.some(p=>p.p.startsWith('PRODUTO V3'))"), 'polling aplicou a geração nova sozinho');

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
