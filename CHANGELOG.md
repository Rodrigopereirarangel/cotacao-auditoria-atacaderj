# CHANGELOG — cotacao-auditoria-atacaderj

Evolução do repositório e do loop de melhoria. Cada **rodada** entra aqui quando o PR é mesclado. Os números dos 3 eixos ficam em `metricas/rodada-NNN.json` — rode `node ferramentas/evolucao.mjs` para a tabela comparativa rodada a rodada.

> Versionamento simples por rodada do loop. A regra de ouro vale para todas: nenhuma rodada pode piorar velocidade, qualidade **ou** tokens.

## Planilha diária da auditoria redesenhada p/ celular (2026-07-11)

O xlsx enviado por WhatsApp às 16h era ilegível no celular: 17 colunas truncadas,
sem cor, sem formato de número. Aprovado pelo dono sobre prévia com os dados
reais de 10/07.

- **Novo `ferramentas/auditoria-xlsx.mjs`**: monta o workbook estilizado; o
  `auditoria-diaria.mjs` só chama `montarWorkbook()` (o padrão de dependência
  opcional do `xlsx-js-style` foi mantido — sem a lib, sai só o `.txt`).
- **Aba Divergências virou layout mobile**: vendedor e cliente/pedido/DAV são
  FAIXAS mescladas (não colunas); cada item tem só 5 colunas (Produto · Qt ·
  Mín · Vendido · Impacto) — cabe na tela em pé sem truncar. Vendedores em
  ordem de impacto (maior primeiro); âmbar = curva A; vermelho/rosa = item com
  impacto ≥ R$ 10.
- **Aba Resumo**: título, 3 indicadores (auditados/divergências/impacto) e
  ranking de vendedores com % do impacto e linha TOTAL.
- **Nova aba Completa**: as mesmas 17 colunas de antes, com autofiltro e
  formatos de número de verdade (desconto vira % numérica, não texto) — para
  análise no PC.
- Testado com `--dia 2026-07-10 --outdir` de teste (211 itens, 3 abas ok) e
  `auditoria-calc.test.mjs` passando. Nenhuma regra de cálculo mudou.

## Renomeação (2026-07-04)
- Repositório renomeado **`cotacao-atacaderj` → `cotacao-auditoria-atacaderj`** (o app passou a conter também a Auditoria de Desconto). O GitHub redireciona o nome antigo.
- App renomeado **`app/cotacao_ia_oficial.html` → `app/cotacao-auditoria-atacaderj.html`**. Ferramentas, scripts, CI e docs vivos atualizados; specs/planos históricos e métricas preservados como estavam.
- Operador: atualizar o sync instalado (rodar de novo `ferramentas/sync-operador/instalar.ps1`) para apontar ao novo nome do repo.

## Catálogo se atualiza sozinho no navegador aberto + trava do upload manual (2026-07-09)

Pergunta do dono: se o robô sobe um `catalogo_bridge.json` novo às 12h05 e o vendedor já
está com a aba do artifact aberta desde as 08h, ele fica com preço velho até fechar e
reabrir? Sim — `window.storage` é lido só 1x no carregamento da página. Faltava o app
**se checar sozinho** (um "F5" só dos dados, sem recarregar a página) e **avisar/travar**
o upload manual conforme a automação estiver saudável ou não.

- **Polling silencioso a cada 3min** (`_catIniciarPolling`/`_catVerificarAtualizacao`):
  relê só um marcador leve no storage compartilhado (`atacaderj_catalogo_versao`,
  `{gerado_em,origem}` — não o catálogo inteiro) e compara com a versão em uso na aba.
  - **Carrinho vazio** (`cotacaoItensOrdem.length===0`): troca o catálogo sozinho, sem
    pedir nada ao vendedor — é exatamente o "puxar sozinho" pedido.
  - **Carrinho com item em andamento**: NÃO troca embaixo do vendedor (mudaria preço de
    item já incluído); mostra um aviso fixo no rodapé com botão "Atualizar agora" — é o
    "mensagem forçando a atualizar, tipo F5" pedido, só que sem derrubar a cotação atual.
- **`gerado_em`/`origem` (`'robo'`|`'manual'`) passam a ser gravados** junto do catálogo
  (`atacaderj_catalogo` e o novo `atacaderj_catalogo_versao`) tanto no upload do bridge
  quanto no fluxo manual de 3 relatórios — antes só existia a data (dia), sem hora, o que
  não dava para saber se uma versão era mais nova que outra dentro do mesmo dia.
