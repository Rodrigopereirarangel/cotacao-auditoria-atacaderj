#!/usr/bin/env node
// =============================================================================
// gerar-dashboard.mjs — gera dashboard.html (evolucao do app de cotacao).
// Le metricas/rodada-*.json + biblioteca/ e embute os dados num HTML com
// graficos (Chart.js via CDN). Regenere (npm run dashboard) apos cada rodada.
//
// Metricas suportadas por rodada (metricas/rodada-NNN.json):
//   qualidade: { precisao, recall, erros_corrigidos }
//   tokens:    { total_por_cotacao, input, output, cache_read }
//   velocidade:{ requisicoes_por_cotacao, latencia_ms_p95, cache_hit_rate }
//   operacao:  { itens, cotados, sem_match, errados, fallbacks,
//                tempo_total_ms, tempo_medio_item_ms }   <- precisam de
//                INSTRUMENTACAO no app (timestamps+contadores); sem isso = "a medir".
// =============================================================================
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.argv[2] || '.';
const MET = join(RAIZ, 'metricas');
const BIB = join(RAIZ, 'biblioteca');

function lerJSON(p, d) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return d; } }
function contarLinhas(p) { try { return readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).length; } catch (e) { return 0; } }

let rodadasRaw = [];
try {
  rodadasRaw = readdirSync(MET).filter(f => /^rodada-\d+.*\.json$/.test(f)).sort()
    .map(f => lerJSON(join(MET, f), null)).filter(Boolean);
} catch (e) {}

const ap = lerJSON(join(BIB, 'apelidos.json'), { entradas: [] });
const bu = lerJSON(join(BIB, 'buscas.json'), { entradas: [] });
const au = lerJSON(join(BIB, 'ausentes.json'), { itens: [] });
const bib = {
  apelidos: (ap.entradas || []).length, buscas: (bu.entradas || []).length, ausentes: (au.itens || []).length,
  correcoes: contarLinhas(join(BIB, 'correcoes.jsonl')), apelido_motivos: contarLinhas(join(BIB, 'apelido_motivos.jsonl')),
};

const DADOS = {
  rodadas: rodadasRaw.map(r => {
    const o = r.operacao || {};
    return {
      n: r.rodada, data: r.data || '', veredito: r.veredito || '', eixo: r.eixo_alvo || '', estimado: !!r.baseline_a_confirmar,
      precisao: r.qualidade?.precisao ?? null, recall: r.qualidade?.recall ?? null,
      tokens: r.tokens?.total_por_cotacao ?? null,
      req: r.velocidade?.requisicoes_por_cotacao ?? null, cache: r.velocidade?.cache_hit_rate ?? null,
      // operacionais (a medir = null ate instrumentar o app)
      errados: o.errados ?? r.qualidade?.erros_corrigidos ?? null,
      itens: o.itens ?? r.n_cotacoes ?? null, cotados: o.cotados ?? null, sem_match: o.sem_match ?? null, fallbacks: o.fallbacks ?? null,
      tempo_total_ms: o.tempo_total_ms ?? null, tempo_item_ms: o.tempo_medio_item_ms ?? null,
    };
  }),
  biblioteca: bib,
};

