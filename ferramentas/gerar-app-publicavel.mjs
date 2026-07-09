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
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'app/cotacao-auditoria-atacaderj.html';
const OUT = 'app/cotacao-auditoria-atacaderj.publicavel.html';
const XLSX_CDNJS = '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>';

let html = readFileSync(SRC, 'utf8');

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
  .replace(arrCatalog, () => 'const CATALOG=[];'); // catálogo vem do bridge/storage

// verificação: nada de jsdelivr pode sobrar (nem carregar recurso)
const refs = [...html.matchAll(/(?:src|href)="https:\/\/cdn\.jsdelivr\.net[^"]*"/g)].map(m => m[0]);
if (refs.length) { console.error('ERRO: ainda há refs de CDN jsdelivr:', refs); process.exit(1); }

writeFileSync(OUT, html);
const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`OK ${OUT} — ${kb(html.length)} (fonte ${kb(readFileSync(SRC).length)})`);
console.log('   XLSX via cdnjs (liberado) · CATALOG embutido removido (vem do bridge) · Tabler/Inter removidos');
console.log('   → publique ESTE arquivo como artifact no claude.ai (na SUA conta).');