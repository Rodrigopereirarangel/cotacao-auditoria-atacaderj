# Harness de medição dos 3 eixos — Atacaderj Cotação IA

Este harness produz os **números** que o gate de não-regressão consome. Ele mede, de
forma reproduzível, os **3 eixos que nunca podem ser sacrificados**:

| Eixo | O que medimos | Direção boa |
|------|---------------|-------------|
| **VELOCIDADE** | nº de requisições por cotação, latência (p50/p95, total), taxa de cache-hit | menor / maior cache-hit |
| **QUALIDADE** | precisão e recall do match **contra o golden-set rotulado** | maior |
| **TOKENS**  | input + output + `cache_read` por cotação | menor |

> Regra de ouro: o gate **reprova** se QUALIDADE cair, se TOKENS subir ou se VELOCIDADE
> cair, em relação ao baseline. Os três eixos são medidos na **mesma rodada**, sobre o
> **mesmo golden-set**, para que a comparação seja justa.

---

## 0. Visão geral do fluxo

```
  golden-set.exemplo.jsonl  (pedidos rotulados + codigos_esperados)
            │
            ▼
  [ roda a cotação no app ]  ──►  metricas_rodada.json   (velocidade + tokens)
            │                      previstos.json        (codigos que o app achou)
            ▼
  node benchmark/avaliar.mjs entrada.json
            │
            ▼
  precisão/recall por caso + VEREDITO de regressão por eixo (exit 0/1)
```

A **qualidade é SEMPRE medida contra o golden-set** (`codigos_esperados`). O app
nunca "se autoavalia": comparamos o que ele previu (`previstos`) com o gabarito
humano (`esperados`).

Existem **dois modos** de coletar os `previstos` e as métricas brutas:

- **(a) Modo NAVEGADOR** — recomendado, é o que o usuário realmente roda. Usa o
  proxy/sessão do próprio app (fetch para `api.anthropic.com` **sem** `x-api-key`).
  Coleta as métricas que o app **já rastreia**.
- **(b) Modo NODE (opcional)** — usa `ANTHROPIC_API_KEY` direto, fora do navegador.
  Útil para CI sem browser, mas **não** reproduz exatamente o proxy/sessão do app.

O script `avaliar.mjs` é **agnóstico ao modo**: ele só recebe os números prontos e
julga. Nunca chama a API.

---

## 1. O que o app JÁ rastreia (não precisamos reinventar)

Confirmado no código real (`cotacao_ia_oficial.html`):

| Sinal | Onde vive | Como é alimentado |
|-------|-----------|-------------------|
| **nº de requisições** | `_msgDiaN` (e `localStorage['atacaderj_msgdia']` = `{d,n}`) | `_contarMsg()` é chamado no **topo de toda `apiCall(...)`** |
| **cache-hits / tokens de cache** | `cacheHits`, `cacheTokensSaved` | `trackCache(usage)` soma `usage.cache_read_input_tokens` quando `>0` |
| **buscas reaproveitadas (0 token)** | `buscasReusadas` | incrementado em `buscaSemantica` quando a chave já está em `_buscasSalvas` |
| **resultados (códigos previstos)** | `searchResults[item]` → `grupos[].produtos[].c` | preenchido por `renderBody(...)` ao longo do pipeline |
| **falhas do fallback** | `localStorage['atacaderj_ausentes']` | itens que nem `buscaCatalogoInteiro` achou |

> ⚠️ **Lacuna conhecida:** hoje `trackCache` lê **apenas** `cache_read_input_tokens`.
> Os campos `input_tokens` e `output_tokens` de cada resposta **não são somados** em
> lugar nenhum. Para medir TOKENS por completo no modo navegador, aplique o
> snippet aditivo da seção 2.1 (um `console`, **sem editar o .html**).

---

## 2. Modo NAVEGADOR (recomendado)

### 2.1 Instrumentação aditiva (cole no Console ANTES de cotar)

Não edite o `.html`. Abra o app, abra o DevTools (F12 → Console) e cole este snippet.
Ele envolve as funções existentes e acumula **input/output/cache_read** + latência
+ contagem de requisições, sem alterar comportamento.

