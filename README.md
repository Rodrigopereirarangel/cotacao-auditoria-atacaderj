# Atacaderj — monorepo

Dois sistemas do atacarejo, num repositório só (privado):

| Projeto | Pasta | O que é |
|---|---|---|
| **Precificação** | [`pricing/`](pricing/) | Motor de **precificação semanal de prateleira** (KVI / cauda / ponta de gôndola). Fase de design. |
| **Cotação por IA + loop de melhoria** | [`cotacao/`](cotacao/) | Ferramenta que lê listas de pedido (texto/foto/PDF/Excel) e casa com o catálogo via IA — **com um loop que melhora velocidade, qualidade e tokens a cada rodada, sem abrir mão de nenhum.** |

> Este repositório (`Main`) foi **reaproveitado**: o comparador de ativos da B3 (Streamlit) que vivia aqui foi removido do estado atual da branch — continua **recuperável no histórico do git** (`git log -- app.py`). Agora a branch `main` contém **só** `pricing/` e `cotacao/`, como pedido.

## ⚠️ Privacidade — repositório PRIVADO

O app de cotação (`cotacao/app/cotacao_ia_oficial.html`) traz **o catálogo com ~4,4 mil produtos e preços embutidos**. Por isso o repo é **privado**. **Não torne público** sem antes remover/anonimizar os preços. (Mesma filosofia do `pricing/`: preço e custo não circulam.)

## `cotacao/` — o loop em um parágrafo

A "inteligência" que o app acumula — apelidos aprendidos (`leite cond` → código), buscas resolvidas e **as falhas do fallback** — vivia **só no `localStorage` do navegador**: frágil, num só dispositivo, sem versão. Aqui ela vira **conhecimento versionado** e entra num **loop de 7 etapas**:

**Baseline → Coletar → Diagnosticar → Melhorar → Validar → Consolidar → Repetir.**

A **regra de ouro**: nenhuma rodada pode piorar **velocidade**, **qualidade** ou **tokens**. Um gate automático (`cotacao/benchmark/avaliar.mjs`) **reprova a rodada** se qualquer um dos três eixos regredir além da tolerância.

- Loop detalhado: [`cotacao/docs/LOOP-DE-MELHORIA.md`](cotacao/docs/LOOP-DE-MELHORIA.md)
- Checklist de uma rodada: [`cotacao/docs/COMO-RODAR-UMA-RODADA.md`](cotacao/docs/COMO-RODAR-UMA-RODADA.md)
- Backlog de otimizações (com eixo + risco + local no código): [`cotacao/docs/BACKLOG-OTIMIZACOES.md`](cotacao/docs/BACKLOG-OTIMIZACOES.md)
- Visão geral e "como começar a Rodada 1": [`cotacao/README.md`](cotacao/README.md)

## Integração contínua

O GitHub Action [`.github/workflows/validar.yml`](.github/workflows/validar.yml) roda em todo push/PR e **valida a biblioteca de aprendizado** (`cotacao/ferramentas/validar-biblioteca.mjs`): apelido órfão, termo duplicado ou `correcoes.jsonl` quebrado **reprovam o merge**. O gate dos 3 eixos roda automaticamente quando a rodada commita `cotacao/benchmark/ultima-rodada.json`.

## Estrutura

```
.
├── pricing/                      # precificação semanal de prateleira (design)
│   ├── README.md
│   └── docs/superpowers/...       # spec + plano de design
├── cotacao/                      # cotação por IA + loop de melhoria
│   ├── app/cotacao_ia_oficial.html   # o app (NÃO é modificado fora de uma rodada aceita)
│   ├── README.md  ROADMAP.md
│   ├── docs/        # LOOP-DE-MELHORIA, BACKLOG-OTIMIZACOES, AUTOMACAO, COMO-RODAR-UMA-RODADA
│   ├── biblioteca/  # apelidos / buscas / ausentes / correcoes + _SCHEMA
│   ├── benchmark/   # golden-set + avaliar.mjs (gate dos 3 eixos)
│   ├── metricas/    # rodada-NNN.json (histórico medido dos 3 eixos)
│   └── ferramentas/ # exportar/importar biblioteca (Console) + validador
└── .github/workflows/validar.yml  # gate de cada rodada
```
