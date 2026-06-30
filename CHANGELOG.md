# CHANGELOG — cotacao-atacaderj

Evolução do repositório e do loop de melhoria. Cada **rodada** entra aqui quando o PR é mesclado. Os números dos 3 eixos ficam em `metricas/rodada-NNN.json` — rode `node ferramentas/evolucao.mjs` para a tabela comparativa rodada a rodada.

> Versionamento simples por rodada do loop. A regra de ouro vale para todas: nenhuma rodada pode piorar velocidade, qualidade **ou** tokens.

## [Não liberado]

### Rodada 1 — cache warming seguro (PR aberto)
- `cutucarCache`: `max_tokens:1` → `max_tokens:0` (**[GANHO SEGURO]**, eixo **tokens**; não toca o caminho de busca).
- **Re-selada** a trava de integridade do app (hash de `#app-core`: `2d4ad967…` → `dd9abe20…`), porque a mudança acima ficava dentro de `#app-core` e disparava o "CÓDIGO ALTERADO".
- Métrica: `metricas/rodada-001-cutucar-max-tokens-0.json` (`veredito="aceita-por-construcao"`).

### Ferramentas do loop (infra)
- `ferramentas/selar-app.mjs` — recalcula e atualiza o hash de integridade do app (**obrigatório após toda mudança no app**).
- `ferramentas/evolucao.mjs` — compara `metricas/rodada-*.json` e mostra a evolução dos 3 eixos.
- `ferramentas/proxy-teste/` — servidor local que injeta a chave da Anthropic para testar a IA sem o ambiente de produção (sem alterar o app).
- `package.json` com atalhos: `npm run validar | selar | selar:check | evolucao | proxy`.

## Reorganização do repositório
- O repo passou a ser **só o projeto de cotação** (na raiz). A precificação vive no repo próprio `pricing-atacaderj`.
- `Main` renomeado para **`cotacao-atacaderj`**.

## Rodada 0 — baseline (estrutura do loop)
- Biblioteca versionada (`apelidos/buscas/ausentes/correcoes` + `_SCHEMA`), ponte de export/import do `localStorage`.
- Benchmark (golden-set + `avaliar.mjs`: gate de não-regressão dos 3 eixos), validador da biblioteca, CI (`validar.yml`).
- Documentação do loop (`docs/LOOP-DE-MELHORIA`, `COMO-RODAR`, `BACKLOG-OTIMIZACOES`, `AUTOMACAO`) e baseline em `metricas/rodada-000-baseline.json` (estimado, a confirmar com medição real).
- Skills de apoio do prompts.chat em `ferramentas/skills/` (refino de prompt).
