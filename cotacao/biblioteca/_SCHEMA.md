# Biblioteca versionada do Atacaderj — _SCHEMA

Este diretorio e a **ponte de conhecimento** entre o navegador (onde o app `cotacao_ia_oficial.html` roda 100% client-side e guarda tudo em `localStorage`) e o repositorio versionado (git). O objetivo e **acumular conhecimento** — apelidos, buscas, falhas e correcoes — de forma duravel, auditavel e compartilhavel entre dispositivos, alimentando o loop de melhoria dos 3 eixos: **VELOCIDADE**, **QUALIDADE** e **TOKENS**.

> O app **nao foi modificado**. Estes arquivos sao **aditivos**. O fluxo e:
> 1. Operador abre o app, trabalha normalmente (o app grava no `localStorage`).
> 2. Roda `ferramentas/exportar-biblioteca.js` no Console do DevTools -> baixa os JSONs deste diretorio.
> 3. Commita os JSONs no repo (versionamento, diff, review, merge entre dispositivos).
> 4. Em outro dispositivo (ou apos curadoria), roda `ferramentas/importar-biblioteca.js` -> faz **MERGE** de volta no `localStorage`.

---

## Conceitos de chave (extraidos das funcoes reais do app)

Tres funcoes do app definem como as chaves sao formadas. **Toda ferramenta e todo arquivo desta biblioteca devem respeita-las** para que o import volte a casar com o que o app espera.

### `chaveBusca(texto)` — a chave canonica de um termo
```js
function _fold(s){return s.normalize('NFD').replace(/[̀-ͯ]/g,'');}
function chaveBusca(texto){return _fold(texto.toLowerCase()).trim().replace(/\s+/g,' ');}
```
Ou seja: **minusculas -> sem acento (NFD + remove diacriticos) -> trim -> espacos colapsados em um so**.
- `"Leite Cond."` -> `"leite cond."`
- `"SABAO  EM   PO"` -> `"sabao em po"`
- `"Acucar Refinado"` -> `"acucar refinado"`

E essa string normalizada que vira a **chave** em `_apelidos`, em `_buscasSalvas` e em `_catInteiroAusentes`. Nos JSONs desta biblioteca, sempre que houver um campo `termo`/`chave`/`item`, ele ja deve estar nesse formato canonico.

### `versaoCatalogo()` — a impressao digital do catalogo de precos
```js
function versaoCatalogo(){return CATALOG.length+'_'+CATALOG.reduce((s,p)=>s+p.v,0).toFixed(2);}
```
E `quantidade_de_produtos + '_' + soma_dos_precos_de_venda` (2 casas). Exemplo: `"3187_84211.55"`.
- Muda quando o catalogo muda (preco ou item). Quando muda, **buscas** e **ausentes** ficam invalidos e o app os ignora.
- **Apelidos NAO carregam versao** — sao conhecimento sobre linguagem humana ("leite cond" = leite condensado), independem da tabela de precos e sobrevivem a troca de catalogo.

### Forma de um produto do catalogo (`CATALOG[i]`)
`{ "c": 41800, "p": "AB MISTA JW 1,1KG", "q": 1, "v": 17.89 }` — e opcionalmente `vu` (venda unitaria/varejo), `custo`, `cv`.
- `c` = codigo (inteiro, identificador estavel).
- `p` = descricao do produto no catalogo.
- `q` = quantidade da embalagem/fardo.
- `v` = preco de venda (atacado).
- `vu` = preco varejo (quando existe e difere de `v`).

---

## Mapa: arquivo da biblioteca <-> chave do localStorage <-> variavel do app

| Arquivo | localStorage key | Variavel no app | Versionado? | Cap no app |
|---|---|---|---|---|
| `apelidos.json` | `atacaderj_apelidos` | `_apelidos` (`Map<chave,[codigos]>`) | NAO (independe do catalogo) | 400 entradas |
| `buscas.json` | `atacaderj_buscas` | `_buscasSalvas` (`Map<chave,resultado>`) | SIM (`versaoCatalogo()`) | 600 (poda p/ 400) |
| `ausentes.json` | `atacaderj_ausentes` | `_catInteiroAusentes.set` (`Set<chave>`) | SIM | 300 |
| `correcoes.jsonl` | *(nao existe no app hoje)* | *(novo conceito desta biblioteca)* | SIM (campo por linha) | append-only |
| *(catalogo)* | `atacaderj_catalogo` | override de `CATALOG` | a versao **e** ele | — |