```js
// === HARNESS 3 EIXOS — coletor aditivo (cole no Console) ===
// Não altera o pipeline; apenas observa apiCall/trackCache.
window.__BENCH__ = {
  reqs: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
  lat: [], t0: 0, msgIni: (typeof _msgDiaN!=='undefined'? _msgDiaN : 0),
  reusoIni: (typeof buscasReusadas!=='undefined'? buscasReusadas : 0)
};
(function(){
  const orig = window.apiCall;
  if (!orig || orig.__wrapped) { console.warn('apiCall já instrumentado ou ausente'); return; }
  window.apiCall = async function(body, ...rest){
    const b = window.__BENCH__; const ini = performance.now();
    try {
      const data = await orig.call(this, body, ...rest);
      const u = (data && data.usage) || {};
      b.reqs++;
      b.input       += u.input_tokens || 0;
      b.output      += u.output_tokens || 0;
      b.cacheRead   += u.cache_read_input_tokens || 0;
      b.cacheCreate += u.cache_creation_input_tokens || 0;
      b.lat.push(performance.now() - ini);
      return data;
    } catch(e){ b.reqs++; b.lat.push(performance.now() - ini); throw e; }
  };
  window.apiCall.__wrapped = true;
  console.log('✓ Harness instalado. Rode a cotação, depois __BENCH_DUMP__().');
})();

// Chame DEPOIS que a cotação terminar:
window.__BENCH_DUMP__ = function(itensDoGolden){
  const b = window.__BENCH__;
  const lat = b.lat.slice().sort((a,c)=>a-c);
  const pct = p => lat.length ? lat[Math.min(lat.length-1, Math.floor(p/100*lat.length))] : 0;
  // códigos previstos por pedido, lidos do estado real do app:
  const previstos = (itensDoGolden||Object.keys(window.searchResults||{})).map(pedido=>{
    const grupos = (window.searchResults||{})[pedido] || [];
    const cods = [];
    grupos.forEach(g => (g.produtos||[]).forEach(p => { if(p && p.c!=null) cods.push(p.c); }));
    return { pedido, codigos: [...new Set(cods)] };
  });
  const reqsDelta = (typeof _msgDiaN!=='undefined'? _msgDiaN : b.msgIni) - b.msgIni;
  const totalCacheIn = b.cacheRead + b.cacheCreate;
  const cacheHitRatio = (b.input + totalCacheIn) > 0
      ? b.cacheRead / (b.input + totalCacheIn) : 0;
  const out = {
    previstos,
    metricas_rodada: {
      // VELOCIDADE
      requisicoes: reqsDelta || b.reqs,
      buscas_reaproveitadas: (typeof buscasReusadas!=='undefined'? buscasReusadas : 0) - b.reusoIni,
      latencia_total_ms: lat.reduce((s,x)=>s+x,0),
      latencia_p50_ms: Math.round(pct(50)),
      latencia_p95_ms: Math.round(pct(95)),
      cache_hit_ratio: +cacheHitRatio.toFixed(4),
      // TOKENS
      input_tokens: b.input,
      output_tokens: b.output,
      cache_read_tokens: b.cacheRead,
      cache_creation_tokens: b.cacheCreate,
      tokens_total: b.input + b.output + b.cacheRead
    }
  };
  console.log(JSON.stringify(out, null, 2));
  copy && copy(JSON.stringify(out));   // vai pro clipboard no DevTools
  return out;
};
```

### 2.2 Procedimento de medição (passo a passo)

1. **Zere o estado** para uma medição limpa e reproduzível (escolha o cenário):
   - **Cenário FRIO** (mede o pior caso, sem aprendizado): no Console rode
     `['atacaderj_buscas','atacaderj_apelidos','atacaderj_ausentes'].forEach(k=>localStorage.removeItem(k)); location.reload();`
     Isso mede velocidade/tokens **sem** cache de buscas nem apelidos aprendidos.
   - **Cenário QUENTE** (mede o caso real do dia a dia): rode a cotação **uma vez**
     para popular o cache, depois rode de novo medindo. Reflete o usuário recorrente.
   - Sempre registre qual cenário foi usado — baseline e rodada nova têm que usar o
     **mesmo cenário**.
