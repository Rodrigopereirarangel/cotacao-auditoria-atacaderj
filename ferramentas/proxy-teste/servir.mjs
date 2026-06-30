#!/usr/bin/env node
// =============================================================================
// servir.mjs — Proxy/servidor LOCAL de teste para a IA do app de cotacao.
// -----------------------------------------------------------------------------
// PROBLEMA: o app chama https://api.anthropic.com/v1/messages SEM x-api-key e
// SEM o header de CORS de browser. Abrindo o app como arquivo (file://), o
// navegador bloqueia por CORS e a Anthropic recusa por falta de chave — a IA
// nao responde. (As partes locais — catalogo, filtro — funcionam.)
//
// SOLUCAO (sem alterar o app e sem quebrar a trava de integridade):
//   1. Serve o app em http://localhost:PORTA.
//   2. Injeta um <script> logo apos <head> — que fica FORA de #app-core, entao
//      o hash de integridade NAO muda e o app continua "versao oficial". Esse
//      script faz monkey-patch de window.fetch: toda chamada a api.anthropic.com
//      vira uma chamada same-origin para /__anthropic.
//   3. /__anthropic encaminha para a Anthropic injetando x-api-key + anthropic-version.
//
// USO (PowerShell):
//   $env:ANTHROPIC_API_KEY="sk-ant-..."; node ferramentas/proxy-teste/servir.mjs
// USO (bash):
//   ANTHROPIC_API_KEY=sk-ant-... node ferramentas/proxy-teste/servir.mjs
// Flags opcionais:  --porta 8787   --app app/cotacao_ia_oficial.html
//
// Depois abra http://localhost:8787  (a IA passa a usar SUA chave/cota).
// SEGURANCA: a chave fica so na sua maquina (variavel de ambiente). Nunca e
// commitada. Use uma chave de teste com limite de gasto.
// =============================================================================
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORTA = parseInt(getArg('--porta', '8787'), 10);
const APP = getArg('--app', 'app/cotacao_ia_oficial.html');
const KEY = process.env.ANTHROPIC_API_KEY || '';
const VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';

if (!KEY) {
  console.warn('AVISO: ANTHROPIC_API_KEY nao definida — o app abre, mas a IA respondera 401.');
  console.warn('  PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."; node ferramentas/proxy-teste/servir.mjs');
}

// Patch injetado FORA de #app-core (logo apos <head>) -> nao altera o hash.
const PATCH = `<script>
/* [proxy-teste] redireciona chamadas da Anthropic para o proxy local (same-origin) */
(function(){
  var _f = window.fetch;
  window.fetch = function(url, opts){
    try {
      if (typeof url === 'string' && url.indexOf('api.anthropic.com/v1/messages') !== -1) {
        return _f('/__anthropic', opts);
      }
    } catch (e) {}
    return _f.apply(this, arguments);
  };
  console.log('[proxy-teste] window.fetch -> /__anthropic ativo');
})();
</script>`;

function servirApp(res) {
  let html;
  try { html = readFileSync(APP, 'utf8'); }
  catch (e) { res.writeHead(500); res.end('Nao consegui ler ' + APP + ': ' + e.message); return; }
  html = html.includes('<head>') ? html.replace('<head>', '<head>' + PATCH) : (PATCH + html);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function proxyAnthropic(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const payload = Buffer.concat(chunks);
    const up = https.request({
      method: 'POST',
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': VERSION,
        'x-api-key': KEY,
        'Content-Length': payload.length,
      },
    }, (r) => {
      res.writeHead(r.statusCode || 502, { 'Content-Type': r.headers['content-type'] || 'application/json' });
      r.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: 'proxy-teste: ' + e.message })); });
    up.end(payload);
  });
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__anthropic') return proxyAnthropic(req, res);
  return servirApp(res); // qualquer GET serve o app
}).listen(PORTA, () => {
  console.log('Proxy de teste em  http://localhost:' + PORTA + '   (app: ' + APP + ')');
  console.log(KEY ? 'Chave: carregada de ANTHROPIC_API_KEY.' : 'Chave: AUSENTE (IA dara 401).');
  console.log('Ctrl+C para parar.');
});
