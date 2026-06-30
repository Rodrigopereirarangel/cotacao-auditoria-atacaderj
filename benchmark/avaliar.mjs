#!/usr/bin/env node
// =============================================================================
// avaliar.mjs — Avaliador / gate de nao-regressao dos 3 eixos (Atacaderj IA)
// -----------------------------------------------------------------------------
// NAO chama a API. Recebe os resultados ja prontos e:
//   1) calcula precisao/recall/F1 contra o golden-set (QUALIDADE);
//   2) compara metricas_rodada x metricas_baseline (VELOCIDADE e TOKENS);
//   3) imprime um VEREDITO por eixo.
// Sai com codigo 1 se QUALQUER eixo regrediu alem da tolerancia. Senao, 0.
//
// Uso:
//   node benchmark/avaliar.mjs entrada.json [--golden golden-set.jsonl] [flags]
//
// entrada.json:
//   {
//     previstos:  [{ pedido, codigos:[...] }],
//     esperados:  [{ pedido, codigos_esperados:[...], observacao }],  // opcional se --golden
//     metricas_rodada:   { requisicoes, tokens_total, cache_hit_ratio, latencia_p95_ms, ... },
//     metricas_baseline: { ...mesmos campos... },
//     qualidade_baseline:{ f1_micro }   // opcional; senao usa --f1-baseline ou pula gate de qualidade
//   }
//
// Flags (tolerancias; defaults sao conservadores p/ absorver ruido):
//   --golden <arquivo.jsonl>   carrega o gabarito do golden-set
//   --f1-baseline <0..1>       F1 micro do baseline (se nao vier no JSON)
//   --tol-qual <pp>            queda de F1 toleravel em pontos percentuais (default 0.5)
//   --tol-tokens <pct>         aumento de tokens toleravel em % (default 2)
//   --tol-cache <pp>           queda de cache_hit toleravel em pp (default 1)
//   --tol-p95 <pct>            aumento de latencia p95 toleravel em % (default 10)
//   --json                    imprime tambem um resumo JSON no final
//   --help
// =============================================================================

import { readFileSync } from 'node:fs';

// ----------------------------- args -----------------------------------------
function parseArgs(argv) {
  const a = { _: [], tol: { qual: 0.5, tokens: 2, cache: 1, p95: 10 } };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--help' || t === '-h') a.help = true;
    else if (t === '--json') a.json = true;
    else if (t === '--golden') a.golden = argv[++i];
    else if (t === '--f1-baseline') a.f1Baseline = parseFloat(argv[++i]);
    else if (t === '--tol-qual') a.tol.qual = parseFloat(argv[++i]);
    else if (t === '--tol-tokens') a.tol.tokens = parseFloat(argv[++i]);
    else if (t === '--tol-cache') a.tol.cache = parseFloat(argv[++i]);
    else if (t === '--tol-p95') a.tol.p95 = parseFloat(argv[++i]);
    else a._.push(t);
  }
  return a;
}

const HELP = `avaliar.mjs — gate de nao-regressao dos 3 eixos

Uso:
  node benchmark/avaliar.mjs entrada.json [--golden golden-set.jsonl] [flags]

Flags:
  --golden <arquivo>     carrega codigos_esperados do golden-set (.jsonl)
  --f1-baseline <0..1>   F1 micro do baseline, se nao estiver no JSON
  --tol-qual <pp>        queda de F1 toleravel (default 0.5 pp)
  --tol-tokens <pct>     aumento de tokens toleravel (default 2%)
  --tol-cache <pp>       queda de cache_hit toleravel (default 1 pp)
  --tol-p95 <pct>        aumento de p95 toleravel (default 10%)
  --json                 imprime resumo JSON ao final

Exit: 0 = aprovado | 1 = regrediu | 2 = erro de uso/entrada
`;

// ----------------------------- helpers --------------------------------------
function die(msg, code = 2) { console.error('ERRO: ' + msg); process.exit(code); }

function lerJSON(caminho) {
  try { return JSON.parse(readFileSync(caminho, 'utf8')); }
  catch (e) { die(`nao consegui ler/parsear ${caminho}: ${e.message}`); }
}

function lerGoldenJSONL(caminho) {
  let txt;
  try { txt = readFileSync(caminho, 'utf8'); }
  catch (e) { die(`nao consegui ler golden-set ${caminho}: ${e.message}`); }
  const out = [];
  txt.split(/\r?\n/).forEach((linha, i) => {
    const s = linha.trim();
    if (!s) return;
    try {
      const o = JSON.parse(s);
      out.push({
        pedido: String(o.pedido || '').trim(),
        codigos_esperados: Array.isArray(o.codigos_esperados) ? o.codigos_esperados : [],
        observacao: o.observacao || ''
      });
    } catch (e) { die(`linha ${i + 1} do golden-set nao e JSON valido: ${e.message}`); }
  });
  return out;
}

