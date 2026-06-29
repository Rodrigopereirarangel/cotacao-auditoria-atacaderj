#!/usr/bin/env node
// ferramentas/validar-biblioteca.mjs
//
// Validador da BIBLIOTECA de aprendizado da Cotacao IA (Atacaderj).
//
// O app hoje guarda o aprendizado SO no localStorage do navegador (fragil:
// 1 dispositivo, sem versao, sem revisao). O plano de robustez exporta esse
// aprendizado para arquivos versionados no repositorio, dentro de biblioteca/:
//
//   biblioteca/apelidos.json   <- espelha atacaderj_apelidos  (_apelidos)
//   biblioteca/ausentes.json   <- espelha atacaderj_ausentes  (_catInteiroAusentes)
//   biblioteca/correcoes.jsonl <- log append-only de correcoes manuais (1 JSON por linha)
//   biblioteca/catalogo.json   <- OPCIONAL: lista de produtos {c,p,q,v,vu} (override do catalogo)
//
// Este script valida esses arquivos ANTES de cada merge, para que uma rodada
// nunca seja aberta em cima de uma biblioteca corrompida. Ele:
//   1) confere o SCHEMA de cada arquivo (formato exato que o app le/grava);
//   2) garante que NAO ha termo de apelido duplicado (chave repetida);
//   3) se houver catalogo.json, garante que NENHUM apelido aponta para
//      codigo de produto inexistente (apelido orfao);
//   4) valida correcoes.jsonl linha a linha (JSONL: cada linha e um objeto).
//
// Imprime um relatorio legivel e sai com codigo != 0 se houver QUALQUER
// inconsistencia, para o CI bloquear o merge.
//
// Uso:
//   node ferramentas/validar-biblioteca.mjs               (usa ./biblioteca)
//   node ferramentas/validar-biblioteca.mjs <dir>         (dir alternativo)
//   node ferramentas/validar-biblioteca.mjs --strict      (avisos viram erros)
//
// IMPORTANTE: este validador e ESTATICO. Nao chama a API da Anthropic, nao
// precisa de segredos e nao acessa a rede. Roda so sobre dados commitados.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Configuracao / argumentos
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const dirArg = args.find((a) => !a.startsWith('--'));
const BIBLIOTECA_DIR = resolve(dirArg || 'biblioteca');

const ARQ = {
  apelidos: join(BIBLIOTECA_DIR, 'apelidos.json'),
  ausentes: join(BIBLIOTECA_DIR, 'ausentes.json'),
  correcoes: join(BIBLIOTECA_DIR, 'correcoes.jsonl'),
  catalogo: join(BIBLIOTECA_DIR, 'catalogo.json'),
};

// ---------------------------------------------------------------------------
// Coletor de problemas
// ---------------------------------------------------------------------------
const erros = [];   // bloqueiam o merge (exit != 0)
const avisos = [];  // informativos; viram erro com --strict
const infos = [];   // estatisticas / contexto

const err = (msg) => erros.push(msg);
const warn = (msg) => avisos.push(msg);
const info = (msg) => infos.push(msg);