const TPL = `<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evolucao — Cotacao Atacaderj</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
:root{--navy:#0D3364;--orange:#ee8a1f;--bg:#eef1f6;--surface:#fff;--line:#e2e8f0;--text:#1d2733;--dim:#5c6b7a;--green:#157f3b;--red:#c0392b}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--text);padding:24px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:22px;color:var(--navy)}h1 span{color:var(--orange)}.sub{color:var(--dim);font-size:13px;margin:4px 0 18px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:13px 15px;box-shadow:0 4px 14px rgba(13,40,82,.06)}
.kpi .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);font-weight:700}
.kpi .val{font-size:22px;font-weight:800;color:var(--navy);margin-top:3px}.kpi .val small{font-size:12px;color:var(--dim);font-weight:600}
.kpi.medir .val{color:var(--dim);font-size:15px;font-weight:700}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 4px 14px rgba(13,40,82,.06)}
.card h3{font-size:14px;color:var(--navy);margin-bottom:10px}.card h3 .tag{font-size:10px;font-weight:700;color:var(--orange);background:#fdeed7;border-radius:6px;padding:1px 6px;margin-left:6px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim)}
.banner{padding:12px 16px;border-radius:10px;margin-bottom:16px;font-weight:600;font-size:13.5px}
.banner.ok{background:#e7f5ec;border:1px solid #bfe3cb;color:var(--green)}.banner.warn{background:#fdecec;border:1px solid #f3c9c4;color:var(--red)}
.aviso{font-size:12px;color:var(--dim);margin-top:16px}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
<h1>Evolucao — Cotacao <span>ATACADERJ</span></h1>
<div class="sub" id="sub"></div>
<div id="banner"></div>
<div class="kpis" id="kpis"></div>
<div class="grid">
  <div class="card"><h3>Qualidade (precisao / recall)</h3><canvas id="cQ"></canvas></div>
  <div class="card"><h3>Itens indicados errados / sem match <span class="tag" id="tgErr">a medir</span></h3><canvas id="cErr"></canvas></div>
  <div class="card"><h3>Tempo da cotacao e por item <span class="tag" id="tgTmp">a medir</span></h3><canvas id="cTmp"></canvas></div>
  <div class="card"><h3>Tokens por cotacao</h3><canvas id="cT"></canvas></div>
  <div class="card"><h3>Velocidade (requisicoes / cache-hit)</h3><canvas id="cV"></canvas></div>
  <div class="card"><h3>Biblioteca (estado atual)</h3><canvas id="cB"></canvas></div>
</div>
<div class="card" style="margin-top:14px"><h3>Rodadas</h3><table id="tab"><thead><tr><th>#</th><th>Data</th><th>Alvo</th><th>Veredito</th><th>Prec.</th><th>Recall</th><th>Errados</th><th>Tokens/cot</th><th>Tempo</th></tr></thead><tbody></tbody></table></div>
<div class="aviso" id="aviso"></div>
</div>
<script>var D=__DADOS__;</script>
<script>
(function(){
  var R=D.rodadas||[]; var labels=R.map(function(r){return 'R'+r.n;});
  var u=R.length?R[R.length-1]:null, b0=R.length?R[0]:null;
  function f(x,d){return x==null?'-':Number(x).toFixed(d==null?0:d);}
  function ms(x){return x==null?null:Math.round(x);} function seg(x){return x==null?'-':(x/1000).toFixed(1)+'s';}
  function has(key){return R.some(function(r){return r[key]!=null;});}
  document.getElementById('sub').textContent='Rodada atual: '+(u?('R'+u.n+' ('+(u.veredito||'?')+')'):'sem dados')+(u&&u.estimado?'  -  valores estimados (baseline a confirmar)':'');
  var bn=document.getElementById('banner');
  if(u&&b0&&R.length>1){var p=[];if(u.precisao<b0.precisao)p.push('precisao');if(u.recall<b0.recall)p.push('recall');if(u.tokens>b0.tokens)p.push('tokens');if(u.req>b0.req)p.push('requisicoes');if(p.length){bn.className='banner warn';bn.textContent='REGRA DE OURO violada: piorou em '+p.join(', ')+' vs baseline.';}else{bn.className='banner ok';bn.textContent='Regra de ouro OK: nenhum eixo regrediu vs baseline.';}}
  else{bn.className='banner ok';bn.textContent='Baseline registrado. As proximas rodadas serao comparadas aqui.';}
  var k=document.getElementById('kpis');function kpi(l,v,medir){var d=document.createElement('div');d.className='kpi'+(medir?' medir':'');d.innerHTML='<div class="lbl">'+l+'</div><div class="val">'+v+'</div>';k.appendChild(d);}
  if(u){
    kpi('Qualidade (P/R)', f(u.precisao,1)+'<small>% / '+f(u.recall,1)+'%</small>');
    kpi('Itens errados', u.errados==null?'a medir':f(u.errados), u.errados==null);
    kpi('Tempo da cotacao', u.tempo_total_ms==null?'a medir':seg(u.tempo_total_ms), u.tempo_total_ms==null);
    kpi('Tempo medio/item', u.tempo_item_ms==null?'a medir':(Math.round(u.tempo_item_ms)+'ms'), u.tempo_item_ms==null);
    kpi('Tokens / cotacao', f(u.tokens));
    kpi('Req / cotacao', f(u.req,1));
    kpi('Cache-hit', f((u.cache||0)*100,1)+'<small>%</small>');
  }
  kpi('Apelidos', D.biblioteca.apelidos);
  var navy='#0D3364',orange='#ee8a1f',green='#157f3b',red='#c0392b';
  function linha(id,series){new Chart(document.getElementById(id),{type:'line',data:{labels:labels,datasets:series},options:{responsive:true,plugins:{legend:{position:'bottom'}},tension:.25}});}
  if(R.length){
    linha('cQ',[{label:'Precisao %',data:R.map(function(r){return r.precisao;}),borderColor:navy,backgroundColor:navy},{label:'Recall %',data:R.map(function(r){return r.recall;}),borderColor:orange,backgroundColor:orange}]);
    linha('cErr',[{label:'Errados',data:R.map(function(r){return r.errados;}),borderColor:red,backgroundColor:red},{label:'Sem match',data:R.map(function(r){return r.sem_match;}),borderColor:orange,backgroundColor:orange}]);
    linha('cTmp',[{label:'Cotacao (s)',data:R.map(function(r){return r.tempo_total_ms==null?null:r.tempo_total_ms/1000;}),borderColor:navy,backgroundColor:navy},{label:'Por item (ms)',data:R.map(function(r){return r.tempo_item_ms;}),borderColor:orange,backgroundColor:orange,yAxisID:'y1'}],{});
    linha('cT',[{label:'Tokens/cotacao',data:R.map(function(r){return r.tokens;}),borderColor:navy,backgroundColor:navy}]);
    linha('cV',[{label:'Req/cotacao',data:R.map(function(r){return r.req;}),borderColor:navy,backgroundColor:navy},{label:'Cache-hit %',data:R.map(function(r){return (r.cache||0)*100;}),borderColor:green,backgroundColor:green}]);
  }
  if(has('errados')||has('sem_match'))document.getElementById('tgErr').remove();
  if(has('tempo_total_ms')||has('tempo_item_ms'))document.getElementById('tgTmp').remove();
  new Chart(document.getElementById('cB'),{type:'bar',data:{labels:['Apelidos','Buscas','Ausentes','Correcoes','Motivos IA'],datasets:[{label:'itens',data:[D.biblioteca.apelidos,D.biblioteca.buscas,D.biblioteca.ausentes,D.biblioteca.correcoes,D.biblioteca.apelido_motivos],backgroundColor:[navy,'#2f74c4',orange,green,'#9a5a00']}]},options:{plugins:{legend:{display:false}}}});
  var tb=document.querySelector('#tab tbody');
  R.forEach(function(r){var tr=document.createElement('tr');tr.innerHTML='<td>R'+r.n+'</td><td>'+(r.data||'').slice(0,10)+'</td><td>'+r.eixo+'</td><td>'+r.veredito+'</td><td>'+f(r.precisao,1)+'%</td><td>'+f(r.recall,1)+'%</td><td>'+(r.errados==null?'-':r.errados)+'</td><td>'+f(r.tokens)+'</td><td>'+seg(r.tempo_total_ms)+'</td>';tb.appendChild(tr);});
  document.getElementById('aviso').innerHTML='Gerado por <b>ferramentas/gerar-dashboard.mjs</b> (npm run dashboard). Metricas com tag "a medir" precisam de instrumentacao no app (timestamps+contadores) — pecam pro dev habilitar.';
})();
</script></body></html>`;

writeFileSync(join(RAIZ, 'dashboard.html'), TPL.replace('__DADOS__', JSON.stringify(DADOS)));
console.log('dashboard.html gerado. Rodadas: ' + DADOS.rodadas.length + ' | biblioteca: ' + (bib.apelidos + bib.buscas + bib.ausentes) + ' itens (apelidos ' + bib.apelidos + ').');