function normChave(s) { return String(s || '').toLowerCase().trim().replace(/\s+/g, ' '); }
function setDe(arr) { return new Set((arr || []).map(x => String(x))); }
function intersecao(a, b) { let n = 0; for (const x of a) if (b.has(x)) n++; return n; }
function pct(x) { return (x * 100).toFixed(1) + '%'; }
function f2(x) { return (x == null || Number.isNaN(x)) ? 'n/d' : (+x).toFixed(2); }

// ----------------------------- qualidade ------------------------------------
function avaliarQualidade(previstos, esperados) {
  // indexa previstos por pedido normalizado
  const mapPrev = new Map();
  for (const p of (previstos || [])) mapPrev.set(normChave(p.pedido), setDe(p.codigos));

  let TP = 0, somaPrev = 0, somaEsp = 0; // para micro-media
  let somaF1 = 0, nComGabarito = 0;       // para macro-media
  const porPedido = [];

  for (const g of esperados) {
    const E = setDe(g.codigos_esperados);
    const semGabarito = E.size === 0;
    const P = mapPrev.has(normChave(g.pedido)) ? mapPrev.get(normChave(g.pedido)) : new Set();

    if (semGabarito) {
      porPedido.push({ pedido: g.pedido, semGabarito: true, previstos: P.size,
                       precisao: null, recall: null, f1: null, observacao: g.observacao });
      continue;
    }
    const acertos = intersecao(P, E);
    const precisao = P.size ? acertos / P.size : 0;
    const recall = E.size ? acertos / E.size : 0;
    const f1 = (precisao + recall) ? (2 * precisao * recall) / (precisao + recall) : 0;

    TP += acertos; somaPrev += P.size; somaEsp += E.size;
    somaF1 += f1; nComGabarito++;
    porPedido.push({ pedido: g.pedido, semGabarito: false, acertos,
                     previstos: P.size, esperados: E.size,
                     precisao, recall, f1, observacao: g.observacao });
  }

  const precisaoMicro = somaPrev ? TP / somaPrev : 0;
  const recallMicro = somaEsp ? TP / somaEsp : 0;
  const f1Micro = (precisaoMicro + recallMicro)
    ? (2 * precisaoMicro * recallMicro) / (precisaoMicro + recallMicro) : 0;
  const f1Macro = nComGabarito ? somaF1 / nComGabarito : 0;

  return { porPedido, precisaoMicro, recallMicro, f1Micro, f1Macro,
           nComGabarito, semGabarito: porPedido.filter(p => p.semGabarito).length };
}

// ----------------------------- veredito -------------------------------------
function veredito(rodada, baseline, qual, qualBaseF1, tol) {
  const linhas = [];
  let reprovou = false;
  const R = rodada || {}, B = baseline || {};

  // --- QUALIDADE ---
  if (qualBaseF1 == null) {
    linhas.push(['QUALIDADE', 'PULADO',
      `F1 micro rodada=${f2(qual.f1Micro)} (sem baseline de qualidade; passe --f1-baseline ou qualidade_baseline)`]);
  } else {
    const quedaPP = (qualBaseF1 - qual.f1Micro) * 100;
    const ok = quedaPP <= tol.qual;
    if (!ok) reprovou = true;
    linhas.push(['QUALIDADE', ok ? 'OK' : 'REGREDIU',
      `F1 micro ${f2(qual.f1Micro)} vs baseline ${f2(qualBaseF1)} ` +
      `(delta ${(quedaPP <= 0 ? '+' : '-')}${Math.abs(quedaPP).toFixed(1)} pp; tol ${tol.qual} pp)`]);
  }

  // --- TOKENS ---
  if (R.tokens_total == null || B.tokens_total == null) {
    linhas.push(['TOKENS', 'PULADO', 'falta tokens_total em rodada ou baseline']);
  } else {
    const aumentoPct = B.tokens_total ? ((R.tokens_total - B.tokens_total) / B.tokens_total) * 100 : 0;
    const ok = aumentoPct <= tol.tokens;
    if (!ok) reprovou = true;
    linhas.push(['TOKENS', ok ? 'OK' : 'REGREDIU',
      `total ${R.tokens_total} vs baseline ${B.tokens_total} ` +
      `(${aumentoPct >= 0 ? '+' : ''}${aumentoPct.toFixed(1)}%; tol +${tol.tokens}%)`]);
  }

  // --- VELOCIDADE: requisicoes (principal) ---
  if (R.requisicoes == null || B.requisicoes == null) {
    linhas.push(['VELOCIDADE/req', 'PULADO', 'falta requisicoes em rodada ou baseline']);
  } else {
    const ok = R.requisicoes <= B.requisicoes; // qualquer requisicao a mais reprova
    if (!ok) reprovou = true;
    linhas.push(['VELOCIDADE/req', ok ? 'OK' : 'REGREDIU',
      `requisicoes ${R.requisicoes} vs baseline ${B.requisicoes} (${R.requisicoes - B.requisicoes >= 0 ? '+' : ''}${R.requisicoes - B.requisicoes})`]);
  }

  // --- VELOCIDADE: cache_hit_ratio (secundario) ---
  if (R.cache_hit_ratio != null && B.cache_hit_ratio != null) {
    const quedaPP = (B.cache_hit_ratio - R.cache_hit_ratio) * 100;
    const ok = quedaPP <= tol.cache;
    if (!ok) reprovou = true;
    linhas.push(['VELOCIDADE/cache', ok ? 'OK' : 'REGREDIU',
      `cache_hit ${pct(R.cache_hit_ratio)} vs baseline ${pct(B.cache_hit_ratio)} ` +
      `(${(quedaPP <= 0 ? '+' : '-')}${Math.abs(quedaPP).toFixed(1)} pp; tol ${tol.cache} pp)`]);
  }

  // --- VELOCIDADE: latencia p95 (secundario) ---
  if (R.latencia_p95_ms != null && B.latencia_p95_ms != null) {
    const aumentoPct = B.latencia_p95_ms ? ((R.latencia_p95_ms - B.latencia_p95_ms) / B.latencia_p95_ms) * 100 : 0;
    const ok = aumentoPct <= tol.p95;
    if (!ok) reprovou = true;
    linhas.push(['VELOCIDADE/p95', ok ? 'OK' : 'REGREDIU',
      `p95 ${R.latencia_p95_ms}ms vs baseline ${B.latencia_p95_ms}ms ` +
      `(${aumentoPct >= 0 ? '+' : ''}${aumentoPct.toFixed(1)}%; tol +${tol.p95}%)`]);
  }

  return { linhas, reprovou };
}

