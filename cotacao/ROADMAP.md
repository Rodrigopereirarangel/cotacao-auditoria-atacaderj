# Roadmap — Atacaderj-Cotacao-Loop

O roadmap e uma sequencia de **rodadas**. Cada rodada puxa 1-2 itens de
[`docs/BACKLOG-OTIMIZACOES.md`](docs/BACKLOG-OTIMIZACOES.md) e so e dada como
concluida se passar pelo **gate dos 3 eixos** (a regra de ouro): nenhuma rodada
pode piorar **velocidade**, **qualidade** ou **tokens**, e pelo menos um eixo
melhora. O processo de cada rodada esta em
[`docs/COMO-RODAR-UMA-RODADA.md`](docs/COMO-RODAR-UMA-RODADA.md).

Legenda: `[x]` feita - `[ ]` planejada - `[GANHO SEGURO]` / `[MEDIR ANTES]` vem
do backlog.

---

## [x] Rodada 0 — Baseline registrada

**Estado:** feita. Baseline em
[`metricas/rodada-000-baseline.json`](metricas/rodada-000-baseline.json).

- Estrutura do repo, biblioteca versionada, benchmark, validador e CI no lugar.
- Baseline dos 3 eixos registrado para uma cotacao tipica (~30 itens).
- **Ressalva:** os valores estao marcados `baseline_a_confirmar=true` (estimados
  a partir do comportamento do app). **A Rodada 1 comeca confirmando-os com
  medicao real** antes de qualquer comparacao de gate.

## [ ] Rodada 1 — Confirmar baseline real + cache warming seguro

- **Pre-requisito:** medir o baseline real (Etapa 2 do checklist) e marcar
  `baseline_a_confirmar=false` em `rodada-000-baseline.json`.
- **Backlog:** item 1 — `cutucarCache` trocar `max_tokens:1` por `max_tokens:0`
  **[GANHO SEGURO]**.
- **Eixo-alvo:** tokens (zera o output do cutucao). Em risco: nenhum.
- **Gate:** qualidade e velocidade inalteradas; tokens caem. Reverter e inocuo se
  o proxy nao aceitar `max_tokens:0`.

## [ ] Rodada 2 — Estabilidade do prefixo do catalogo

- **Backlog:** item 4 — estabilizar o prefixo do `CATALOG_BLOCK` (ordem estavel +
  congelar a string + log de hash) **[GANHO SEGURO]**.
- **Eixo-alvo:** tokens e velocidade (mais `cache_read`, menos `cache_creation`).
- **Gate:** razao `cache_read/(cache_read+cache_creation)` sobe; conjunto de
  produtos por indice identico ao baseline (cuidado: reordenar muda indices —
  exige bump de `versaoCatalogo()`, que invalida `buscas.json`/`ausentes.json`).

## [ ] Rodada 3 — OCR 2+1 coerente

- **Backlog:** item 2 — tornar `N_LEITURAS=3` coerente com o fluxo 2 leituras + 3a
  condicional, trocando igualdade exata por divergencia de conteudo normalizada
  **[GANHO SEGURO]**.
- **Eixo-alvo:** velocidade e tokens (economiza 1 leitura de imagem em listas
  legiveis). Em risco: qualidade da transcricao (controlada).
- **Gate:** lista de itens parseada identica item a item ao baseline; menos
  chamadas a leitura de imagem.

## [ ] Rodada 4 — Aprendizado de apelido via correcoes (injecao)

- **Backlog:** item 7 — semear apelidos a partir de `biblioteca/correcoes.jsonl`
  **somente no caminho de injecao pos-busca** **[GANHO SEGURO]** (o curto-circuito
  que pula a IA fica para uma rodada [MEDIR ANTES] futura).
- **Eixo-alvo:** qualidade/recall (o codigo certo sempre aparece) + tokens/
  velocidade (menos itens caem no fallback).
- **Gate:** para termos com correcao, recall do termo = 100% e nenhum codigo que a
  IA trazia some (ruido inalterado).

## [ ] Rodada 5 — Batch do fallback (catalogo inteiro)

- **Backlog:** item 3 — `buscaCatalogoInteiroLote` (N pedidos por leitura cacheada
  do `CATALOG_BLOCK`, com fallback 1-a-1 para itens faltantes) **[MEDIR ANTES]**.
- **Eixo-alvo:** velocidade (de 1 req/item para 1 req/lote no fallback) e tokens
  (um `cache_read` do catalogo serve varios itens). Em risco: qualidade
  (vazamento entre pedidos) e robustez (parse do lote).
- **Gate:** recall nao cai e ruido nao sobe **item a item** vs 1-a-1; requisicoes
  do estagio fallback caem; `cache_creation` nao aumenta. So entra com o benchmark
  ja calibrado pelas rodadas anteriores.

## [ ] Rodada 6 — Refinos finos (decididos pelo benchmark)

- **Backlog:** item 5 — reuso mais agressivo de `buscas.json`
  (canonicalizacao conservadora da chave + cap por uso) **[MEDIR ANTES]**; e
  item 6 — poda de verbosidade do prompt da haiku, mantendo as 2 regras-ancora
  literais **[MEDIR ANTES]**.
- **Eixo-alvo:** tokens (input por lote) e velocidade (mais reuso). Em risco:
  qualidade (canonicalizacao agressiva funde pedidos distintos; haiku e sensivel a
  corte de contexto).
- **Gate:** nenhum item passa a receber match de cache diferente do de uma busca
  fresca; recall igual/maior e ruido igual/menor; itens que vazam para o fallback
  nao aumentam.

---

## Como uma rodada "fica feita"

Uma rodada `NNN` so e marcada `[x]` quando:

1. existe `metricas/rodada-NNN.json` com `veredito="aprovada"`;
2. os 3 eixos ficaram **iguais ou melhores** que o baseline (e pelo menos um
   melhorou);
3. o PR passou no CI (`.github/workflows/validar.yml`) e foi mesclado na `main`.

A rodada aprovada vira o **novo baseline** da rodada seguinte. As rodadas 1..6
acima sao uma proposta; a ordem pode mudar conforme o que o benchmark revelar — o
que **nao** muda e o gate: nenhuma volta pode piorar nenhum dos 3 eixos.
