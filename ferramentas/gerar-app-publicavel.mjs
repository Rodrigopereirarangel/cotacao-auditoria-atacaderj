#!/usr/bin/env node
// =============================================================================
// gerar-app-publicavel.mjs — gera a cópia AUTOCONTIDA/enxuta do app para
// publicar como artifact no claude.ai.
// -----------------------------------------------------------------------------
// FATOS (confirmados 2026-07-09):
//  - Artifacts do claude.ai bloqueiam `cdn.jsdelivr.net` mas LIBERAM
//    `cdnjs.cloudflare.com`. O app-fonte puxa xlsx/ícones/fonte de jsdelivr →
//    quebra (XLSX não carrega → falha ler relatório e exportar Excel).
//  - `xlsx-js-style` NÃO existe no cdnjs; só o `xlsx` comum (SheetJS). O comum
//    lê os relatórios e exporta Excel normalmente — só não aplica as CORES na
//    planilha exportada DENTRO do app (a planilha do WhatsApp continua colorida,
//    pois é gerada na ponte por ferramentas/auditoria-diaria.mjs).
//  - Um app grande não entra num artifact por colagem (limite de saída). Por
//    isso removemos o CATALOG embutido (~276KB): em produção o catálogo vem do
//    arquivo do bridge (botão 📦) / storage compartilhado, não do embutido.
//
// Resultado: `app/cotacao-auditoria-atacaderj.publicavel.html`, ~365KB,
// CSP-safe, publicável como artifact. Única ref externa: cdnjs (xlsx) + o
// proxy de IA do claude.ai (runtime do artifact).
//
// Uso:  npm run publicavel
// Derivado (gitignored). Publique ELE, não o fonte.
// =============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const SRC = 'app/cotacao-auditoria-atacaderj.html';
const OUT = 'app/cotacao-auditoria-atacaderj.publicavel.html';
const XLSX_CDNJS = '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>';
// BOOTSTRAP: o storage do claude.ai nasce VAZIO a cada artifact publicado (design
// deles, sem API para pre-encher). Para o link novo nao nascer "sem banco", o
// gerador embute o catalogo_bridge.json ATUAL (gz64) — o app usa esse banco
// embutido ate a primeira carga do robo, que dai assume. Se o arquivo da ponte
// nao existir nesta maquina, o publicavel sai sem bootstrap (comportamento antigo).
const BRIDGE_JSON = process.env.BRIDGE_JSON || 'C:/Users/User/erp-bridge-atacaderj/saida/cotacao/catalogo_bridge.json';

let html = readFileSync(SRC, 'utf8');

let bootstrap = 'const BOOTSTRAP_V2=null;';
let notaBootstrap = 'SEM bootstrap (catalogo_bridge.json não encontrado — nasce vazio até o robô)';
if (existsSync(BRIDGE_JSON)) {
  const o = JSON.parse(readFileSync(BRIDGE_JSON, 'utf8'));
  const m = String(o.gerado_em || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (o.origem === 'erp-bridge' && Array.isArray(o.produtos) && o.produtos.length > 50 && m) {
    const dataBr = `${m[3]}/${m[2]}/${m[1]}`;
    const produtos = o.produtos.slice().sort((a, b) => String(a.p).localeCompare(String(b.p), 'pt-BR'));
    const catStr = JSON.stringify({ produtos, data: dataBr, gerado_em: o.gerado_em, origem: 'publicacao' });
    // auditoria: só o dia anterior à geração (mesma regra do commit v2)
    let pvStr = null;
    const ontem = new Date(new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`).getTime() - 86400000);
    const diaOntem = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, '0')}-${String(ontem.getDate()).padStart(2, '0')}`;
    const peds = (o.pedidos_venda?.pedidos || []).filter(x => x && String(x.dia).slice(0, 10) === diaOntem && Array.isArray(x.itens) && x.itens.length);
    if (peds.length) pvStr = JSON.stringify({ gerado_em: o.gerado_em, janela_dias: 1, pedidos: peds });
    const verStr = JSON.stringify({ gerado_em: o.gerado_em, origem: 'publicacao' });
    const gz64 = (s) => 'gz64:' + gzipSync(Buffer.from(s, 'utf8')).toString('base64');
    bootstrap = `const BOOTSTRAP_V2={c:${JSON.stringify(gz64(catStr))},p:${pvStr ? JSON.stringify(gz64(pvStr)) : 'null'},v:${JSON.stringify(verStr)}};`;
    notaBootstrap = `bootstrap embutido: ${produtos.length.toLocaleString('pt-BR')} produtos de ${dataBr} + auditoria de ${diaOntem} (${peds.length} pedidos)`;
  }
}

const linhaTabler = /^\s*<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/@tabler[^\n]*\n/m;
const linhaInter = /^\s*<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource[^\n]*\n/m;
const linhaXlsx = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/xlsx-js-style[^"]*"><\/script>/;
const arrCatalog = /const CATALOG=\[.*?\}\];/s;

for (const [nome, re] of [['Tabler', linhaTabler], ['Inter', linhaInter], ['XLSX', linhaXlsx], ['CATALOG', arrCatalog]]) {
  if (!re.test(html)) { console.error(`ERRO: não achei a marca do ${nome} em ${SRC}.`); process.exit(1); }
}

html = html
  .replace(linhaTabler, '')                  // webfont não usada no corpo
  .replace(linhaInter, '')                   // fonte cai p/ Segoe UI/system-ui
  .replace(linhaXlsx, () => XLSX_CDNJS)      // jsdelivr(bloqueado) → cdnjs(liberado)
  .replace(arrCatalog, () => 'const CATALOG=[];' + bootstrap); // catálogo vem do storage/robô; bootstrap cobre o nascimento

// verificação: nada de jsdelivr pode sobrar (nem carregar recurso)
const refs = [...html.matchAll(/(?:src|href)="https:\/\/cdn\.jsdelivr\.net[^"]*"/g)].map(m => m[0]);
if (refs.length) { console.error('ERRO: ainda há refs de CDN jsdelivr:', refs); process.exit(1); }

writeFileSync(OUT, html);
const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`OK ${OUT} — ${kb(html.length)} (fonte ${kb(readFileSync(SRC).length)})`);
console.log('   XLSX via cdnjs (liberado) · Tabler/Inter removidos');
console.log('   ' + notaBootstrap);
console.log('   → publique ESTE arquivo como artifact no claude.ai (na SUA conta).');