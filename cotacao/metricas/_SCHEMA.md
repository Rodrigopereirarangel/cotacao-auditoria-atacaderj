# Schema das métricas por rodada

Este documento descreve o **JSON de métricas** que cada rodada do LOOP DE MELHORIA produz
(ver `docs/LOOP-DE-MELHORIA.md`). Há **um arquivo por rodada**, nomeado:

```
metricas/rodada-NNN-<slug>.json      (ex.: metricas/rodada-000-baseline.json)
```

onde `NNN` é o número da rodada com zero à esquerda (`000`, `001`, ...) e `<slug>` é um apelido
curto da mudança (ex.: `fuzzy-mais-candidatos`, `cache-quente`, `lote-cheio`).

O JSON tem **duas partes**: um **cabeçalho** (quem/quando/o quê/veredito) e os **3 eixos** medidos.
Todos os campos são obrigatórios, exceto os marcados como *opcionais*.

---

## 1. Cabeçalho

| Campo                 | Tipo    | Descrição                                                                 |
|-----------------------|---------|---------------------------------------------------------------------------|
| `rodada`              | inteiro | Número da rodada (`0` = baseline). Bate com o `NNN` do nome do arquivo.    |
| `data`               | string  | Data/hora da medição em ISO 8601 (`2026-06-29T14:30:00-03:00`).           |
| `commit`              | string  | Hash (ou `"-"` se ainda não commitado / se revertida).                    |
| `descricao_mudancas`  | string  | O que mudou nesta rodada, em pt-BR. Em rodada `revertida`: também **qual eixo regrediu e por quê**. |
| `eixo_alvo`           | string  | Eixo que esta rodada tentou melhorar: `"qualidade"`, `"tokens"`, `"velocidade"` ou `"baseline"`. |
| `alavanca`            | string  | Alavanca da Etapa 3 usada: `"A"`/`"B"`/`"C"` ou `"-"` no baseline.        |
| `golden_set`          | string  | Nome/versão do conjunto de cotações de teste usado (deve ser o mesmo entre rodadas comparadas). |
| `n_cotacoes`          | inteiro | Quantas cotações/listas do golden set foram medidas.                      |
| `baseline_ref`        | string  | Nome do arquivo da baseline vigente contra a qual esta rodada foi comparada (`"-"` no baseline). |
| `veredito`            | string  | `"baseline"` \| `"aceita"` \| `"revertida"`. Decidido pelo gate da Etapa 4. |
| `baseline_a_confirmar`| booleano| *Opcional.* `true` quando os números foram **estimados**, não medidos. Some quando houver medição real. |
| `observacoes`         | string  | *Opcional.* Notas livres (rate limits, anomalias, ressalvas de medição).  |

---

## 2. Eixo VELOCIDADE — `velocidade`

Quão rápido e com quantas idas à API uma cotação é resolvida. **Direção boa: descer**
(exceto `cache_hit_rate`, que deve **subir**).

| Campo                      | Tipo   | Unidade   | Descrição                                                                 |
|----------------------------|--------|-----------|---------------------------------------------------------------------------|
| `requisicoes_por_cotacao`  | número | reqs      | Média de chamadas `apiCall` por cotação (separar + interpretar + lotes haiku + fallback sonnet). |
| `latencia_ms_p50`          | número | ms        | Mediana do tempo de ponta a ponta de uma cotação.                         |
| `latencia_ms_p95`          | número | ms        | Percentil 95 (cauda; dominado pelo fallback serializado `_filaCatalogoInteiro`). |
| `cache_hit_rate`           | número | 0..1      | Fração das chamadas que tiveram `cache_read_input_tokens > 0` (via `trackCache`). Ex.: `0.62`. |

> **Por que estes campos:** `requisicoes_por_cotacao` captura o custo de ida-e-volta (cada item no
> `buscaCatalogoInteiro` é 1 req em fila — o maior dreno de p95). `cache_hit_rate` mede se o
> `CATALOG_BLOCK` (cache ephemeral ttl 1h) está quente.

---

## 3. Eixo TOKENS — `tokens`

Quantos tokens uma cotação consome. **Direção boa: descer** (`cache_read` pode subir — é o token
barato que substitui input caro). Valores são **médias por cotação**.

| Campo               | Tipo   | Unidade | Descrição                                                                       |
|---------------------|--------|---------|---------------------------------------------------------------------------------|
| `input`             | número | tokens  | Soma de `usage.input_tokens` (NÃO-cacheado) por cotação.                         |
| `output`            | número | tokens  | Soma de `usage.output_tokens` por cotação.                                       |
| `cache_read`        | número | tokens  | Soma de `usage.cache_read_input_tokens` por cotação (o que `trackCache` acumula em `cacheTokensSaved`). |
| `total_por_cotacao` | número | tokens  | Total efetivo por cotação. Convenção: `input + output + cache_read`. **É o número que o gate de não-regressão compara.** |