> `atacaderj_catalogo` (`{produtos:[{c,p,q,v,vu}], data}`) e a tabela de precos. Esta biblioteca **le** esse override (para registrar contra qual `versao_catalogo` o conhecimento foi capturado), mas **nao versiona o catalogo em si** aqui — ele e grande, muda inteiro de uma vez e tem seu proprio fluxo de atualizacao no app (`confirmarCatalogo`, que ao trocar o catalogo **limpa** `atacaderj_buscas` e `atacaderj_ausentes`, mas **preserva** `atacaderj_apelidos`).

---

## `apelidos.json`

Espelha `localStorage['atacaderj_apelidos']`, que o app le/grava como `{entradas:[[chave,[codigos]]]}` (veja `carregarApelidos`/`salvarApelidos`). E o dicionario de **linguagem do balcao -> codigos do catalogo**, aprendido por `aprenderApelido(termo,cods)` toda vez que o operador confirma um match.

```jsonc
{
  "versao_catalogo": null,          // informativo; apelidos NAO sao filtrados por versao no app
  "atualizado_em": null,            // ISO-8601 do export; meta, ignorado no import
  "entradas": [
    ["leite cond", [12345]],        // [chaveBusca(termo), [codigos inteiros]]
    ["sabao po", [40021, 40022]]
  ]
}
```
- **Campos**:
  - `entradas[i][0]` = `termo` ja normalizado por `chaveBusca` (minuscula/sem acento/espaco simples).
  - `entradas[i][1]` = lista de **codigos** (`c`), inteiros. Pode ter varios (ex.: "sabao po" cobre as variacoes da marca/tamanho que o operador aceitou).
- **Por que NAO tem versao efetiva**: o app nunca compara `versao` ao carregar apelidos — eles valem para qualquer catalogo. `versao_catalogo` aqui e so rastreabilidade ("foi aprendido sob este catalogo").
- **Eixos**: apelido bate antes da IA -> **VELOCIDADE** (pula requisicao) + **TOKENS** (0 tokens no acerto) + **QUALIDADE** (acerto deterministico do que o humano ja validou).

## `buscas.json`

Espelha `localStorage['atacaderj_buscas']` (`{versao, entradas:[[chave,resultado]]}`, veja `carregarBuscasSalvas`/`salvarBuscas`). E o **cache de resultados de busca semantica** ja resolvidos.

```jsonc
{
  "versao_catalogo": null,          // = versaoCatalogo() do momento da captura; o app SO reusa se bater
  "entradas": [
    [
      "leite condensado",          // chaveBusca(original)
      [                            // resultado = array de GRUPOS
        {
          "nome": "leite condensado",
          "produtos": [            // cada produto = objeto CATALOG[i] completo
            { "c": 12345, "p": "LEITE COND ITALAC 395G", "q": 1, "v": 6.49 }
          ]
        }
      ]
    ]
  ]
}
```
- **Campos**:
  - `entradas[i][0]` = chave (`chaveBusca` do termo original buscado).
  - `entradas[i][1]` = **resultado**: array de grupos `{nome, produtos:[...]}`. Cada item de `produtos` e o objeto de catalogo inteiro (`{c,p,q,v,...}`) — exatamente o que `buscaSemantica` faz com `.map(i=>CATALOG[i])`.
- **Versao**: criticamente versionado. No import, so faz sentido reescrever `atacaderj_buscas` se a `versao_catalogo` do arquivo == `versaoCatalogo()` atual; senao o app descarta na proxima carga (e correto descartar, pois precos podem ter mudado).
- **Eixos**: cache-hit -> **VELOCIDADE** (`buscasReusadas`, 0 latencia de rede) + **TOKENS** (0 tokens). Cuidado: nao deve degradar **QUALIDADE** servindo preco velho — por isso o lock por versao.

## `ausentes.json`

Espelha `localStorage['atacaderj_ausentes']` (`{versao, itens:[chave...]}`, veja `_carregarAusentes`/`_salvarAusentes`). Sao os termos que **nem o fallback do catalogo inteiro** (`buscaCatalogoInteiro`, sonnet com catalogo cacheado) conseguiu casar.

