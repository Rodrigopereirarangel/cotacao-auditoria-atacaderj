# Atacaderj-Cotacao-Loop

Conhecimento versionado e **loop de melhoria** para o app de cotacao do Atacaderj
(`cotacao_ia_oficial.html`).

---

## 1. O que e este repo e qual problema ele resolve

O app de cotacao por IA do Atacaderj faz o match entre uma lista de compras
(colada ou fotografada) e o catalogo (~4427 produtos). Quando a busca em lote
(haiku) nao resolve um item, ele cai no **fallback** do catalogo inteiro
(sonnet, com o `CATALOG_BLOCK` cacheado). Ao confirmar matches, o app **aprende**:
grava apelidos, buscas reusaveis e as falhas do fallback.

**O problema:** todo esse aprendizado e toda a biblioteca de conhecimento viviam
**so no `localStorage` do navegador** — um unico dispositivo, sem versao, sem
revisao, sem backup, sem como medir se uma mudanca melhorou ou piorou. Um
apelido errado contaminava silenciosamente todas as cotacoes seguintes, e
ninguem conseguia provar se uma "otimizacao" tinha deixado o app mais rapido,
mais barato ou mais certeiro.

**O que este repo faz:** tira a biblioteca e o fallback do navegador e os
transforma em **conhecimento versionado** (arquivos no Git, com historico e
revisao) que **melhora em loop**. Cada rodada de melhoria e medida nos 3 eixos —
velocidade, qualidade e tokens — contra um baseline, com um gate automatico que
**barra qualquer mudanca que piore qualquer um dos tres**.

> O app (`cotacao_ia_oficial.html`) **nao e tocado** por este repo. Tudo aqui e
> aditivo: biblioteca exportavel/importavel, benchmark, metricas, backlog,
> validacao e CI.

---

## 2. Estrutura de pastas

```
Atacaderj-Cotacao-Loop/
|
|-- README.md                          # este arquivo: porta de entrada do repo
|-- ROADMAP.md                         # rodadas planejadas (0..N), cada uma puxa item(ns) do backlog
|-- .gitignore                         # ignora node_modules, lixo de OS e segredos (.env, chaves)
|
|-- biblioteca/                        # o CONHECIMENTO versionado (espelha o localStorage do app)
|   |-- _SCHEMA.md                     # contrato de cada arquivo da biblioteca + regras de merge
|   |-- apelidos.json                  # termo -> [codigos]; conhecimento de linguagem (sem versao efetiva)
|   |-- buscas.json                    # chaveBusca -> resultado; travado por versaoCatalogo() p/ nao servir preco velho
|   |-- ausentes.json                  # chaves que NEM o catalogo inteiro achou (as falhas do fallback)
|   |-- correcoes.jsonl                # log append-only de correcoes manuais; materia-prima #1 de qualidade
|
|-- ferramentas/                       # a ponte navegador <-> repo e a validacao
|   |-- exportar-biblioteca.js         # snippet de console: le o localStorage e gera os JSON da biblioteca
|   |-- importar-biblioteca.js         # snippet de console: faz MERGE por uniao da biblioteca no localStorage
|   |-- validar-biblioteca.mjs         # valida schema/duplicatas/orfaos/JSONL; sai != 0 se inconsistente
|
|-- benchmark/                         # o harness que mede os 3 eixos
|   |-- README.md                      # como medir velocidade, qualidade e tokens (modo navegador e Node)
|   |-- golden-set.exemplo.jsonl       # casos-ouro de exemplo (abreviacoes/typos reais de atacarejo)
|   |-- avaliar.mjs                    # calcula precisao/recall/F1 vs golden-set; emite VEREDITO por eixo
|
|-- metricas/                          # o registro historico (uma rodada = um arquivo)
|   |-- _SCHEMA.md                     # cabecalho + os 3 eixos com os campos exatos + tabela de tolerancias
|   |-- rodada-000-baseline.json       # baseline da Rodada 0 (valores a confirmar com medicao real)
|
|-- docs/                              # a documentacao do processo
|   |-- LOOP-DE-MELHORIA.md            # o loop completo (Etapas 0-6), as 3 alavancas e o gate de nao-regressao
|   |-- COMO-RODAR-UMA-RODADA.md       # checklist operacional do inicio ao fim de UMA rodada
|   |-- BACKLOG-OTIMIZACOES.md         # backlog priorizado de otimizacoes (cada item: eixo que melhora/em risco)
|   |-- AUTOMACAO.md                   # por que o CI protege cada rodada e o fluxo branch -> PR -> CI -> merge
|
|-- .github/
|   |-- workflows/
|       |-- validar.yml                # CI: roda o validador + benchmark estatico em PR e push (sem segredos)
```

---

## 3. O loop, em passos