// ----------------------------- main -----------------------------------------
function main() {
  const args = parseArgs(process.argv);
  if (args.help || args._.length === 0) { console.log(HELP); process.exit(args.help ? 0 : 2); }

  const entrada = lerJSON(args._[0]);
  if (!entrada || !Array.isArray(entrada.previstos)) die('entrada.json sem array "previstos"');

  // gabarito: do --golden ou do proprio entrada.esperados
  let esperados;
  if (args.golden) esperados = lerGoldenJSONL(args.golden);
  else if (Array.isArray(entrada.esperados)) {
    esperados = entrada.esperados.map(e => ({
      pedido: e.pedido,
      codigos_esperados: Array.isArray(e.codigos_esperados) ? e.codigos_esperados : [],
      observacao: e.observacao || ''
    }));
  } else die('forneca --golden <arquivo.jsonl> ou "esperados" no entrada.json');

  const qual = avaliarQualidade(entrada.previstos, esperados);

  // F1 baseline de qualidade (para o gate): prioridade flag > json
  let qualBaseF1 = (args.f1Baseline != null) ? args.f1Baseline
    : (entrada.qualidade_baseline && typeof entrada.qualidade_baseline.f1_micro === 'number'
        ? entrada.qualidade_baseline.f1_micro : null);

  // ---------------- relatorio de qualidade ----------------
  console.log('================ QUALIDADE (contra golden-set) ================');
  for (const p of qual.porPedido) {
    if (p.semGabarito) {
      console.log(`  [sem gabarito] "${p.pedido}" — previu ${p.previstos} cod(s); excluido da media. ${p.observacao ? '(' + p.observacao + ')' : ''}`);
    } else {
      console.log(`  "${p.pedido}": prec ${pct(p.precisao)} | recall ${pct(p.recall)} | F1 ${f2(p.f1)} ` +
                  `(acertos ${p.acertos}/${p.esperados}, previu ${p.previstos})`);
    }
  }
  console.log('  ---------------------------------------------------------------');
  console.log(`  MICRO  -> precisao ${pct(qual.precisaoMicro)} | recall ${pct(qual.recallMicro)} | F1 ${f2(qual.f1Micro)}`);
  console.log(`  MACRO  -> F1 medio ${f2(qual.f1Macro)} (sobre ${qual.nComGabarito} pedido(s) com gabarito; ${qual.semGabarito} sem gabarito)`);
  console.log('');

  // ---------------- veredito ----------------
  const v = veredito(entrada.metricas_rodada, entrada.metricas_baseline, qual, qualBaseF1, args.tol);
  console.log('================ VEREDITO POR EIXO ================');
  for (const [eixo, status, detalhe] of v.linhas) {
    const tag = status === 'OK' ? '[ OK ]' : status === 'PULADO' ? '[ -- ]' : '[FALHA]';
    console.log(`  ${tag} ${eixo.padEnd(18)} ${detalhe}`);
  }
  console.log('==================================================');
  console.log(v.reprovou ? '>> RESULTADO: REGREDIU (gate REPROVADO)' : '>> RESULTADO: sem regressao (gate APROVADO)');

  if (args.json) {
    console.log('\n' + JSON.stringify({
      qualidade: {
        precisao_micro: qual.precisaoMicro, recall_micro: qual.recallMicro,
        f1_micro: qual.f1Micro, f1_macro: qual.f1Macro,
        f1_baseline: qualBaseF1, n_com_gabarito: qual.nComGabarito
      },
      veredito: v.linhas.map(([eixo, status, detalhe]) => ({ eixo, status, detalhe })),
      reprovou: v.reprovou
    }, null, 2));
  }

  process.exit(v.reprovou ? 1 : 0);
}

main();
