// Teste do storage v2 por geracoes: DOIS blocos (banco + auditoria do dia anterior),
// ponteiro por ultimo, timeout de operacao, rotacao com chave envenenada e limpeza
// da geracao anterior. Simula a API real do claude.ai (envelope {key,value,shared}).
// Uso: node ferramentas/teste-storage-v2.mjs
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('app/cotacao-auditoria-atacaderj.html', 'utf8');
let falhas = 0;
const assert = (c, m) => { if (!c) { falhas++; console.error('FALHOU:', m); } else { console.log('ok:', m); } };

const agora = new Date();
const isoHoje = agora.toISOString();
const ontem = new Date(agora.getTime() - 86400000);
const diaOntem = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, '0')}-${String(ontem.getDate()).padStart(2, '0')}`;
const catStr = JSON.stringify({
  produtos: Array.from({ length: 60 }, (_, i) => ({ c: i + 1, p: 'PRODUTO V2 ' + String(i + 1).padStart(3, '0'), q: 1, v: 2 + i })),
  data: agora.toLocaleDateString('pt-BR'), gerado_em: isoHoje, origem: 'robo',
});
// pedidos de HOJE e de ONTEM — o commit do artifact deve levar SO os de ontem
const pvStr = JSON.stringify({ gerado_em: isoHoje, janela_dias: 7, pedidos: [
  { dia: isoHoje.slice(0, 10), ped: 1, itens: [[1, 'UN', 1, 9.9, 5]] },
  { dia: diaOntem, ped: 2, itens: [[2, 'UN', 2, 5.5, 3]] },
  { dia: diaOntem, ped: 3, itens: [[3, 'CX-12', 1, 60, 4]] },
] });
const verStr = JSON.stringify({ gerado_em: isoHoje, origem: 'robo' });

const ops = [];
let envenenarPrimeiroBanco = null;
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.org/app.html',
  beforeParse(window) {
    window.storage = {
      _data: new Map(),
      async get(k, s) { ops.push(['get', k]); return { key: k, value: this._data.has(k) ? this._data.get(k) : null, shared: !!s }; },
      async set(k, v, s) {
        ops.push(['set', k]);
        if (envenenarPrimeiroBanco === true && k.startsWith('atacaderj_v2_banco_')) { envenenarPrimeiroBanco = k; throw new Error('Internal server error'); }
        if (envenenarPrimeiroBanco === k) throw new Error('Internal server error');
        this._data.set(k, v); return { key: k, value: v, shared: !!s };
      },
      async delete(k) { ops.push(['del', k]); this._data.delete(k); return {}; },
    };
    // estado pre-existente: geracao 100/101 publicada
    window.storage._data.set('atacaderj_v2_p', JSON.stringify({ gb: 100, ga: 101, ver: JSON.parse(verStr) }));
    window.storage._data.set('atacaderj_v2_banco_100', catStr);
    window.storage._data.set('atacaderj_v2_aud_101', pvStr);
  },
});
const { window } = dom;
await new Promise(r => setTimeout(r, 600));

// 1) boot semeia dos dois blocos
assert(window.eval('CATALOG.length') === 60, 'boot carregou banco do bloco v2');
assert(window.eval("JSON.parse(_store._cache['atacaderj_pedidos_venda']).pedidos.length") === 3, 'boot carregou bloco da auditoria');
assert(window.eval('_catVersaoAplicada') === isoHoje, 'versão aplicada veio do ponteiro');

// 2) commit do cache: banco integral + auditoria SÓ do dia anterior + ponteiro por último + limpeza
window.eval(`_store._cache['atacaderj_pedidos_venda']=${JSON.stringify(pvStr)};_store._cache['atacaderj_catalogo']=${JSON.stringify(catStr)};_store._cache['atacaderj_catalogo_versao']=${JSON.stringify(verStr)};`);
ops.length = 0;
const ok2 = await window.eval('_v2CommitDoCache()');
assert(ok2 === true, '_v2CommitDoCache resolveu true');
const sets = ops.filter(o => o[0] === 'set').map(o => o[1]);
const iBanco = sets.findIndex(k => k.startsWith('atacaderj_v2_banco_'));
const iAud = sets.findIndex(k => k.startsWith('atacaderj_v2_aud_'));
const iPont = sets.findIndex(k => k === 'atacaderj_v2_p');
assert(iBanco !== -1 && iAud !== -1 && iPont !== -1 && iBanco < iPont && iAud < iPont, `blocos antes do ponteiro (${sets.join(' → ')})`);
const pont = JSON.parse(window.storage._data.get('atacaderj_v2_p'));
const audGravada = JSON.parse(window.storage._data.get('atacaderj_v2_aud_' + pont.ga));
assert(audGravada.pedidos.length === 2 && audGravada.pedidos.every(x => x.dia === diaOntem), 'bloco da auditoria levou SÓ o dia anterior (2 de 3 pedidos)');
assert(audGravada.janela_dias === 1, 'janela da auditoria virou 1 dia');
assert(!window.storage._data.has('atacaderj_v2_banco_100') && !window.storage._data.has('atacaderj_v2_aud_101'), 'gerações anteriores APAGADAS (sempre sobrescreve o antigo)');

// 3) chave de banco envenenada → rotação de geração
envenenarPrimeiroBanco = true;
const ok3 = await window.eval('_v2CommitDoCache()');
assert(ok3 === true, 'commit sobreviveu a chave envenenada via rotação');
const pont3 = JSON.parse(window.storage._data.get('atacaderj_v2_p'));
assert('atacaderj_v2_banco_' + pont3.gb !== envenenarPrimeiroBanco && window.storage._data.has('atacaderj_v2_banco_' + pont3.gb), 'geração final abandonou a chave envenenada');
envenenarPrimeiroBanco = null;

// 4) operação CONGELADA → timeout vira falha (não trava a fila para sempre)
const t4 = await window.eval(`(async()=>{try{await _v2Op(()=>new Promise(()=>{}),1500);return 'nao estourou';}catch(e){return String(e).includes('timeout')?'timeout ok':'erro estranho: '+e;}})()`);
assert(t4 === 'timeout ok', 'operação congelada estoura por timeout (' + t4 + ')');

// 5) polling aplica geração nova
const iso2 = new Date(Date.now() + 60000).toISOString();
window.storage._data.set('atacaderj_v2_banco_999', catStr.replace(/PRODUTO V2/g, 'PRODUTO V3'));
window.storage._data.set('atacaderj_v2_p', JSON.stringify({ gb: 999, ga: null, ver: { gerado_em: iso2, origem: 'robo' } }));
await window._catVerificarAtualizacao();
assert(window.eval("CATALOG.some(p=>p.p.startsWith('PRODUTO V3'))"), 'polling aplicou a geração nova sozinho');

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