Resumo de uma volta completa. A descricao detalhada (objetivo/entradas/saidas/
criterio de aceite de cada etapa) esta em
[`docs/LOOP-DE-MELHORIA.md`](docs/LOOP-DE-MELHORIA.md).

1. **Medir o baseline.** Rodar o benchmark sobre o golden-set e registrar os 3
   eixos no `metricas/` (a Rodada 0 ja deixou o baseline registrado).
2. **Escolher uma melhoria.** Puxar 1-2 itens de
   [`docs/BACKLOG-OTIMIZACOES.md`](docs/BACKLOG-OTIMIZACOES.md), sabendo qual eixo
   ele melhora e qual ele poe em risco.
3. **Aplicar a alavanca.** Mexer em **A) qualidade** (melhorar candidatos/filtros
   para tirar itens do fallback caro), **B) tokens** (mais `cache_read`, menos
   `input`) ou **C) velocidade** (menos requisicoes serializadas, mais cache-hit).
4. **Re-medir.** Rodar o benchmark de novo, nas mesmas condicoes, e gerar
   `metricas/rodada-NNN.json`.
5. **Passar pelo gate (a regra de ouro).** Comparar a rodada contra o baseline:
   se **qualquer** eixo regrediu, **reverter exatamente a mudanca ofensora** e
   voltar ao passo 2.
6. **Promover e virar baseline.** Se nenhum eixo piorou e pelo menos um melhorou,
   a rodada e aprovada (via PR + CI verde) e vira o novo baseline para a proxima
   volta.

O conhecimento aprendido (apelidos, correcoes) e exportado do navegador, validado
e versionado a cada rodada — entao cada volta parte de uma base **melhor e
confiavel**, nunca de um estado corrompido.

---

## 4. A REGRA DE OURO

> ### Nenhuma rodada pode piorar VELOCIDADE, QUALIDADE **OU** TOKENS.
>
> Uma rodada so e aprovada se os **tres eixos** ficam **iguais ou melhores** que
> o baseline — e pelo menos **um** melhora. Melhorar um eixo as custas de outro
> **nao conta como melhoria**: e regressao, e o gate reprova.
>
> | Eixo | O que nao pode acontecer |
> |------|--------------------------|
> | **Velocidade** | requisicoes por cotacao subir, p95 subir, ou cache-hit cair |
> | **Qualidade** | precisao ou recall cair |
> | **Tokens** | total por cotacao (input + output + cache_read) subir |
>
> Quando um eixo regride: **reverter EXATAMENTE a mudanca ofensora** e voltar a
> escolher do backlog. As tolerancias exatas estao em
> [`docs/LOOP-DE-MELHORIA.md`](docs/LOOP-DE-MELHORIA.md) e em
> [`metricas/_SCHEMA.md`](metricas/_SCHEMA.md).

---

## 5. Como comecar a Rodada 1

A Rodada 0 ja deixou o baseline registrado em
`metricas/rodada-000-baseline.json` (com valores estimados marcados
`baseline_a_confirmar=true`). O **primeiro passo da Rodada 1 e confirmar esse
baseline com medicao real** — sem baseline honesto, o gate nao tem contra o que
comparar.

Passo a passo curto (detalhe completo em
[`docs/COMO-RODAR-UMA-RODADA.md`](docs/COMO-RODAR-UMA-RODADA.md)):

1. **Crie o branch da rodada:**
   ```bash
   git switch -c rodada/001
   ```
2. **Exporte a biblioteca do navegador.** Abra o app, cole
   `ferramentas/exportar-biblioteca.js` no console e salve a saida em
   `biblioteca/apelidos.json`, `biblioteca/buscas.json` e
   `biblioteca/ausentes.json` (anexe correcoes manuais em
   `biblioteca/correcoes.jsonl`).
3. **Meca o baseline real.** Siga `benchmark/README.md` para instrumentar o app e
   rodar o golden-set; rode `node benchmark/avaliar.mjs` para apurar
   precisao/recall. Atualize `metricas/rodada-000-baseline.json` com os numeros
   reais e marque `baseline_a_confirmar=false`.
4. **Escolha 1-2 itens** de `docs/BACKLOG-OTIMIZACOES.md` (comece pelos marcados
   **[GANHO SEGURO]**).
5. **Aplique, re-meca e gere** `metricas/rodada-001.json`.
6. **Valide e passe pelo gate:**
   ```bash
   node ferramentas/validar-biblioteca.mjs biblioteca
   node benchmark/avaliar.mjs
   ```
   Se nenhum eixo regrediu, abra o PR para a `main`. O CI (`validar.yml`) roda o
   validador e o benchmark estatico; com o check verde, faca o merge — a Rodada 1
   vira o novo baseline.