2. Cole o snippet da seção 2.1.
3. Cole na caixa de pedido **exatamente os `pedido` do golden-set** (um por linha) e
   rode a cotação normalmente (botão Buscar).
4. Quando terminar (resumo aparece), rode no Console:
   ```js
   __BENCH_DUMP__(["ariel liq 3l","leite moca cx", /* ...todos os pedidos do golden-set, na mesma ordem... */]);
   ```
   Passe a **lista de pedidos do golden-set** para garantir que todos apareçam em
   `previstos`, inclusive os que o app não achou (vêm com `codigos: []`).
5. Salve a saída como `previstos.json` + `metricas_rodada.json` (ou junte tudo no
   `entrada.json` da seção 4).

### 2.3 Como cada eixo é medido no navegador

- **VELOCIDADE**
  - *nº de requisições por cotação* = `metricas_rodada.requisicoes` (delta de `_msgDiaN`,
    que é incrementado por `_contarMsg()` em toda `apiCall`). Esse é o número-rei do
    eixo: cada requisição é latência + risco de rate-limit (429/529).
  - *latência* = p50/p95/total medidos no wrapper de `apiCall`.
  - *cache-hit* = `cache_hit_ratio` (parte da entrada que veio de `cache_read`) +
    `buscas_reaproveitadas` (hits de 0 token vindos de `_buscasSalvas`).
- **TOKENS**
  - `input_tokens` + `output_tokens` + `cache_read_tokens` por cotação, somados no
    wrapper. `cache_read` é mais barato que input fresco, por isso é reportado à parte,
    mas entra no `tokens_total` para não "esconder" custo.
- **QUALIDADE** — **não** sai do navegador. Os `previstos` (códigos do
  `searchResults`) vão para `avaliar.mjs`, que compara com `codigos_esperados` do
  golden-set. Ver seção 5.

---

## 3. Modo NODE (opcional, para CI sem browser)

Quando não há navegador/sessão (ex.: pipeline de CI), você pode reproduzir as chamadas
usando `ANTHROPIC_API_KEY`. **Atenção:** este modo **não** passa pelo proxy/sessão do
app, então:

- as métricas de **velocidade** (rate-limit, pausas, 429/529) **não** são comparáveis
  1:1 com o navegador — use o NODE para medir **tokens** e **qualidade**, e o navegador
  para o número oficial de **velocidade**;
- você precisa enviar o header `x-api-key` (no navegador ele é **omitido** de propósito).

Esqueleto mínimo (não faz parte do gate; serve só para gerar `previstos`/`tokens`):

```js
// node --env-file=.env coletar-node.mjs   (ANTHROPIC_API_KEY no ambiente)
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('Defina ANTHROPIC_API_KEY'); process.exit(2); }
async function call(body){
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'content-type':'application/json', 'anthropic-version':'2023-06-01', 'x-api-key': KEY },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  // some d.usage.input_tokens / output_tokens / cache_read_input_tokens aqui
  return d;
}
```

> Para reaproveitar a lógica real (filtroLocal, candidatosDoItem, buscaSemanticaLote,
> buscaCatalogoInteiro), o caminho recomendado é **portar** essas funções para um
> módulo, mantendo os mesmos modelos (`claude-sonnet-4-6`, `claude-haiku-4-5-20251001`)
> e o `cache_control: {type:'ephemeral', ttl:'1h'}` do `CATALOG_BLOCK`. Enquanto isso
> não existe, o **modo navegador é a fonte oficial** dos 3 eixos, e o modo NODE é
> auxiliar.

A saída do modo NODE deve ter **o mesmo formato** de `entrada.json` (seção 4), para
que `avaliar.mjs` julgue igual, independente do modo.

---

## 4. Formato do `entrada.json` (o que `avaliar.mjs` consome)

