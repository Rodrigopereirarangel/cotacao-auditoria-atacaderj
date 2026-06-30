# Como rodar UMA rodada — checklist operacional

Checklist do inicio ao fim de **uma** rodada de melhoria. Marque cada caixa.
Visao conceitual do loop: [`LOOP-DE-MELHORIA.md`](LOOP-DE-MELHORIA.md). A regra de
ouro: nenhum dos 3 eixos (velocidade, qualidade, tokens) pode piorar.

Convencao: `NNN` = numero da rodada com 3 digitos (ex.: `001`). O baseline contra
o qual voce compara e a **ultima rodada aprovada** (na Rodada 1, e
`metricas/rodada-000-baseline.json`).

---

## Etapa 0 — Preparar o branch e a base

- [ ] Estou na `main` atualizada (`git switch main && git pull`).
- [ ] Criei o branch da rodada: `git switch -c rodada/NNN`.
- [ ] Confirmei qual e o baseline desta rodada (o arquivo `metricas/` da ultima
      rodada aprovada). Na Rodada 1, e `metricas/rodada-000-baseline.json`.
- [ ] **Atencao especial na Rodada 1:** o baseline tem
      `baseline_a_confirmar=true`. Antes de comparar qualquer coisa, **confirme os
      valores com medicao real** (ver Etapa 2) e marque `baseline_a_confirmar=false`.

## Etapa 1 — Exportar e versionar a biblioteca atual

- [ ] Abri o app (`cotacao_ia_oficial.html`) no navegador.
- [ ] Colei `ferramentas/exportar-biblioteca.js` no console e gerei a saida.
- [ ] Salvei/atualizei `biblioteca/apelidos.json`, `biblioteca/buscas.json` e
      `biblioteca/ausentes.json` com a saida do export.
- [ ] Anexei correcoes manuais novas em `biblioteca/correcoes.jsonl`
      (append-only — nunca reescrevo linhas antigas).
- [ ] Rodei o validador e ele saiu **0**:
      `node ferramentas/validar-biblioteca.mjs biblioteca`.
      (Se saiu != 0, corrijo o que o relatorio apontou antes de seguir.)

## Etapa 2 — Medir o baseline (estado ANTES da mudanca)

- [ ] Segui `benchmark/README.md` para preparar a medicao (modo navegador
      instrumentado ou modo Node).
- [ ] Rodei o golden-set (`benchmark/golden-set.exemplo.jsonl` ou meu golden-set
      real) e coletei os 3 eixos:
      - velocidade: `requisicoes_por_cotacao`, `latencia_ms_p50`,
        `latencia_ms_p95`, `cache_hit_rate`;
      - tokens: `input`, `output`, `cache_read`, `total_por_cotacao`;
      - qualidade: `precisao`, `recall`, `acertos`, `total`.
- [ ] Apurei precisao/recall rodando `node benchmark/avaliar.mjs`
      (com `--golden <arquivo>` ou via `entrada.esperados`).
- [ ] Os numeros do baseline estao registrados (na Rodada 1, confirmei
      `metricas/rodada-000-baseline.json` com valores reais e
      `baseline_a_confirmar=false`).

## Etapa 3 — Escolher e aplicar a melhoria

- [ ] Escolhi 1-2 itens de [`BACKLOG-OTIMIZACOES.md`](BACKLOG-OTIMIZACOES.md).
- [ ] Anotei, para cada item, **qual eixo ele melhora** e **qual eixo poe em
      risco** (o backlog ja traz isso por item).
- [ ] Priorizei os itens **[GANHO SEGURO]** antes dos **[MEDIR ANTES]**.
- [ ] Apliquei a mudanca (no app/biblioteca, conforme o item) — **uma mudanca
      rastreavel por vez**, para conseguir reverter exatamente a ofensora se
      preciso.

## Etapa 4 — Re-medir (estado DEPOIS da mudanca)

- [ ] Repeti a Etapa 2 **nas mesmas condicoes** (mesmo golden-set, mesmos
      cenarios FRIO/QUENTE).
- [ ] Gerei o arquivo da rodada `metricas/rodada-NNN.json` seguindo
      [`../metricas/_SCHEMA.md`](../metricas/_SCHEMA.md), preenchendo o cabecalho
      (`rodada`, `data`, `commit`, `descricao_mudancas`, `eixo_alvo`, `alavanca`,
      `golden_set`, `n_cotacoes`, `baseline_ref`).

## Etapa 5 — Passar pelo gate (a regra de ouro)

- [ ] Rodei `node benchmark/avaliar.mjs` comparando rodada vs baseline.
- [ ] Confirmei o veredito por eixo:
      - [ ] **Qualidade** nao caiu (precisao e recall iguais ou maiores).
      - [ ] **Tokens** nao subiram (`total_por_cotacao` igual ou menor).
      - [ ] **Velocidade** nao piorou (requisicoes nao subiram, `p95` nao subiu,
            `cache_hit_rate` nao caiu).
- [ ] **Se QUALQUER eixo regrediu:** reverti **exatamente a mudanca ofensora**,
      registrei `veredito="regressao"` em `metricas/rodada-NNN.json` com o motivo,
      e voltei a Etapa 3 para escolher outra coisa.
- [ ] Se nenhum eixo piorou e pelo menos um melhorou: `veredito="aprovada"`.

## Etapa 6 — Validar, abrir PR e promover

- [ ] Rodei o validador de novo (a biblioteca pode ter mudado nesta rodada):
      `node ferramentas/validar-biblioteca.mjs biblioteca`.
- [ ] Commitei a rodada:
      ```bash
      git add biblioteca/ metricas/rodada-NNN.json
      git commit -m "rodada NNN: <resumo da mudanca>"
      git push -u origin rodada/NNN
      ```
- [ ] Abri o Pull Request para a `main`.
- [ ] O CI (`.github/workflows/validar.yml`) ficou **verde** (validador + benchmark
      estatico passaram).
- [ ] Fiz o merge. `metricas/rodada-NNN.json` aprovado vira o **novo baseline** da
      proxima rodada.

---

### Referencia rapida de comandos

```bash
# validar a biblioteca (igual ao CI)
node ferramentas/validar-biblioteca.mjs biblioteca

# avaliar qualidade e o gate dos 3 eixos
node benchmark/avaliar.mjs --golden benchmark/golden-set.exemplo.jsonl
```

> Lembrete: o validador e o `avaliar.mjs` sao **estaticos** — nao chamam a API,
> nao usam segredos. A medicao real de tokens/latencia exige instrumentar o app
> no navegador (ver `benchmark/README.md`).
