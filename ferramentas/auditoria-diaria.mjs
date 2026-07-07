#!/usr/bin/env node
// =============================================================================
// auditoria-diaria.mjs — roda a Auditoria de Desconto de UM dia direto dos
// arquivos da ponte ERP (erp-bridge-atacaderj), sem upload manual.
// -----------------------------------------------------------------------------
// Fontes (geradas pela ponte no PC-ponte):
//   - pedidos_venda_dav.csv : itens dos pedidos de venda/DAV FECHADOS
//                             (dtAtendido) nos últimos 7 dias
//   - produtos.json         : catálogo (c, p, q, v=atacado, vu=varejo,
//                             vp=promoção, custo, cv=curva)
//
// Regras = as MESMAS do app (importa ferramentas/auditoria-calc.mjs).
// Preço de tabela base = o MENOR entre atacado / varejo / promoção
// (mesma regra da mesclagem do catálogo no app).
//
// Uso:
//   node ferramentas/auditoria-diaria.mjs [--dia YYYY-MM-DD] \
//        [--csv caminho.csv] [--catalogo produtos.json] [--outdir pasta]
//
// Saídas (em --outdir):
//   auditoria-YYYY-MM-DD.xlsx  (divergências por vendedor/cliente/pedido)
//   auditoria-YYYY-MM-DD.txt   (resumo p/ WhatsApp: vendedor + itens + R$)
// e o resumo também vai para o stdout.
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditarItens } from './auditoria-calc.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DEF_BRIDGE = 'C:/Users/User/erp-bridge-atacaderj/saida';

function arg(nome, def) {
  const i = process.argv.indexOf(nome);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DIA = arg('--dia', hojeLocal());
const CSV = arg('--csv', join(DEF_BRIDGE, 'cotacao', 'pedidos_venda_dav.csv'));
const CATALOGO = arg('--catalogo', join(DEF_BRIDGE, 'cotacao', 'produtos.json'));
const OUTDIR = arg('--outdir', join(DEF_BRIDGE, 'auditoria'));

// ---------- catálogo: base = MENOR entre atacado (v) / varejo (vu) / promo (vp)
const cat = JSON.parse(readFileSync(CATALOGO, 'utf8')).produtos;
const catMap = {};
for (const p of cat) {
  const candidatos = [p.v, p.vu, p.vp].filter((x) => typeof x === 'number' && x > 0);
  if (!candidatos.length) continue;
  catMap[p.c] = { v: Math.min(...candidatos), cv: p.cv };
}

// ---------- CSV da ponte -> itens no formato do app (val por volume, custo por UN)
function parseCsv(texto) {
  const linhas = texto.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const parse = (l) => {
    const cs = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ';') { cs.push(cur); cur = ''; }
      else cur += ch;
    }
    cs.push(cur); return cs;
  };
  const cab = parse(linhas[0]); const idx = {};
  cab.forEach((c, i) => { idx[c.trim()] = i; });
  return linhas.slice(1).map((l) => {
    const c = parse(l);
    const num = (s) => { const n = parseFloat(c[idx[s]]); return isNaN(n) ? null : n; };
    return {
      dia: (c[idx.emissao] || '').trim(),
      ped: parseInt(c[idx.pedido]), nota: c[idx.dav] || null,
      cli: (c[idx.cliente] || '').trim(), vend: (c[idx.vendedor] || '').trim() || '(sem vendedor)',
      cod: parseInt(c[idx.codigo]), prod: (c[idx.produto] || '').trim(),
      emb: (c[idx.emb] || 'UN').trim(),
      qt: num('qtde') || 0, val: num('valor'), custo: num('custo_un'),
    };
  });
}
const todos = parseCsv(readFileSync(CSV, 'utf8'));
const itens = todos.filter((x) => x.dia === DIA && Number.isInteger(x.cod));

const res = auditarItens(itens, catMap);
const div = res.divergencias;
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- resumo por vendedor
const porVend = {};
for (const d of div) {
  const v = d.vend || '(sem vendedor)';
  porVend[v] = porVend[v] || { itens: 0, impacto: 0 };
  porVend[v].itens++; porVend[v].impacto += d.impacto;
}
const impTot = div.reduce((s, d) => s + d.impacto, 0);
const pDia = DIA.split('-');
const diaBr = `${pDia[2]}/${pDia[1]}/${pDia[0]}`;
const linhas = [`🔍 Auditoria de desconto — ${diaBr}`,
  `Itens auditados: ${res.auditados} · Divergências: ${div.length} · Impacto total: ${fmt(impTot)}`];
if (div.length) {
  linhas.push('', 'Vendedores fora da regra (permitido vs realizado):');
  for (const [v, s] of Object.entries(porVend).sort((a, b) => b[1].impacto - a[1].impacto)) {
    linhas.push(`• ${v} — ${s.itens} item(ns) · ${fmt(s.impacto)}`);
  }
} else {
  linhas.push('', '✔ Nenhuma divergência. Todos os vendedores dentro da regra.');
}
if (res.semCadastro.length) linhas.push('', `(${res.semCadastro.length} item(ns) sem preço de tabela não avaliados)`);
const resumo = linhas.join('\n');

// ---------- xlsx (flat, agrupado por vendedor na ordenação)
let XLSX = null;
try { XLSX = (await import('xlsx-js-style')).default; } catch { /* opcional */ }
mkdirSync(OUTDIR, { recursive: true });
const base = join(OUTDIR, `auditoria-${DIA}`);
writeFileSync(base + '.txt', resumo, 'utf8');

let xlsxPath = null;
if (XLSX) {
  const cab = ['Vendedor', 'Cliente', 'Pedido', 'DAV', 'Cód', 'Produto', 'Emb', 'Qtd',
    'Tabela', 'Custo', 'Preço mín', 'Vendido/un', 'Desc.', 'Falta/un', 'Regra', 'Curva', 'Impacto'];
  const rows = div
    .sort((a, b) => (a.vend || '').localeCompare(b.vend || '') || (a.cli || '').localeCompare(b.cli || '') || a.ped - b.ped)
    .map((x) => [x.vend, x.cli, x.ped, x.nota || '', x.cod, x.prod, x.emb, x.qt,
      r2(x.base), r2(x.custo || 0), r2(x.precoMin), r2(x.unit),
      Math.round(x.descPrat * 1000) / 10 + '%', r2(x.falta), x.regra, x.A ? 'A' : '', r2(x.impacto)]);
  const resumoWs = [['Auditoria de desconto — ' + diaBr], [],
    ['Itens auditados', res.auditados], ['Divergências', div.length], ['Impacto total (R$)', r2(impTot)], [],
    ['Vendedor', 'Itens fora', 'Impacto (R$)'],
    ...Object.entries(porVend).sort((a, b) => b[1].impacto - a[1].impacto)
      .map(([v, s]) => [v, s.itens, r2(s.impacto)])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumoWs), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab, ...rows]), 'Divergências');
  xlsxPath = base + '.xlsx';
  XLSX.writeFile(wb, xlsxPath);
}

console.log(resumo);
console.error(`\n[auditoria-diaria] dia=${DIA} itens_csv=${itens.length} ` +
  `txt=${base + '.txt'}${xlsxPath ? ' xlsx=' + xlsxPath : ' (xlsx-js-style ausente — só txt)'}`);
