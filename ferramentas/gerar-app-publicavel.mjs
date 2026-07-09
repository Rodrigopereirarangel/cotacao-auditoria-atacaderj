#!/usr/bin/env node
// =============================================================================
// gerar-app-publicavel.mjs — gera a cópia AUTOCONTIDA do app para publicar
// como artifact no claude.ai.
// -----------------------------------------------------------------------------
// PROBLEMA que isto resolve: o app-fonte carrega 3 recursos de CDN externo
// (xlsx-js-style, Tabler icons, fonte Inter). QUALQUER artifact do claude.ai
// bloqueia hosts externos por CSP — então o XLSX (usado p/ ler os relatórios
// e exportar o Excel da Auditoria) não carrega e quebra essas funções.
//
// Esta build produz `app/cotacao-auditoria-atacaderj.publicavel.html` 100%
// autocontido:
//   - XLSX (crítico): embutido inline a partir de node_modules (offline).
//   - Tabler icons (webfont): NÃO é usado no corpo do app → removido.
//   - Fonte Inter: a font-family já cai p/ "Segoe UI"/system-ui → CDN removido
//     (degrada p/ a fonte do sistema, visualmente quase idêntico no Windows).
// A única ref externa que PERMANECE é o proxy de IA do claude.ai
// (api.anthropic.com), que é o runtime do artifact — não é um CDN.
//
// Uso:  npm run publicavel   (ou: node ferramentas/gerar-app-publicavel.mjs)
// O arquivo .publicavel.html é derivado (gitignored); regenere quando o app
// mudar. Publique ELE (não o fonte) como artifact.
// =============================================================================
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'app/cotacao-auditoria-atacaderj.html';
const OUT = 'app/cotacao-auditoria-atacaderj.publicavel.html';
const XLSX = 'node_modules/xlsx-js-style/dist/xlsx.bundle.js';

let html = readFileSync(SRC, 'utf8');
const bundle = readFileSync(XLSX, 'utf8');

// segurança: um </script> dentro do JS embutido encerraria o <script> cedo.
// O bundle atual não tem, mas escapamos por garantia (válido em JS e HTML).
if (/<\/script/i.test(bundle)) {
  console.error('AVISO: bundle contém </script — escapando.');
}
const bundleSeguro = bundle.replace(/<\/script/gi, '<\\/script');

const linhaTabler = /^\s*<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/@tabler[^\n]*\n/m;
const linhaInter = /^\s*<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource[^\n]*\n/m;
const linhaXlsx = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/xlsx-js-style[^"]*"><\/script>/;

for (const [nome, re] of [['Tabler', linhaTabler], ['Inter', linhaInter], ['XLSX', linhaXlsx]]) {
  if (!re.test(html)) { console.error(`ERRO: não achei a linha de CDN do ${nome} em ${SRC}.`); process.exit(1); }
}

// IMPORTANTE: replacement por FUNÇÃO — o bundle minificado contém padrões
// $&, $' etc. que o replace-por-string interpretaria, reinserindo a linha CDN.
const inline = `<script>/* xlsx-js-style embutido (offline, CSP-safe) */\n${bundleSeguro}\n</script>`;
html = html
  .replace(linhaTabler, '')   // webfont não usada
  .replace(linhaInter, '')    // fonte cai p/ system-ui
  .replace(linhaXlsx, () => inline);

// verificação final: nenhuma ref de CDN jsdelivr pode sobrar
const refs = [...html.matchAll(/https?:\/\/cdn\.jsdelivr\.net[^\s"')]*/g)].map(m => m[0]);
if (refs.length) { console.error('ERRO: ainda há refs de CDN:', refs); process.exit(1); }

writeFileSync(OUT, html);
const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`OK ${OUT}`);
console.log(`   fonte ${kb(readFileSync(SRC).length)} + XLSX ${kb(bundle.length)} = ${kb(html.length)} autocontido`);
console.log('   0 refs de CDN externas (só o proxy de IA do claude.ai permanece).');
console.log('   → publique ESTE arquivo como artifact no claude.ai.');
