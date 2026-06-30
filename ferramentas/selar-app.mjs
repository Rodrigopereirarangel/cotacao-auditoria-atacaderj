#!/usr/bin/env node
// =============================================================================
// selar-app.mjs — RE-SELA a trava de integridade do app de cotacao.
// -----------------------------------------------------------------------------
// O app (app/cotacao_ia_oficial.html) tem, perto do fim, um <script> anti-
// adulteracao que faz, em runtime no navegador:
//
//     const h  = sha256( document.getElementById('app-core').textContent )
//     const ok = ( h === '<HASH FIXO DE 64 HEX>' )   // senao -> "CODIGO ALTERADO"
//
// Quando `ok` e falso, o app mostra a faixa vermelha "CODIGO ALTERADO" e BLOQUEIA
// a cotacao. Como o LOOP de melhoria modifica o app a cada rodada, e qualquer
// mudanca DENTRO de #app-core altera esse hash, e obrigatorio RE-SELAR (atualizar
// a constante) depois de cada mudanca — senao o proprio app se auto-bloqueia.
//
// Este script reproduz EXATAMENTE o textContent que o navegador calcula, usando
// jsdom (o parser de HTML normaliza CRLF->LF, entao a quebra de linha do arquivo
// nao afeta o hash). A constante de verificacao fica FORA de #app-core, entao
// atualiza-la nao muda o conteudo medido (sem efeito chicken-and-egg).
//
// Uso:
//   node ferramentas/selar-app.mjs [caminho-do-app.html] [--check]
//     (sem args usa app/cotacao_ia_oficial.html)
//   --check : so REPORTA (selado? precisa re-selar?). NAO grava. Exit 1 se fora de sincronia.
//
// Requer jsdom:  rode "npm install" na raiz do repo uma vez.
// =============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const file = args.find((a) => !a.startsWith('--')) || 'app/cotacao_ia_oficial.html';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch (e) {
  console.error('ERRO: jsdom nao encontrado. Rode "npm install" na raiz do repo primeiro.');
  process.exit(2);
}

let html;
try {
  html = readFileSync(file, 'utf8');
} catch (e) {
  console.error(`ERRO: nao consegui ler ${file}: ${e.message}`);
  process.exit(2);
}

// 1) hash do textContent de #app-core, do MESMO jeito que o navegador faz
const dom = new JSDOM(html); // jsdom NAO executa scripts por padrao
const core = dom.window.document.getElementById('app-core');
if (!core) {
  console.error(`ERRO: elemento #app-core nao encontrado em ${file}.`);
  process.exit(2);
}
const hashNovo = createHash('sha256').update(core.textContent, 'utf8').digest('hex');

// 2) constante atual na verificacao:  h==='<64 hex>'
const RE = /(h===')([0-9a-f]{64})(')/;
const m = html.match(RE);
if (!m) {
  console.error("ERRO: nao achei a constante de verificacao (padrao h==='...64hex...') no app.");
  process.exit(2);
}
const hashAtual = m[2];
const selado = hashAtual === hashNovo;

console.log(`Arquivo:         ${file}`);
console.log(`Hash #app-core:  ${hashNovo}`);
console.log(`Constante atual: ${hashAtual}`);

if (selado) {
  console.log('Estado: OK — app ja esta SELADO (constante == hash). Nada a fazer.');
  process.exit(0);
}

if (CHECK) {
  console.log('Estado: DESSINCRONIZADO — o app se reconheceria como "CODIGO ALTERADO" e bloquearia.');
  console.log('Rode sem --check para RE-SELAR.');
  process.exit(1);
}

// 3) re-selar: substitui a constante pelo hash novo
const novoHtml = html.replace(RE, `$1${hashNovo}$3`);
writeFileSync(file, novoHtml);
console.log(`Estado: RE-SELADO — constante atualizada:`);
console.log(`  ${hashAtual}  ->  ${hashNovo}`);
console.log('O app volta a se reconhecer como "versao oficial Atacaderj".');
process.exit(0);