```jsonc
{
  "versao_catalogo": null,          // versao sob a qual a falha ocorreu
  // FILA PRIORITARIA DE MELHORIA DE QUALIDADE:
  // cada item aqui e uma cotacao que o sistema NAO conseguiu atender de jeito nenhum.
  // E o recall=0 puro. Curar isto (criar apelido, corrigir descricao do catalogo, ou
  // constatar que o produto realmente nao existe) e o trabalho de maior impacto em QUALIDADE.
  "itens": [
    "absorvente noturno xpto",     // chaveBusca de cada termo que falhou
    "detergente neutro 5l marca z"
  ]
}
```
- **Campos**: `itens` = array plano de **chaves** (`chaveBusca`), sem valor associado. No app e um `Set`.
- **Comportamento de cache negativo**: enquanto um termo esta em `ausentes` (mesma versao), o app **nao reabre** o fallback caro para ele (`buscaCatalogoInteiro` retorna `[]` na hora). Isso protege **VELOCIDADE/TOKENS**, mas e exatamente por isso que esses itens **precisam de curadoria humana** — eles ficam "presos" como falha ate alguem agir.
- **Eixos / loop**: esta e a **fila #2 de qualidade**. Acao ideal: para cada item, decidir entre (a) criar um apelido (`apelidos.json`), (b) corrigir/enriquecer a descricao no catalogo, ou (c) marcar como inexistente. Resolver remove o termo daqui no proximo ciclo.

## `correcoes.jsonl`

**NOVO conceito — nao existe no app hoje.** Log **append-only** (JSON Lines: um objeto JSON por linha) das **correcoes do operador**: situacoes em que a IA devolveu um match e o humano disse "esse codigo esta errado, o certo e aquele". E a **materia-prima #1 da melhoria de QUALIDADE**, porque cada linha e um par rotulado (errado, certo) — combustivel direto para virar apelido, ajustar prompt/abreviacoes, ou medir regressao.

Formato (uma linha = um objeto, sem virgula entre linhas, sem array externo):
```jsonl
{"termo":"leite cond","codigo_errado":99999,"codigo_certo":12345,"data":"2026-06-20T14:32:00-03:00"}
{"termo":"sabao po","codigo_errado":40099,"codigo_certo":40021,"data":"2026-06-22T09:10:00-03:00"}
```
- **Campos por linha**:
  - `termo` — o que o operador buscou, ja em `chaveBusca` canonico.
  - `codigo_errado` — o `c` que a IA sugeriu e o humano rejeitou (pode ser `null` se a IA nao sugeriu nada, mas o humano sabia o certo).
  - `codigo_certo` — o `c` correto, escolhido pelo humano.
  - `data` — ISO-8601 do momento da correcao.
- **Por que JSONL e nao JSON**: append-only sem reescrever o arquivo, merge trivial (concatena linhas), diffs de git limpos (cada correcao e uma linha). Nunca se apaga uma linha; o historico e o ativo.
- **Como vira melhoria** (loop): cada `(termo -> codigo_certo)` deveria virar/reforcar um **apelido** (`aprenderApelido`), e cada `codigo_errado` recorrente para um `termo` e candidato a `esquecerApelido` ou a regra de fronteira no prompt. Tambem serve de **conjunto de teste**: rodar a busca de novo e exigir que `codigo_certo` apareca e `codigo_errado` nao.

---

## Politica de merge (resumo — detalhe no `importar-biblioteca.js`)

- **apelidos**: **uniao por termo**. Para cada chave, une os conjuntos de codigos (nunca apaga codigo existente). Mantem o cap de 400 do app (poda os mais antigos).
- **buscas**: so importa as entradas cuja `versao_catalogo` == versao atual; uniao por chave (na colisao, mantem a do disco/repo, que e a curada). Cap 600.
- **ausentes**: uniao por versao; se a versao do arquivo != atual, ignora. Cap 300.
- **correcoes**: **append-only**; o import nunca escreve em `localStorage` (o app nao tem essa chave) — `correcoes.jsonl` e curado/consumido fora do app, no loop.
- **Regra de ouro**: nenhum merge pode degradar nenhum eixo. Por isso buscas/ausentes sao travados por versao (nao servir preco velho) e apelidos so crescem por uniao (nao perder conhecimento).