```jsonc
{
  "previstos": [
    { "pedido": "ariel liq 3l", "codigos": [10231, 10232] }
  ],
  "esperados": [                      // normalmente injetado a partir do golden-set
    { "pedido": "ariel liq 3l", "codigos_esperados": [10231], "observacao": "..." }
  ],
  "metricas_rodada":   { "requisicoes": 9,  "tokens_total": 41000, "cache_hit_ratio": 0.62, "latencia_p95_ms": 4200, "input_tokens":..., "output_tokens":..., "cache_read_tokens":... },
  "metricas_baseline": { "requisicoes": 9,  "tokens_total": 42000, "cache_hit_ratio": 0.60, "latencia_p95_ms": 4300, ... }
}
```

- `esperados` pode ser omitido se você passar `--golden benchmark/golden-set.exemplo.jsonl`
  (o script carrega o gabarito do arquivo).
- `metricas_baseline` é a foto do **último estado aprovado** (commitada em
  `benchmark/baseline.json`, por exemplo). É contra ela que o gate compara.

---

## 5. Qualidade: precisão e recall contra o golden-set

Para cada pedido, sejam `P` = conjunto de `codigos` previstos e `E` = conjunto de
`codigos_esperados`:

- **acertos** = `|P ∩ E|`
- **precisão** = `acertos / |P|` (dos que o app sugeriu, quantos eram certos)
- **recall**   = `acertos / |E|` (dos certos, quantos o app achou)
- **F1** = média harmônica (resumo único)

Agregamos por **micro-média** (soma os acertos/totais de todos os pedidos) — é o que o
gate usa — e reportamos também a **macro-média** (média dos F1 por pedido), útil para
flagrar um pedido que regrediu sozinho.

> A qualidade **é, por definição, medida contra o golden-set**. Se um pedido não tem
> `codigos_esperados` confiável, marque-o com `codigos_esperados: []` e uma `observacao`
> explicando — o script o trata como "sem gabarito" e o exclui da agregação (não conta
> a favor nem contra).

---

## 6. O gate (VEREDITO de regressão)

`avaliar.mjs` compara `metricas_rodada` × `metricas_baseline` e a qualidade da rodada ×
qualidade do baseline (se houver `qualidade_baseline`/baseline com previstos), e aplica:

| Eixo | Regra de reprovação | Tolerância padrão |
|------|---------------------|-------------------|
| QUALIDADE | F1 micro **caiu** abaixo do baseline | `-0.5 pp` (ruído) |
| TOKENS    | `tokens_total` **subiu** | `+2%` |
| VELOCIDADE | `requisicoes` **subiu** OU `cache_hit_ratio` **caiu** OU `latencia_p95_ms` **subiu** | req: 0 a mais; cache: `-1 pp`; p95: `+10%` |

Se **qualquer** eixo regredir além da tolerância → **exit 1** (gate reprova). As
tolerâncias existem só para absorver ruído de rede/amostragem; podem ser apertadas via
flags (ver `avaliar.mjs --help`). Velocidade prioriza **nº de requisições** porque é o
que mais dói (latência e rate-limit); latência p95 é secundária.

---

## 7. Como rodar o gate

```bash
# 1) gere entrada.json pelo modo navegador (seção 2) ou node (seção 3)
# 2) rode o avaliador (carrega o gabarito do golden-set):
node benchmark/avaliar.mjs entrada.json --golden benchmark/golden-set.exemplo.jsonl

# exit 0 = aprovado; exit 1 = regressão (a saída diz qual eixo e quanto)
echo $?
```

---

## 8. Checklist de medição justa

- [ ] Baseline e rodada nova usam o **mesmo golden-set** e o **mesmo cenário** (frio/quente).
- [ ] Mesmo catálogo/`versaoCatalogo()` nas duas medições (cache de buscas é versionado).
- [ ] Snippet da seção 2.1 colado **antes** de cotar (senão input/output ficam zerados).
- [ ] Todos os pedidos do golden-set passados ao `__BENCH_DUMP__` (para capturar os `[]`).
- [ ] Rodar 2–3 vezes e usar a **mediana** das métricas de velocidade (rede oscila).