- **Trava do upload manual quando a automação está saudável**: no modal 📦, se a última
  versão aplicada veio do robô (`origem==='robo'`) e tem menos de 5h, a área de upload
  (arquivo único do bridge + contingência dos 3 relatórios) fica desabilitada com um aviso
  azul explicando por quê — evita um operador sobrescrever por engano com um relatório
  velho que ainda está aberto no computador. Tem um link de escape ("preciso enviar mesmo
  assim") para não travar de vez em uma emergência.
- **Destrava sozinho se a comunicação for perdida**: sem novidade do robô há mais de 5h,
  a trava cai automaticamente e aparece um aviso vermelho — o upload manual (o mesmo fluxo
  de sempre) volta a ser o caminho, exatamente como pedido ("caso perca a comunicação
  deixe o upload manual assim como o original").
- Testado com smoke test em `jsdom` (harness descartável, não versionado): 13/13 cenários
  passaram — auto-apply de carrinho vazio, aviso + apply manual de carrinho ocupado, trava
  ativa/inativa por frescor, e a regra de que origem `'manual'` nunca trava.
- Não depende do robô Playwright existir: qualquer escrita em `atacaderj_catalogo_versao`
  (inclusive um upload manual de hoje) já aciona o mecanismo. Quando o robô for construído,
  ele só precisa completar o MESMO fluxo de upload do botão 📦 — o resto (detecção,
  auto-apply, trava/destrava) já funciona.

## App autocontido p/ publicar como artifact (2026-07-09)

O app-fonte carrega 3 recursos de **CDN externo** (xlsx-js-style, Tabler icons,
fonte Inter). **Qualquer artifact do claude.ai bloqueia hosts externos por CSP**
— então o XLSX (ler os relatórios + exportar o Excel da Auditoria) não carregava
e quebrava essas funções (foi o que a sessão do Cowork observou). Causa: a
dependência de CDN, não onde se publica — aconteceria igual em Netlify/Vercel.

- **`ferramentas/gerar-app-publicavel.mjs`** (`npm run publicavel`) gera
  `app/cotacao-auditoria-atacaderj.publicavel.html` **100% autocontido**:
  XLSX embutido inline (offline, CSP-safe); Tabler (webfont sem uso no corpo)
  e Inter (font-family cai p/ Segoe UI/system-ui) removidos. Única ref externa
  que permanece: o proxy de IA do claude.ai (runtime do artifact, não é CDN).
- Cuidado técnico: o replace do `<script src>` usa **função** (não string) —
  o bundle minificado contém `$&`/`$'` que o replace-por-string reinjetaria.
- Verificado: XLSX embutido faz round-trip de planilha em contexto de
  navegador (require indefinido → usa o fallback de codepage); 0 refs de CDN;
  sintaxe OK. O `.publicavel.html` é derivado (gitignored) — **publique ELE**
  como artifact, não o fonte.

## Arquivo único do bridge no botão 📦 + Auditoria pelo storage (2026-07-08)

Implementa o plano `docs/superpowers/plans/2026-07-07-aceitar-catalogo-bridge.md`
(aprovado no design de 2026-07-07: o app roda como **artifact do claude.ai** e
não alcança a rede da loja — os dados viajam por upload, não por fetch), com
uma extensão: o arquivo único também carrega o histórico da Auditoria.

- **Botão 📦 Catálogo aceita o `catalogo_bridge.json`** do `erp-bridge-atacaderj`
  (seção verde "Arquivo único do bridge"; os 3 relatórios do ERP viram
  contingência). Valida `origem`, `gerado_em` de HOJE e cada produto
  (nome≥4, v>0, sem MORTO, `total` == validados). IDs estáveis p/ o robô:
  `#catBridgeArq`, `#catConfirmar` (novos), `#btnCatalogo`, `#catalogBadge`.
- **Extensão do contrato — `pedidos_venda`**: o mesmo arquivo traz os itens dos
  pedidos de venda/DAV fechados nos últimos 7 dias
  (`{janela_dias,pedidos:[{dia,ped,dav,cli,vend,itens:[[cod,emb,qtde,valor,custo_un]]}]}`).
  Ao confirmar (`confirmarCatalogoBridge`), isso é salvo no storage
  compartilhado (`atacaderj_pedidos_venda`, ~160KB) — um upload do robô
  alimenta cotação E auditoria de todos os usuários do artifact.
- **Aba 🔍 Auditoria agora funciona no artifact**: o seletor de dia lê o
  histórico na ordem storage (arquivo do bridge) → fetch local
  (`pedidos_venda_dav.csv`, p/ uso fora do claude.ai) → upload manual do
  `.xlsx` (fallback de sempre). Nome do produto vem do CATALOG em uso.
- `ferramentas/gerar-fixture-bridge.mjs` — fixture falsa (60 produtos + 4
  pedidos) p/ testar o fluxo offline; `ferramentas/fixtures/` no .gitignore.
- Validado com o arquivo REAL da ponte: 4.600 produtos + 262 pedidos aceitos;
  auditoria de 06/07 via storage reproduz exatamente o motor validado contra o
  relatório manual do ERP (199 linhas · 154 auditados · 33 divergências ·
  R$ 105,92). Sintaxe validada; a cópia pública do app não carrega a constante
  da trava (`h==='…'`), então não há re-selagem aplicável neste repo.

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
