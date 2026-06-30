# Backlog priorizado de otimizações — cotacao_ia_oficial.html

Documento aditivo. Não altera o app. Cada item aponta o ponto exato no código
(`cotacao_ia_oficial.html`), a mudança proposta com trecho, e como validar que
nenhum dos 3 eixos regride.

## A regra de ouro (os 3 eixos)

Toda otimização aqui respeita: **VELOCIDADE** (nº de requisições, latência,
cache-hit), **QUALIDADE** (precisão/recall do match) e **TOKENS** (input/output/
cache_read por cotação). Nada pode ser melhorado às custas de outro eixo. Por isso
cada item está marcado como:

- **[GANHO SEGURO]** — risco zero de qualidade. O match produzido é, por
  construção, idêntico ou estritamente superior. Pode entrar direto.
- **[MEDIR ANTES]** — o ganho de velocidade/tokens é claro, mas existe um caminho
  pelo qual a qualidade *poderia* cair. Só aceitar depois de comparar o resultado
  contra o baseline (mesmo conjunto de listas reais) e confirmar empate ou melhora.

## O que existe hoje para medir (instrumentação atual)

Antes do backlog, o que o app já conta (e o que falta para um benchmark honesto):

- `trackCache(usage)` (linha ~4710) só soma `cache_read_input_tokens` em
  `cacheTokensSaved` e incrementa `cacheHits`. **Não** mede
  `cache_creation_input_tokens`, nem `input_tokens`/`output_tokens`. Para validar
  itens de TOKENS é preciso instrumentar esses três campos (snippet de console no
  fim deste doc).
- `_msgDiaN` (linha ~4711) conta requisições no dia → proxy de VELOCIDADE
  (nº de chamadas).
- `buscasReusadas` + `atualizarChipReuso()` → quantas buscas saíram de
  `_buscasSalvas` (0 tokens). Proxy direto do reuso.

**Métrica de QUALIDADE recomendada para o benchmark:** um conjunto fixo de
listas reais (ex.: 10 listas, ~200 itens) com gabarito de códigos esperados por
item. Para cada item meça **recall** (códigos certos trazidos / códigos certos)
e **ruído** (códigos errados trazidos / total trazido). Um item só "não regride"
se recall não cai e ruído não sobe.

---

# Prioridade 1 — ganhos seguros (entrar direto)

## 1. `cutucarCache`: trocar `max_tokens:1` por `max_tokens:0` — [GANHO SEGURO]

- **Eixo que melhora:** TOKENS (elimina o 1 token de output do cutucão), marginal
  em VELOCIDADE.
- **Eixo em risco:** nenhum. O cutucão não usa a resposta — só serve para
  reescrever o cache do `CATALOG_BLOCK`.
- **Local:** função `cutucarCache` (linha ~4825).

```js
let _ultimoToqueCatalogo=0;async function cutucarCache(){try{await apiCall({model:"claude-sonnet-4-6",max_tokens:1,messages:[{role:"user",content:[{type:"text",text:CATALOG_BLOCK,cache_control:{type:"ephemeral",ttl:"1h"}},{type:"text",text:'PEDIDO: "ping"\nPODE SER: ping'}]}]},1,30000);...
```

- **Mudança proposta:** `max_tokens:1` → `max_tokens:0`. No modo `max_tokens:0` a
  API lê o prompt, grava o cache em cada breakpoint `cache_control` e retorna
  imediatamente, **sem gerar output e sem cobrar tokens de saída**. É exatamente o
  comportamento que o cutucão quer (aquecer o prefixo). Com `max_tokens:1` o
  modelo ainda gera 1 token que é descartado.

```js
await apiCall({model:"claude-sonnet-4-6",max_tokens:0,messages:[...]},1,30000);
```

- **Por que não custa qualidade:** o cutucão nunca produziu match — só mantém o
  catálogo quente. Saída descartada continua descartada; agora apenas não é
  gerada nem cobrada.
- **Como validar (sem regressão):** no console, depois de um cutucão, confirmar
  que `_ultimoToqueCatalogo` atualizou (não lançou erro) e que a *próxima*
  `buscaCatalogoInteiro` teve `cache_read_input_tokens > 0` (cache quente
  acertou). Observe `cacheTokensSaved` subindo na 1ª busca pós-cutucão como
  antes. Se a sua sessão/proxy rejeitar `max_tokens:0`, reverter para `1` é
  inócuo — é o mesmo efeito de cache, só com 1 token de output a mais.

