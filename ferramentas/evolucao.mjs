#!/usr/bin/env node
// =============================================================================
// evolucao.mjs — Acompanha a EVOLUCAO das rodadas do loop.
// -----------------------------------------------------------------------------
// Le todos os metricas/rodada-*.json e imprime uma tabela dos 3 EIXOS
// (velocidade, qualidade, tokens) ao longo das rodadas, com o delta vs a rodada
// anterior e se cada delta foi melhor ou PIOR (a regra de ouro: nenhum eixo pode
// piorar). E o "acompanhamento da evolucao das atualizacoes" do projeto.
//
// Uso: node ferramentas/evolucao.mjs [pasta-metricas]   (default: metricas)
// =============================================================================
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'metricas';

let arquivos;
try {
  arquivos = readdirSync(dir).filter((f) => /^rodada-\d+.*\.json$/.test(f)).sort();
} catch (e) {
  console.error(`ERRO: nao consegui ler a pasta ${dir}/: ${e.message}`);
  process.exit(1);
}
if (!arquivos.length) {
  console.error(`Nenhum rodada-*.json encontrado em ${dir}/.`);
  process.exit(1);
}

const rodadas = arquivos.map((f) => ({ f, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }));

const n = (x) => (x == null ? null : Number(x));
const fmt = (x, d = 0) => (x == null ? '-' : Number(x).toFixed(d));
// menorEhMelhor=true para req/p95/tokens; false para cache-hit/precisao/recall
function delta(cur, prev, casas, menorEhMelhor) {
  if (cur == null || prev == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return ' (=)';
  const bom = menorEhMelhor ? d < 0 : d > 0;
  const sinal = d > 0 ? '+' : '';
  return ` (${sinal}${d.toFixed(casas)} ${bom ? 'melhor' : 'PIOR'})`;
}

console.log('==================================================================');
console.log(' EVOLUCAO DAS RODADAS — cotacao-atacaderj (os 3 eixos)');
console.log('==================================================================');

let prev = null;
for (const r of rodadas) {
  const v = r.velocidade || {}, t = r.tokens || {}, q = r.qualidade || {};
  const pv = prev?.velocidade || {}, pt = prev?.tokens || {}, pq = prev?.qualidade || {};
  const est = r.baseline_a_confirmar ? '  (estimado, a confirmar)' : '';
  console.log('');
  console.log(`Rodada ${r.rodada} — ${r.veredito || '?'}  [alvo: ${r.eixo_alvo || '-'}]  ${r.f}${est}`);
  console.log(
    `  VELOCIDADE  req/cot ${fmt(v.requisicoes_por_cotacao, 1)}${delta(n(v.requisicoes_por_cotacao), n(pv.requisicoes_por_cotacao), 1, true)}` +
    `  | p95 ${fmt(v.latencia_ms_p95)}ms${delta(n(v.latencia_ms_p95), n(pv.latencia_ms_p95), 0, true)}` +
    `  | cache-hit ${fmt((v.cache_hit_rate ?? 0) * 100, 1)}%${delta(n(v.cache_hit_rate), n(pv.cache_hit_rate), 3, false)}`
  );
  console.log(
    `  TOKENS      total/cot ${fmt(t.total_por_cotacao)}${delta(n(t.total_por_cotacao), n(pt.total_por_cotacao), 0, true)}` +
    `  | in ${fmt(t.input)}  out ${fmt(t.output)}  cache_read ${fmt(t.cache_read)}`
  );
  console.log(
    `  QUALIDADE   precisao ${fmt(q.precisao, 1)}%${delta(n(q.precisao), n(pq.precisao), 1, false)}` +
    `  | recall ${fmt(q.recall, 1)}%${delta(n(q.recall), n(pq.recall), 1, false)}`
  );
  prev = r;
}

console.log('');
console.log('Regra de ouro: nenhum eixo pode ficar "PIOR" entre rodadas aprovadas.');
console.log('Direcao boa: req/p95/tokens DESCEM; cache-hit/precisao/recall SOBEM.');
