# CHANGELOG — cotacao-auditoria-atacaderj

Evolução do repositório e do loop de melhoria. Cada **rodada** entra aqui quando o PR é mesclado. Os números dos 3 eixos ficam em `metricas/rodada-NNN.json` — rode `node ferramentas/evolucao.mjs` para a tabela comparativa rodada a rodada.

> Versionamento simples por rodada do loop. A regra de ouro vale para todas: nenhuma rodada pode piorar velocidade, qualidade **ou** tokens.

## Renomeação (2026-07-04)
- Repositório renomeado **`cotacao-atacaderj` → `cotacao-auditoria-atacaderj`** (o app passou a conter também a Auditoria de Desconto). O GitHub redireciona o nome antigo.
- App renomeado **`app/cotacao_ia_oficial.html` → `app/cotacao-auditoria-atacaderj.html`**. Ferramentas, scripts, CI e docs vivos atualizados; specs/planos históricos e métricas preservados como estavam.
- Operador: atualizar o sync instalado (rodar de novo `ferramentas/sync-operador/instalar.ps1`) para apontar ao novo nome do repo.

## Auditoria automática pela ponte ERP (2026-07-07)

Feito no PC-ponte da loja, junto com o repo `erp-bridge-atacaderj` (privado), que
agora extrai do ERP o `pedidos_venda_dav.csv` — os itens dos pedidos de venda/DAV
**fechados** (`dtAtendido`) nos últimos 7 dias, validado item a item (199/199)
contra o relatório manual rptPedidosVendaEmitidaDAVPorItens de 06/07.

- **Aba Auditoria com seletor de dia**: ao abrir, o app busca
  `pedidos_venda_dav.csv` (mesma pasta servida do app, junto do futuro
  `produtos.json`) e mostra botões dos **últimos 7 dias** — clicou, auditou os
  pedidos **fechados naquele dia**. O upload manual do `.xlsx` continua como
  alternativa (fallback automático quando o CSV não está acessível).
  Funções novas no `#app-core`: `_audCsvParse`, `_audCarregarDias`,
  `_audRodarDia` (reusam `_audItens`/render existentes).
- **`ferramentas/auditoria-diaria.mjs`**: roda a MESMA auditoria em Node
  (importa `auditoria-calc.mjs` — paridade garantida) direto dos arquivos da
  ponte; gera `auditoria-DIA.xlsx` + resumo `.txt` por vendedor. É o motor do
  job diário das 16h (agendado no PC-ponte, ver `scripts/auditoria-16h.ps1`
  do repo da ponte), que manda resumo + planilha para o WhatsApp do dono.
- **Preço-base = menor entre atacado/varejo/promoção** garantido nos dois
  caminhos: no app já era assim (mesclagem); no motor Node o catálogo vem do
  `produtos.json` da ponte com `v = min(atacado, varejo, promoção)`.
- Obs.: a cópia pública do app não carrega a constante da trava de integridade
  (`h==='…'`), então não há re-selagem a fazer neste repo; sintaxe validada
  com `ferramentas/_aud/validar-sintaxe.mjs` (2 blocos, 0 falhas).
- Dependência nova: `xlsx-js-style` (gera o Excel do job diário em Node).

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