> Nota factual: na Messages API o mínimo para requisições normais é
> `max_tokens >= 1`; `max_tokens:0` é o modo dedicado de *cache warming* (lê o
> prompt, grava o cache, retorna vazio). Como o app vai direto em
> `api.anthropic.com`, vale fazer 1 cutucão de teste e ver se o proxy aceita `0`;
> se aceitar (esperado), é ganho puro.

## 2. OCR: deixar `N_LEITURAS=3` coerente com o fluxo 2+1 já existente — [GANHO SEGURO]

- **Eixo que melhora:** VELOCIDADE e TOKENS (em listas legíveis, 2 leituras em vez
  de 3 — economiza 1 leitura inteira de imagem por arquivo).
- **Eixo em risco:** QUALIDADE da transcrição, controlado pela condição de
  divergência.
- **Local:** `extractItemsFromFile` (linha ~5248) e a constante `N_LEITURAS`
  (linha ~5254).

```js
let _res=await Promise.allSettled([lerImagemUmaVez(fonte),lerImagemUmaVez(fonte)]);let leituras=_leOk(_res);...
if(leituras.length===2&&leituras[0].trim()!==leituras[1].trim()){const _r3=await Promise.allSettled([lerImagemUmaVez(fonte)]);leituras=leituras.concat(_leOk(_r3));...}
```

- **Situação real:** o fluxo **já é 2 leituras fixas + 3ª condicional à
  divergência**. O que está incoerente é a constante `N_LEITURAS=3` (linha 5254),
  que hoje é morta/enganosa e sugere 3 leituras fixas. A "otimização (3)" pedida
  já está implementada; falta torná-la explícita e endurecer a condição de
  divergência, que hoje é **igualdade exata de string inteira** — qualquer
  diferença de 1 caractere (acento, espaço final) dispara a 3ª leitura +
  `consolidarLeituras` desnecessariamente.
- **Mudança proposta:** (a) renomear/documentar `N_LEITURAS` para deixar claro que
  é `2 + 1 condicional`; (b) trocar a comparação crua por uma comparação tolerante
  por linhas normalizadas, para só disparar a 3ª leitura quando houver divergência
  *de conteúdo de item*, não de formatação:

```js
// dispara 3ª leitura só se as duas leituras divergem no conteúdo (linha a linha)
const _normLeitura=t=>t.split('\n').map(l=>l.trim().toLowerCase()).filter(Boolean).join('\n');
if(leituras.length===2 && _normLeitura(leituras[0])!==_normLeitura(leituras[1])){ /* 3ª leitura */ }
```

- **Por que não custa qualidade:** a 3ª leitura continua acontecendo sempre que as
  duas primeiras discordam *no que importa* (os nomes dos produtos). Diferenças
  só de espaço/acento nunca mudaram o item resultante depois do
  `removerQuantidade`/`_fold`, então pular a 3ª nesses casos não altera o
  resultado final — só evita uma leitura de imagem e uma consolidação.
- **Como validar (sem regressão):** rodar o conjunto fixo de imagens manuscritas e
  comparar a **lista de itens parseada** (`parseLeitura`) com a do baseline. A
  lista de itens tem de ser idêntica item a item. Observe a queda no nº de
  chamadas a `lerImagemUmaVez`/`consolidarLeituras` (via `_msgDiaN` ou contador de
  console). Se algum item sumir/mudar → reverter a normalização (mantém o
  comportamento atual).

---

# Prioridade 2 — ganho grande, exige medir antes (TOKENS/VELOCIDADE altos)

## 3. Batchear `buscaCatalogoInteiro`: N PEDIDOS por leitura cacheada do `CATALOG_BLOCK` — [MEDIR ANTES]

- **Eixo que melhora:** VELOCIDADE (de 1 requisição por item para 1 requisição por
  lote no fallback) e TOKENS (1 `cache_read` do catálogo inteiro serve vários
  itens em vez de 1).