// ---------------------------------------------------------------------------
// Util: chaveBusca espelha a normalizacao do app
//   app: chaveBusca(t) = _fold(t.toLowerCase()).trim().replace(/\s+/g,' ')
//   _fold remove acentos (NFD + strip diacriticos). Reproduzimos o suficiente
//   para detectar termos que DEVERIAM ter sido normalizados antes de salvar.
// ---------------------------------------------------------------------------
function chaveBusca(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function lerJSON(caminho) {
  const raw = readFileSync(caminho, 'utf8');
  return JSON.parse(raw);
}

function ehInteiro(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

// ===========================================================================
// 1) catalogo.json (OPCIONAL) -> conjunto de codigos validos
//    Schema do app: { produtos:[{c,p,q,v,vu, custo?}], data }
//    c = codigo (inteiro), p = nome, v = preco. Usamos os codigos para
//    detectar apelidos orfaos.
// ===========================================================================
let codigosValidos = null; // Set<number> ou null se nao houver catalogo

function validarCatalogo() {
  if (!existsSync(ARQ.catalogo)) {
    info('catalogo.json ausente — validacao de apelidos orfaos sera PULADA (ok).');
    return;
  }
  let dados;
  try {
    dados = lerJSON(ARQ.catalogo);
  } catch (e) {
    err(`catalogo.json: JSON invalido — ${e.message}`);
    return;
  }
  if (!dados || typeof dados !== 'object' || !Array.isArray(dados.produtos)) {
    err('catalogo.json: esperado objeto com propriedade "produtos" (array).');
    return;
  }
  const codigos = new Set();
  const codigosDuplicados = new Set();
  dados.produtos.forEach((p, i) => {
    if (!p || typeof p !== 'object') {
      err(`catalogo.json: produtos[${i}] nao e um objeto.`);
      return;
    }
    if (!ehInteiro(p.c)) {
      err(`catalogo.json: produtos[${i}].c deve ser inteiro (codigo). Recebido: ${JSON.stringify(p.c)}`);
    } else {
      if (codigos.has(p.c)) codigosDuplicados.add(p.c);
      codigos.add(p.c);
    }
    if (typeof p.p !== 'string' || !p.p.trim()) {
      err(`catalogo.json: produtos[${i}].p (nome) deve ser string nao-vazia. Codigo ${p?.c}.`);
    }
    if (typeof p.v !== 'number' || !(p.v >= 0)) {
      err(`catalogo.json: produtos[${i}].v (preco) deve ser numero >= 0. Codigo ${p?.c}.`);
    }
  });
  if (codigosDuplicados.size) {
    err(`catalogo.json: codigos de produto duplicados: ${[...codigosDuplicados].join(', ')}`);
  }
  if (dados.data != null && typeof dados.data !== 'string') {
    warn('catalogo.json: campo "data" deveria ser string (ex: "29/06/2026").');
  }
  codigosValidos = codigos;
  info(`catalogo.json: ${codigos.size} codigos de produto carregados para checar apelidos.`);
}

// ===========================================================================
// 2) apelidos.json -> espelha atacaderj_apelidos
//    Schema do app: { entradas: [[termo, [cods...]], ...] }
//    (Map serializado via [...map.entries()]). Cap 400 no app.
//    Regras:
//      - termo: string normalizada (chaveBusca), nao-vazia, SEM duplicata;
//      - cods: array de inteiros, sem repeticao dentro da mesma entrada;
//      - se houver catalogo.json: todo cod deve existir (sem orfaos).
// ===========================================================================
function validarApelidos() {
  if (!existsSync(ARQ.apelidos)) {
    warn('apelidos.json ausente — nada de apelidos para validar (a biblioteca pode estar vazia).');
    return;
  }
  let dados;
  try {
    dados = lerJSON(ARQ.apelidos);
  } catch (e) {
    err(`apelidos.json: JSON invalido — ${e.message}`);
    return;
  }
  if (!dados || typeof dados !== 'object' || !Array.isArray(dados.entradas)) {
    err('apelidos.json: esperado objeto com propriedade "entradas" (array de pares [termo, [cods]]).');
    return;
  }

  const termosVistos = new Map(); // termoNormalizado -> primeiro indice
  let totalCods = 0;
  let orfaos = 0;

  dados.entradas.forEach((entrada, i) => {
    if (!Array.isArray(entrada) || entrada.length !== 2) {
      err(`apelidos.json: entradas[${i}] deve ser par [termo, [cods]]. Recebido: ${JSON.stringify(entrada)}`);
      return;
    }
    const [termo, cods] = entrada;

    // --- termo ---
    if (typeof termo !== 'string' || !termo.trim()) {
      err(`apelidos.json: entradas[${i}][0] (termo) deve ser string nao-vazia.`);
      return;
    }
    const norm = chaveBusca(termo);
    if (norm !== termo) {
      warn(`apelidos.json: termo "${termo}" nao esta normalizado (esperado "${norm}"). ` +
        `O app salva via chaveBusca(); termo fora do padrao nunca casa em runtime.`);
    }
    if (termosVistos.has(termo)) {
      err(`apelidos.json: termo DUPLICADO "${termo}" (entradas[${i}] e entradas[${termosVistos.get(termo)}]). ` +
        `Map nao pode ter chave repetida — funde os codigos numa unica entrada.`);
    } else {
      termosVistos.set(termo, i);
    }

    // --- cods ---
    if (!Array.isArray(cods) || cods.length === 0) {
      err(`apelidos.json: entradas[${i}][1] (cods de "${termo}") deve ser array nao-vazio de inteiros.`);
      return;
    }
    const dentro = new Set();
    cods.forEach((c) => {
      if (!ehInteiro(c)) {
        err(`apelidos.json: codigo invalido em "${termo}": ${JSON.stringify(c)} (esperado inteiro).`);
        return;
      }
      if (dentro.has(c)) {
        warn(`apelidos.json: codigo ${c} repetido dentro do termo "${termo}".`);
      }
      dentro.add(c);
      totalCods++;
      if (codigosValidos && !codigosValidos.has(c)) {
        err(`apelidos.json: APELIDO ORFAO — "${termo}" aponta para codigo ${c}, que nao existe no catalogo.json.`);
        orfaos++;
      }
    });
  });

  if (dados.entradas.length > 400) {
    warn(`apelidos.json: ${dados.entradas.length} entradas (> cap 400 do app). O app descarta as mais antigas ao salvar.`);
  }
  info(`apelidos.json: ${dados.entradas.length} termos, ${totalCods} ligacoes termo->codigo` +
    (codigosValidos ? `, ${orfaos} orfaos.` : ' (orfaos nao checados — sem catalogo).'));
}

// ===========================================================================
// 3) ausentes.json -> espelha atacaderj_ausentes
//    Schema do app: { versao, itens: [chaveBusca, ...] }
//    (itens sao chaves de busca que NEM o catalogo inteiro achou — as FALHAS
//     do fallback). Cap 300 no app.
//    Regras:
//      - versao: string (versaoCatalogo()), idealmente presente;
//      - itens: array de strings normalizadas, sem duplicata.
// ===========================================================================
function validarAusentes() {
  if (!existsSync(ARQ.ausentes)) {
    info('ausentes.json ausente — ok (nenhuma falha de fallback registrada).');
    return;
  }
  let dados;
  try {
    dados = lerJSON(ARQ.ausentes);
  } catch (e) {
    err(`ausentes.json: JSON invalido — ${e.message}`);
    return;
  }
  if (!dados || typeof dados !== 'object' || !Array.isArray(dados.itens)) {
    err('ausentes.json: esperado objeto com propriedade "itens" (array de chaves de busca).');
    return;
  }
  if (dados.versao != null && typeof dados.versao !== 'string') {
    err('ausentes.json: "versao" deve ser string (saida de versaoCatalogo()) ou ausente.');
  } else if (dados.versao == null) {
    warn('ausentes.json: sem "versao". O app casa ausentes por versao do catalogo; sem ela, sao ignorados em runtime.');
  }

  const vistos = new Set();
  dados.itens.forEach((it, i) => {
    if (typeof it !== 'string' || !it.trim()) {
      err(`ausentes.json: itens[${i}] deve ser string nao-vazia.`);
      return;
    }
    if (vistos.has(it)) {
      warn(`ausentes.json: chave ausente DUPLICADA "${it}" (a Set do app deduplica em runtime, mas o arquivo nao deveria repetir).`);
    }
    vistos.add(it);
    const norm = chaveBusca(it);
    if (norm !== it) {
      warn(`ausentes.json: chave "${it}" nao esta normalizada (esperado "${norm}").`);
    }
  });

  if (dados.itens.length > 300) {
    warn(`ausentes.json: ${dados.itens.length} itens (> cap 300 do app).`);
  }
  info(`ausentes.json: ${dados.itens.length} chaves de falha do fallback (versao ${dados.versao ?? 'n/d'}).`);
}

// ===========================================================================
// 4) correcoes.jsonl -> log append-only de correcoes manuais
//    JSONL: 1 objeto JSON por linha. Linhas em branco sao ignoradas.
//    Schema por linha (fonte da verdade: biblioteca/_SCHEMA.md):
//      { "termo": "<chaveBusca>", "codigo_errado": <int|null>, "codigo_certo": <int>, "data": "<ISO>" }
//    Cada linha e um par rotulado (errado -> certo): materia-prima da QUALIDADE.
//    Regras:
//      - cada linha nao-vazia deve ser JSON valido (objeto);
//      - termo string nao-vazia (idealmente ja normalizada por chaveBusca);
//      - codigo_certo inteiro OBRIGATORIO; codigo_errado inteiro OU null;
//      - se houver catalogo.json: codigo_certo deve existir (codigo_errado so avisa).
// ===========================================================================

function validarCorrecoes() {
  if (!existsSync(ARQ.correcoes)) {
    info('correcoes.jsonl ausente — ok (nenhuma correcao manual registrada).');
    return;
  }
  let raw;
  try {
    raw = readFileSync(ARQ.correcoes, 'utf8');
  } catch (e) {
    err(`correcoes.jsonl: nao foi possivel ler — ${e.message}`);
    return;
  }
  const linhas = raw.split(/\r?\n/);
  let validas = 0;
  let orfaos = 0;

  linhas.forEach((linha, idx) => {
    const n = idx + 1; // numero de linha humano
    if (linha.trim() === '') return; // linha em branco: ignora
    let obj;
    try {
      obj = JSON.parse(linha);
    } catch (e) {
      err(`correcoes.jsonl:${n}: JSON invalido — ${e.message}`);
      return;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      err(`correcoes.jsonl:${n}: cada linha deve ser um OBJETO JSON.`);
      return;
    }
    // termo
    if (typeof obj.termo !== 'string' || !obj.termo.trim()) {
      err(`correcoes.jsonl:${n}: "termo" deve ser string nao-vazia.`);
    } else {
      const norm = chaveBusca(obj.termo);
      if (norm !== obj.termo) {
        warn(`correcoes.jsonl:${n}: "termo" "${obj.termo}" nao esta normalizado (esperado "${norm}").`);
      }
    }
    // codigo_certo (obrigatorio, inteiro)
    if (!ehInteiro(obj.codigo_certo)) {
      err(`correcoes.jsonl:${n}: "codigo_certo" deve ser inteiro (o codigo correto escolhido pelo humano). Recebido: ${JSON.stringify(obj.codigo_certo)}`);
    } else if (codigosValidos && !codigosValidos.has(obj.codigo_certo)) {
      err(`correcoes.jsonl:${n}: "codigo_certo" ${obj.codigo_certo} nao existe no catalogo.json.`);
      orfaos++;
    }
    // codigo_errado (opcional: inteiro ou null)
    if (obj.codigo_errado != null) {
      if (!ehInteiro(obj.codigo_errado)) {
        err(`correcoes.jsonl:${n}: "codigo_errado" deve ser inteiro ou null. Recebido: ${JSON.stringify(obj.codigo_errado)}`);
      } else if (codigosValidos && !codigosValidos.has(obj.codigo_errado)) {
        warn(`correcoes.jsonl:${n}: "codigo_errado" ${obj.codigo_errado} nao existe no catalogo.json (ok se foi um match espurio).`);
      }
    }
    // data (opcional)
    if (obj.data != null && typeof obj.data !== 'string') {
      warn(`correcoes.jsonl:${n}: "data" deveria ser string ISO-8601.`);
    }
    validas++;
  });

  info(`correcoes.jsonl: ${validas} linhas validas` + (codigosValidos ? `, ${orfaos} com codigo orfao.` : '.'));
}

// ===========================================================================
// Execucao
// ===========================================================================
function main() {
  console.log('==========================================================');
  console.log(' Validacao da BIBLIOTECA de aprendizado — Cotacao IA');
  console.log('==========================================================');
  console.log(`Diretorio: ${BIBLIOTECA_DIR}`);
  console.log(`Modo:      ${STRICT ? 'STRICT (avisos = erros)' : 'normal'}`);
  console.log('');

  if (!existsSync(BIBLIOTECA_DIR)) {
    console.error(`ERRO: diretorio de biblioteca nao encontrado: ${BIBLIOTECA_DIR}`);
    console.error('Crie biblioteca/ (com apelidos.json/ausentes.json/correcoes.jsonl) ou passe o caminho como argumento.');
    process.exit(2);
  }

  // catalogo PRIMEIRO: alimenta o conjunto de codigos validos usado pelos demais.
  validarCatalogo();
  validarApelidos();
  validarAusentes();
  validarCorrecoes();

  // ----- Relatorio -----
  console.log('--- CONTEXTO ---');
  for (const m of infos) console.log('  i ' + m);
  console.log('');

  if (avisos.length) {
    console.log('--- AVISOS ---');
    for (const m of avisos) console.log('  ! ' + m);
    console.log('');
  }

  if (erros.length) {
    console.log('--- ERROS (bloqueiam o merge) ---');
    for (const m of erros) console.log('  X ' + m);
    console.log('');
  }

  const avisosViramErro = STRICT && avisos.length > 0;
  const ok = erros.length === 0 && !avisosViramErro;

  console.log('==========================================================');
  console.log(` Resultado: ${ok ? 'OK' : 'INCONSISTENTE'}  ` +
    `(${erros.length} erro(s), ${avisos.length} aviso(s))`);
  console.log('==========================================================');

  if (!ok) {
    process.exit(1);
  }
  process.exit(0);
}

main();