> **Por que estes campos:** separar `input` de `cache_read` deixa explícito o efeito do cache do
> catálogo inteiro — uma boa rodada faz `input` cair e `cache_read` subir, com `total_por_cotacao`
> caindo. `output` pega prompts verbosos (ex.: JSON grande de `buscaSemanticaLote`).
>
> *Opcional:* pode-se acrescentar `cache_write` (tokens de escrita do cache na 1ª chamada) se for
> relevante para o diagnóstico; não entra no `total_por_cotacao` por convenção.

---

## 4. Eixo QUALIDADE — `qualidade`

Quão certo é o match. **Direção boa: subir.** `precisao` e `recall` em **porcentagem** (0..100).

| Campo              | Tipo   | Unidade | Descrição                                                                          |
|--------------------|--------|---------|------------------------------------------------------------------------------------|
| `precisao`         | número | %       | Dos produtos que o sistema retornou, quantos % estavam corretos (sem trazer lixo/marca errada). |
| `recall`           | número | %       | Dos produtos corretos que existiam no catálogo, quantos % o sistema trouxe.         |
| `acertos`          | inteiro| itens   | Quantos itens do golden set tiveram match correto.                                 |
| `total`            | inteiro| itens   | Total de itens avaliados no golden set.                                             |
| `erros_corrigidos` | inteiro| itens   | Itens que o usuário precisou corrigir manualmente (gera `aprenderApelido`). Quanto MENOR, melhor. |

> **Por que estes campos:** `precisao` guarda contra o erro mais caro do atacarejo (trazer a marca
> ou o tipo errado — o PRINCÍPIO 1 de fronteira do prompt). `recall` mede o que escapa para o
> `atacaderj_ausentes`. `erros_corrigidos` é um sinal de campo: cada correção vira apelido aprendido
> e mostra onde a busca semântica erra sistematicamente.
>
> *Opcional:* `itens_no_fallback` (quantos itens precisaram de `buscaCatalogoInteiro`) e
> `itens_ausentes` (quantos foram parar em `atacaderj_ausentes`) ajudam o diagnóstico, mesmo não
> entrando direto no gate.

---

## 5. O gate de não-regressão usa estes campos

O gate da Etapa 4 compara, campo a campo, a rodada N com a `baseline_ref`, com tolerâncias:

| Campo comparado                         | Regride se...                          |
|-----------------------------------------|----------------------------------------|
| `qualidade.precisao`                    | cair > 0.5 ponto percentual            |
| `qualidade.recall`                      | cair > 0.5 ponto percentual            |
| `tokens.total_por_cotacao`              | subir > 2%                             |
| `velocidade.requisicoes_por_cotacao`    | subir > 2%                             |
| `velocidade.latencia_ms_p95`            | subir > 5%                             |
| `velocidade.cache_hit_rate`             | cair > 1 ponto percentual              |

Se **qualquer** linha acima dispara → `veredito: "revertida"` e desfaz-se a mudança ofensora.
Só vira `"aceita"` quando **nenhuma** dispara **e** pelo menos um eixo melhora fora do empate.

---

## 6. Forma do JSON (referência)

```json
{
  "rodada": 0,
  "data": "2026-06-29T00:00:00-03:00",
  "commit": "-",
  "descricao_mudancas": "Baseline do app atual, sem alterações.",
  "eixo_alvo": "baseline",
  "alavanca": "-",
  "golden_set": "golden-v1",
  "n_cotacoes": 30,
  "baseline_ref": "-",
  "veredito": "baseline",
  "baseline_a_confirmar": true,
  "observacoes": "Valores estimados; confirmar com medição real antes da rodada 001.",
  "velocidade": {
    "requisicoes_por_cotacao": 0,
    "latencia_ms_p50": 0,
    "latencia_ms_p95": 0,
    "cache_hit_rate": 0
  },
  "tokens": {
    "input": 0,
    "output": 0,
    "cache_read": 0,
    "total_por_cotacao": 0
  },
  "qualidade": {
    "precisao": 0,
    "recall": 0,
    "acertos": 0,
    "total": 0,
    "erros_corrigidos": 0
  }
}
```

> **Regras de preenchimento:**
> - Sempre o **mesmo `golden_set`** entre rodadas que serão comparadas.
> - Médias **por cotação** nos eixos tokens/velocidade (divida o total pelo `n_cotacoes`).
> - `precisao`/`recall` em **%** (0..100), não em fração.
> - Rodada `revertida` ainda é arquivada (registro do experimento), mas **não** vira baseline.