- **Eixo em risco:** QUALIDADE (vários pedidos no mesmo contexto podem "vazar"
  índices entre si) e robustez (uma falha de parse derruba o lote inteiro).
- **Local:** `buscaCatalogoInteiro` (linha ~4871). Hoje cada item monta seu próprio
  `exec` e é serializado em `_filaCatalogoInteiro` (1 requisição por item):

```js
async function buscaCatalogoInteiro(original,interpretados){...const exec=async()=>{const significados=(...).join(' OU ');const d=await apiCall({model:"claude-sonnet-4-6",max_tokens:2000,messages:[{role:"user",content:[{type:"text",text:CATALOG_BLOCK,cache_control:{type:"ephemeral",ttl:"1h"}},{type:"text",text:`PEDIDO: "${original}"\nPODE SER: ${significados}`}]}]},4,90000);...};const p=_filaCatalogoInteiro.then(exec,exec);_filaCatalogoInteiro=p.then(()=>{},()=>{});return p;}
```

- **Mudança proposta:** criar `buscaCatalogoInteiroLote(itens)` que envia **um
  bloco `CATALOG_BLOCK` cacheado** seguido de **vários PEDIDOS numerados** (o
  mesmo padrão que `buscaSemanticaLote` já usa para a haiku) e pede um JSON
  `{"resultados":[{"pedido":N,"grupos":[...]}]}`. O `CATALOG_BLOCK` (parte cara,
  ~todo o catálogo) é lido do cache **uma vez** e amortizado por todos os pedidos
  do lote.

  Esqueleto do segundo bloco de texto (o `CATALOG_BLOCK` continua sendo o 1º
  content, com `cache_control`):

```js
const blocos = itens.map((x,n)=>`### PEDIDO ${n+1}: "${x.original}"\nPODE SER: ${(x.interp&&x.interp.length?x.interp:[x.original]).join(' OU ')}`).join('\n\n');
const instr = `Trate cada PEDIDO ISOLADAMENTE. Para CADA pedido devolva os índices do CATÁLOGO que correspondem, na ordem. Responda SOMENTE: {"resultados":[{"pedido":1,"grupos":[{"nome":"...","indices":[..]}]}]}`;
const d = await apiCall({model:"claude-sonnet-4-6",max_tokens:4000,messages:[{role:"user",content:[
  {type:"text",text:CATALOG_BLOCK,cache_control:{type:"ephemeral",ttl:"1h"}},
  {type:"text",text:`${instr}\n\n${blocos}`}
]}]},4,90000);
```

  O parse reaproveita a mesma validação de índices que `buscaCatalogoInteiro` já
  faz (`Number.isInteger(i)&&i>=0&&i<CATALOG.length`, dedup por `vistos`),
  aplicada por pedido. Manter o registro de ausentes (`_catInteiroAusentes`) por
  item: itens do lote sem nenhum grupo entram em `_catInteiroAusentes`.
  Tamanho de lote sugerido: começar pequeno (3 a 5 pedidos) porque o `CATALOG_BLOCK`
  já é enorme e o output cresce com o nº de pedidos.

- **Por que o ganho NÃO precisa custar qualidade:** o catálogo enviado é
  exatamente o mesmo (mesmo prefixo cacheado), o prompt de regras é o mesmo, e
  cada pedido é instruído a ser tratado isoladamente — é o **mesmo padrão de
  isolamento que `buscaSemanticaLote` já roda com sucesso** ("Trate cada pedido
  ISOLADAMENTE: NUNCA use índice da lista de um pedido na resposta de outro").
  Logo, a informação disponível ao modelo por pedido é idêntica à do modo 1-a-1.
- **Riscos concretos a vigiar (por isso MEDIR ANTES):**
  1. *Vazamento entre pedidos* — modelo trazer índice pensando em outro pedido.
     Mitiga-se com a frase de isolamento e validando que cada `indices[]` faz
     sentido para aquele pedido (mesma checagem do lote da haiku).
  2. *Falha de parse derruba o lote* — se o JSON vier truncado (max_tokens),
     todos os itens do lote caem. Mitigação: fallback automático — se o parse do
     lote falhar ou faltar `pedido N`, reprocessar **só os itens faltantes** pelo
     caminho 1-a-1 atual (que continua existindo). Assim nunca se perde item.
- **Como validar (sem regressão):** rodar o benchmark de qualidade só nos itens
  que historicamente caem no fallback (use `_catInteiroAusentes` + itens que hoje
  chegam ao `buscaCatalogoInteiro`). Comparar recall e ruído lote-vs-1a1 item a
  item: **recall não pode cair, ruído não pode subir**. Em TOKENS, medir
  `cache_read_input_tokens` total do estágio fallback (deve cair: 1 leitura do
  catálogo por lote em vez de por item) e `cache_creation` (não deve aumentar). Em
  VELOCIDADE, contar requisições do estágio fallback (deve cair ~Nx). Só aceitar se
  os três melhoram ou empatam.

## 4. Elevar o cache-hit do `CATALOG_BLOCK` — estabilidade do prefixo — [GANHO SEGURO]

- **Eixo que melhora:** TOKENS e VELOCIDADE (mais `cache_read`, menos
  `cache_creation`; latência menor no fallback).
- **Eixo em risco:** nenhum, desde que o conteúdo do catálogo não mude.
- **Local:** `montarCatalogBlock(textoCatalogo)` (linha ~4783) e a inicialização
  `let CATALOG_BLOCK=montarCatalogBlock(CATALOG_TEXT.toLowerCase());` (linha ~4814).
  O `cache_control` ephemeral é aplicado em `cutucarCache` (4825),
  `buscaCatalogoInteiro` (4871) — e passaria a ser aplicado no lote do item 3.
- **Problema:** o cache só acerta se o **prefixo for byte-a-byte idêntico** entre
  chamadas. Hoje o `CATALOG_BLOCK` é uma string única e estável (bom), mas há
  riscos silenciosos de invalidação:
  1. Qualquer override de catálogo (`atacaderj_catalogo`) muda `CATALOG_TEXT` →
     `CATALOG_BLOCK` muda → cache antigo morre (esperado e correto), mas o
     `versaoCatalogo()` precisa acompanhar para não reusar caches velhos.
  2. O bloco usa `CATALOG_TEXT.toLowerCase()`; se em algum ponto o catálogo for
     remontado com ordenação/normalização diferente, o prefixo muda sem o conteúdo
     mudar de fato.
- **Mudança proposta (defensiva, sem tocar no conteúdo do match):**
  1. Garantir **ordem estável** dos produtos no `textoCatalogo` (ordenar por `c`
     antes de montar), para que o prefixo só mude quando o catálogo realmente
     mudar.
  2. Congelar `CATALOG_BLOCK` numa única const por versão e **nunca** recriá-lo
     dentro de loop/handler — recriar a string idêntica é inócuo para o conteúdo,
     mas qualquer diferença acidental (espaço, ordem) invalida o cache.
  3. Adicionar um log de diagnóstico (console) que imprime um hash curto do
     `CATALOG_BLOCK` no boot e a cada cutucão; se o hash mudar sem nova versão de
     catálogo, há invalidação acidental a investigar.

```js
// diagnóstico de estabilidade do prefixo (apenas log)
function _hashBlock(s){let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}return h;}
console.log('CATALOG_BLOCK hash', _hashBlock(CATALOG_BLOCK), 'len', CATALOG_BLOCK.length, 'versao', versaoCatalogo());
```

- **Por que não custa qualidade:** ordenar o catálogo e congelar a string **não
  muda quais produtos existem nem o texto que o modelo lê** — só garante que o
  mesmo conteúdo gere o mesmo prefixo, maximizando `cache_read`. O match é função
  do conteúdo, não da ordem das linhas.
- **Como validar (sem regressão):** em uma cotação com vários itens de fallback,
  medir a razão `cache_read_input_tokens / (cache_read + cache_creation)` do
  estágio `buscaCatalogoInteiro`. Deve ficar próxima de 100% após o 1º item (todos
  reusam o mesmo prefixo). Confirmar pelo log de hash que o `CATALOG_BLOCK` não
  muda entre chamadas da mesma cotação. Qualidade: o conjunto de produtos por
  índice tem de ser idêntico ao baseline (a ordenação muda os índices? — se mudar,
  fixe a ordenação **antes** de gerar o catálogo e regenere `_buscasSalvas`, pois
  os índices são gravados; ver item 5).

> Atenção de qualidade: os índices `i` enviados ao modelo são posições em
> `CATALOG`. Se você reordenar o catálogo, **os índices mudam** e qualquer
> `_buscasSalvas`/`_apelidos` gravado com índices antigos fica errado. Por isso a
> reordenação é segura **somente** se feita uma vez, na geração do catálogo, com
> bump de `versaoCatalogo()` (que já invalida `_buscasSalvas` e `_catInteiroAusentes`).
> `_apelidos` guarda **códigos** (`c`), não índices, então sobrevive — bom.

## 5. Reuso mais agressivo de `_buscasSalvas` — [MEDIR ANTES]

- **Eixo que melhora:** TOKENS e VELOCIDADE (cada acerto de `_buscasSalvas` = 0
  tokens, 0 requisição — `buscasReusadas++`).
- **Eixo em risco:** QUALIDADE/atualidade (reusar um match para uma chave que não
  é *exatamente* o mesmo pedido pode trazer produto errado ou preço velho).
- **Local:** `chaveBusca` (linha ~4817), `_buscasSalvas` lookups em
  `buscaSemantica` (4848), no pipeline `confirmReview` (5192), e a persistência em
  `salvarBuscas` (4816, cap 600/400).

```js
function chaveBusca(texto){return _fold(texto.toLowerCase()).trim().replace(/\s+/g,' ');}
function salvarBuscas(){try{let entradas=[..._buscasSalvas.entries()];if(entradas.length>600)entradas=entradas.slice(-400);...}
```

- **Onde está o desperdício:** hoje a chave é o texto cru normalizado. Itens que
  são o **mesmo pedido** com grafia trivialmente diferente ("coca cola 2l" vs
  "coca-cola 2 l" vs "coca cola 2 litros") geram chaves diferentes e refazem a
  busca. E o cap (`slice(-400)`) descarta por ordem de inserção, não por uso —
  buscas muito reusadas podem ser jogadas fora.
- **Mudança proposta (em duas frentes, ambas conservadoras):**
  1. **Canonicalização leve da chave** reusando peças que o app já tem
     (`removerQuantidade`, `_radical`/stems): normalizar separadores e unidades
     equivalentes ("2l"/"2 litros"→"2l") **sem** colapsar atributos que mudam o
     produto (sabor, marca, gramatura). A chave canônica é usada só para *lookup*;
     o texto original continua exibido.
  2. **Cap por uso, não por inserção:** guardar um contador de hits por chave e, ao
     podar, manter as mais reusadas (LRU/LFU) em vez de `slice(-400)`.

```js
// exemplo de canonicalização CONSERVADORA (não colapsa marca/sabor/gramatura)
function chaveBuscaCanon(texto){
  let t=chaveBusca(texto);
  t=t.replace(/(\d+)\s*(l|lt|litros?)\b/g,'$1l').replace(/(\d+)\s*(kg|quilos?)\b/g,'$1kg')
     .replace(/(\d+)\s*(g|gr|gramas?)\b/g,'$1g').replace(/(\d+)\s*(ml)\b/g,'$1ml');
  return t.replace(/\s+/g,' ').trim();
}
```

- **Por que o ganho pode NÃO custar qualidade:** a canonicalização só funde grafias
  que descrevem **o mesmo produto físico** (mesma unidade escrita de formas
  diferentes). Atributos que distinguem produto (marca, sabor, cor, gramatura
  numérica) são preservados. Como `_buscasSalvas` é versionado por
  `versaoCatalogo()`, preço/produto velho já é invalidado quando o catálogo muda —
  não há risco de preço defasado dentro da mesma versão.
- **Riscos a vigiar (por isso MEDIR ANTES):** uma canonicalização agressiva demais
  funde pedidos diferentes ("leite 1l" vs "leite 1kg" são produtos distintos) e
  serve match errado de cache. Por isso a regra: **na dúvida, NÃO canonicalize** —
  cada par de regras de fusão precisa passar pelo benchmark.
- **Como validar (sem regressão):** (a) rodar o benchmark e confirmar que nenhum
  item passa a receber um resultado de cache diferente do que produziria uma busca
  fresca (comparar `chaveBuscaCanon` contra busca real para uma amostra). (b)
  Observar `buscasReusadas`/chip de reuso subindo entre cotações repetidas no
  mesmo dia. (c) Garantir que recall/ruído do conjunto não muda. Se qualquer item
  receber match diferente da busca fresca → recuar a regra de fusão que causou.

---

# Prioridade 3 — refinos de tokens e aprendizado

## 6. Poda de verbosidade do prompt em `buscaSemanticaLote` — [MEDIR ANTES]

- **Eixo que melhora:** TOKENS (input por lote da haiku — é o estágio que mais roda
  por cotação) e marginal em VELOCIDADE.
- **Eixo em risco:** QUALIDADE (o prompt longo carrega regras de fronteira que
  evitam falsos positivos; cortar errado reabre erros tipo "molho quero" trazendo
  outra marca).
- **Local:** `buscaSemanticaLote` (linha ~4874), bloco do `prompt` (linhas
  4877–4893). O texto de regras (Princípios 1 e 2, exemplos) é repetido a **cada
  lote** — para a haiku, default, `LOTE_BUSCA=15`.

- **Onde há gordura sem valor de qualidade:**
  1. **Exemplos redundantes** entre Princípio 1 e Princípio 2 (vários exemplos de
     "molho quero"/"trident morango" que ilustram a mesma regra).
  2. A linha de abreviações é repetida; várias abreviações (`ext`, `temp`) quase
     não aparecem nos candidatos reais — manter só as que de fato ocorrem.
  3. Frases explicativas longas ("MAS se o cliente ESPECIFICOU... ela vira
     FILTRO...") podem ficar mais densas sem perder a regra.
- **Mudança proposta:** comprimir mantendo **as duas regras-âncora intactas**
  (fronteira = marca + tipo; variação especificada = filtro / não especificada =
  trazer todas) e **um** exemplo canônico por regra, em vez de vários. Não mexer na
  instrução de isolamento entre pedidos nem no formato JSON de saída. Versão
  enxuta-alvo (ilustrativa):

```text
Especialista em atacado BR. Abrev: abs=absorvente, amac=amaciante, achoc=achocolatado, qj=queijo, ral=ralado, mac=macarrão, "la aco"/"palha aco"=lã de aço, far=farinha.
P1 FRONTEIRA (rígida): só entra se bater MARCA pedida (se houver) E TIPO. Marca/tipo diferente = FORA. Na dúvida, EXCLUA. Ex: "molho quero" → só molho marca Quero.
P2 VARIAÇÃO (cor/sabor/tamanho/aroma): se o cliente especificou, vira FILTRO (só o que bate); se não especificou, traga TODAS. Ex: "trident morango" → só morango.
Trate cada PEDIDO isolado; nunca use índice de um pedido em outro.
```

- **Por que o ganho pode NÃO custar qualidade:** as duas regras que de fato mudam o
  match (fronteira marca+tipo; especificado=filtro) ficam **palavra por palavra**.
  O que sai são exemplos repetidos e abreviações inúteis — informação redundante
  para o modelo. Se o benchmark mostrar empate, é gordura pura.
- **Riscos a vigiar (por isso MEDIR ANTES):** a haiku é mais sensível a corte de
  contexto que a sonnet. Cortar um exemplo que ancorava um caso difícil pode
  reabrir um falso positivo. Por isso só aceitar com o benchmark.
- **Como validar (sem regressão):** rodar o benchmark **no estágio haiku
  isoladamente** (mesmas listas, mesmos candidatos). Comparar, item a item:
  recall **igual ou maior** e ruído **igual ou menor**. Medir `input_tokens` médio
  por lote (deve cair) e confirmar que o nº de itens que "vazam" para o fallback
  sonnet **não aumenta** (se aumentar, a haiku ficou pior e o ganho de tokens
  virou custo de qualidade/velocidade no estágio seguinte — rejeitar).

## 7. Aprendizado de apelido mais agressivo a partir de `correcoes.jsonl` — [GANHO SEGURO no caminho de injeção; MEDIR ANTES se virar candidato pré-IA]

- **Eixo que melhora:** TOKENS e VELOCIDADE (itens com apelido conhecido podem
  pular IA inteira) e QUALIDADE/recall (garante que o código certo sempre aparece).
- **Eixo em risco:** QUALIDADE só se um apelido errado for aprendido — mitigado por
  serem correções **confirmadas por humano**.
- **Local:** `aprenderApelido` (linha ~4820), aplicação em `renderBody` (linha
  ~4946, via `apelidosDe`), e o ponto onde correções humanas hoje viram apelido:
  `confirmarRevisao` (linha ~5338), que só aprende de produtos adicionados
  manualmente na revisão (`p._man && !p._ex`).

```js
function aprenderApelido(termo,cods){const ch=chaveBusca(termo);...for(const c of cods)if(Number.isInteger(c)&&!set.has(c)){set.add(c);mudou=true;}...}
// em confirmarRevisao (5338): aprende só de _man (add manual) e ignora _ex (excluídos)
const _aprender=d.grupos.flatMap(g=>g.produtos).filter(p=>p._man&&!p._ex).map(p=>p.c);if(_aprender.length)aprenderApelido(d.item,_aprender);
```

- **Situação real:** hoje o aprendizado é **efêmero e por dispositivo**
  (`_apelidos` em localStorage, cap 400) e só captura adições manuais da revisão da
  sessão atual. Não existe nenhum `correcoes.jsonl` no app — é um mecanismo novo a
  introduzir, **aditivo** (sem tocar no .html): um log de correções exportável e
  reimportável que semeia `_apelidos` de forma persistente e entre dispositivos.
- **Mudança proposta (toda aditiva, via snippet de console / arquivo):**
  1. **Exportar** cada correção confirmada como linha JSONL. Capturar no mesmo
     ponto de `confirmarRevisao` (5338), incluindo tanto adições (`_man`) quanto
     **remoções** (`_ex`) — remoções viram "anti-apelido" (sinal de
     `esquecerApelido`, linha 4822):

```jsonl
{"termo":"polylar","add":[10432],"rem":[]}
{"termo":"coca 2l","add":[2210],"rem":[2211]}
```

  2. **Importar/semear:** ao subir o app, ler `correcoes.jsonl` (colado/importado)
     e rodar `aprenderApelido(termo, add)` e `esquecerApelido(termo, rem[i])` para
     cada linha — semeando `_apelidos` antes da 1ª cotação. Como `_apelidos` guarda
     **códigos** (`c`), é estável a reordenação de catálogo (ver item 4).
  3. **Reforço por frequência:** se a mesma correção aparecer N vezes no JSONL,
     subir a prioridade do apelido (e protegê-lo da poda do cap 400, hoje
     `slice(-400)` por inserção).

- **Por que é GANHO SEGURO no caminho atual de injeção:** hoje os apelidos são
  **adicionados ao resultado em `renderBody`** (linha 4946) *depois* da busca —
  eles só **acrescentam** o código certo que o usuário já confirmou à mão; nunca
  removem nada que a IA achou. Logo, semear mais apelidos de correções humanas só
  pode **aumentar recall** (o produto certo sempre aparece) sem introduzir ruído de
  IA. É exatamente o que o usuário já validou manualmente, agora persistido.
- **Onde vira MEDIR ANTES:** se você usar os apelidos para **pular a IA** (curto-
  circuito: item com apelido conhecido → não chama haiku/sonnet/fallback), aí o
  risco é deixar de trazer *outras* opções legítimas que o cliente compara (o app é
  feito para listar opções em aberto, não só "a melhor"). Nesse caso, medir antes:
  o apelido deve **somar** ao resultado da busca, não **substituí-lo**, a menos que
  o benchmark mostre que para aquele termo o apelido cobre 100% das opções
  esperadas.
- **Como validar (sem regressão):**
  - *Caminho seguro (injeção pós-busca):* confirmar que, para termos com correção
    importada, o código corrigido **sempre** aparece no resultado (recall do termo
    = 100%) e que **nenhum** código que a IA trazia some (ruído inalterado). Medir
    `cacheTokensSaved`/`buscasReusadas` e nº de itens que caem no fallback (deve
    cair, pois mais itens já vêm "resolvidos").
  - *Caminho com curto-circuito (pular IA):* rodar o benchmark e exigir que recall
    **não caia** para esses termos (não pode perder opções em aberto). Só ativar o
    pulo de IA por termo onde o gabarito confirma que o apelido cobre todas as
    opções. Se cobrir parcialmente → manter o pulo desligado e usar só injeção.

---

# Resumo de priorização

| # | Item | Eixo que melhora | Eixo em risco | Classe |
|---|------|------------------|---------------|--------|
| 1 | `cutucarCache` `max_tokens:0` | TOKENS | nenhum | GANHO SEGURO |
| 2 | OCR 2+1 condicional (coerência + divergência por conteúdo) | VELOCIDADE, TOKENS | qualidade transcrição (controlada) | GANHO SEGURO |
| 3 | Batch do `buscaCatalogoInteiro` | VELOCIDADE, TOKENS | qualidade (vazamento/parse) | MEDIR ANTES |
| 4 | Estabilidade do prefixo `CATALOG_BLOCK` | TOKENS, VELOCIDADE | nenhum (com bump de versão) | GANHO SEGURO |
| 5 | Reuso agressivo de `_buscasSalvas` | TOKENS, VELOCIDADE | qualidade/atualidade | MEDIR ANTES |
| 6 | Poda de verbosidade `buscaSemanticaLote` | TOKENS | qualidade (haiku sensível) | MEDIR ANTES |
| 7 | Apelidos via `correcoes.jsonl` | TOKENS, VELOCIDADE, QUALIDADE | qualidade só se pular IA | GANHO SEGURO (injeção) / MEDIR ANTES (curto-circuito) |

Ordem de execução recomendada: **1, 4, 2** (seguros, destravam medição limpa de
cache/tokens) → **7-injeção** (seguro, melhora recall e reduz fallback) → **3**
(maior ganho de tokens/velocidade, mas precisa do benchmark já calibrado) → **5,
6** (refinos finos, decididos só pelo benchmark).

---

# Apêndice — snippet de console para o benchmark (instrumentação de TOKENS)

Cole no console **antes** de uma cotação. Não altera o app; só observa `usage` de
cada resposta (o app só guarda `cache_read` hoje). Permite validar todos os itens
acima por eixo.

```js
// === bench de tokens (somente leitura) ===
window.__bench = {req:0, in:0, out:0, cread:0, ccreate:0, porModelo:{}};
(function(){
  const _orig = window.fetch;
  window.fetch = async function(url, opt){
    const isMsg = typeof url==='string' && url.includes('/v1/messages');
    let modelo='?'; try{ if(isMsg&&opt&&opt.body) modelo=JSON.parse(opt.body).model; }catch(e){}
    const r = await _orig.apply(this, arguments);
    if(isMsg){
      try{
        const clone = r.clone(); const j = await clone.json(); const u = j.usage||{};
        const b = window.__bench; b.req++;
        b.in += u.input_tokens||0; b.out += u.output_tokens||0;
        b.cread += u.cache_read_input_tokens||0; b.ccreate += u.cache_creation_input_tokens||0;
        const m = b.porModelo[modelo] = b.porModelo[modelo]||{req:0,in:0,out:0,cread:0,ccreate:0};
        m.req++; m.in+=u.input_tokens||0; m.out+=u.output_tokens||0;
        m.cread+=u.cache_read_input_tokens||0; m.ccreate+=u.cache_creation_input_tokens||0;
      }catch(e){}
    }
    return r;
  };
  console.log('bench ligado — rode a cotação e depois: console.table(window.__bench.porModelo); console.log(window.__bench)');
})();
```

Leituras-chave para cada eixo após uma cotação:

- **VELOCIDADE:** `__bench.req` (total de requisições) e `req` por modelo. Itens 3
  e 7 devem reduzir `req`. Compare também `_msgDiaN` e `buscasReusadas`.
- **TOKENS:** `__bench.in` / `out` / `cread` / `ccreate`. Item 1 zera `out` do
  cutucão; item 4 maximiza `cread` e minimiza `ccreate`; itens 3 e 6 reduzem `in`.
- **QUALIDADE:** fora do snippet — comparar, item a item contra o gabarito, recall
  (códigos certos trazidos / esperados) e ruído (códigos errados / total). Nenhum
  item do backlog é aceito se recall cair ou ruído subir.
