# Design — Auditoria de Desconto embutida na Cotação

**Data:** 2026-06-30
**Status:** aprovado (design) — aguardando revisão do spec
**Repositório:** `cotacao-atacaderj` · app: `app/cotacao_ia_oficial.html`

## 1. Objetivo

Unificar o app **Auditoria de Desconto** (hoje um HTML separado) dentro do **artefato de Cotação**, como um módulo/aba, de modo que:

- seja **um app só** (um arquivo, um artefato publicado, um banco);
- o **preço-base da auditoria seja exatamente o mesmo do catálogo da cotação** (mesma fonte de verdade, sem reimportar nem divergir).

A auditoria verifica vendas do dia feitas **abaixo do preço mínimo permitido** por produto, agrupando por vendedor → cliente → pedido, e exporta o resultado em Excel.

## 2. Decisões tomadas (com o dono)

1. **Fonte do catálogo:** a auditoria **reaproveita o `CATALOG`** já carregado na cotação. O único upload novo é o **relatório de Vendas do dia**. (base, curva e qtd vêm do catálogo).
2. **Custo:** usa o **custo do relatório de Vendas** (coluna "Custo Un.", por venda) — não o custo do catálogo.
3. **Visibilidade:** aba **visível para todos** (botão normal na barra de cima). Sem gate de acesso.
4. **Arquitetura:** **integração nativa** (Abordagem 1) — reusa o catálogo + a matemática de desconto que o app já tem; porta do anexo apenas o que é genuinamente novo (ler Vendas, agrupar, exportar Excel divergências).
5. **Data do relatório de Vendas:** **não travar por dia** (auditoria pode ser de um dia passado). Mostrar a data lida.

## 3. Contexto técnico (o que o app já tem)

O catálogo da cotação (`CATALOG`, e o override em `window.storage['atacaderj_catalogo']`) guarda, por produto:

| Campo | Significado |
|---|---|
| `c` | código interno |
| `p` | nome |
| `v` | **preço-base** = menor entre varejo, atacado e promo (lógica já implementada) |
| `q` | qtd mínima do preço vencedor (>1 só quando o atacado venceu) |
| `custo` | custo do relatório de preço (catálogo) — **não usado pela auditoria** |
| `cv` | curva (`'A'` para curva A; ausente caso contrário) |

Funções de desconto já existentes no app (serão **reusadas**):

- `descontoMaxValor(preco, custo, cv)` → fração máxima de desconto. Constantes: `PISO_MARKUP = 0.10`; teto = `0.03` se `cv==='A'`, senão `0.05`.
- `_basePreco(p)` → `p.v`.
- (Existe `precoMinimoProduto(p)`, mas ele usa o **custo do catálogo**; a auditoria **não** o usa, porque o custo vem da venda — ver §5.)

O app já carrega o **XLSX (xlsx-js-style)** via CDN jsdelivr e usa overlays/modais como padrão de UI.

## 4. Entrada nova: relatório de Vendas do dia

Portado do anexo (`parseVendas`), sem alterar a lógica de leitura (formato comprovado do sistema do cliente):

- Detecta a linha de cabeçalho por presença de `Pedido` **e** `Custo Un.`.
- Colunas: `Pedido, Nota, Cód, Produto, Emb, Qtde, Valor, Custo Un., Vendedor`.
- Estrutura hierárquica do relatório:
  - linha com texto em `Pedido` e sem `Cód` → **cliente**;
  - linha com número em `Pedido` → fixa `pedido`, `nota`, `vendedor`;
  - linha com `Cód` numérico → **item** (herda vendedor/cliente/pedido/nota correntes);
  - linhas começando com "Total" são ignoradas.
- Propaga o vendedor para itens do mesmo pedido quando vier em branco.

Validação: se não achar o cabeçalho `Pedido`/`Custo Un.`, mostrar aviso ("não parece o relatório de Vendas") e não processar.

## 5. Lógica de auditoria (a conta)

Pré-condição: `CATALOG` carregado. Se vazio → aviso "atualize o catálogo primeiro".

Para cada **item** vendido com `qtd > 0`:

1. localizar o produto no `CATALOG` por `código`.
   - **não encontrado** → entra na lista "**sem preço de tabela**" (contabilizado, não avaliado). Não é divergência.
2. `base = produto.v` (catálogo, menor dos 3).
3. `custo = item.custo` (do relatório de Vendas).
4. `cv = produto.cv` (catálogo).
5. `descMax = descontoMaxValor(base, custo, cv)` (função existente).
6. `precoMin = round2(base × (1 − descMax))`.
7. `vendidoUn = item.valor ÷ packsize(item.emb)` (porta `packsize`: extrai o nº da embalagem fardo/caixa; default 1).
8. se `round2(vendidoUn) < round2(precoMin)` → **divergência**, guardando:
   - `falta/un = precoMin − vendidoUn`;
   - `impacto = (precoMin − vendidoUn) × qtd × packsize`;
   - `descontoPraticado = (base − vendidoUn) / base`;
   - `regra` que prendeu (para exibição): recalculada com as mesmas constantes — `dm = 1 − (1+PISO_MARKUP)/(1+markup)`, `markup = (base−custo)/custo`; se `dm ≤ teto` → "piso 10%", senão "teto 3%/5%". (necessário porque `descontoMaxValor` devolve só a fração, não qual regra prendeu.)

> Nota de consistência: a auditoria **não** chama `precoMinimoProduto(p)` (que usaria o custo do catálogo). Ela compõe o mínimo com `base` do catálogo + `custo` da venda + `cv` do catálogo, conforme a decisão §2.2.

## 6. UI / saída

- **Botão** `🔍 Auditoria` na appbar, ao lado de `📦 Catálogo`.
- **Overlay tela cheia**: campo de upload do relatório de Vendas + botão **Auditar** + área de resultado.
- **KPIs:** itens auditados · nº de divergências (vermelho se > 0).
- **Resultado** agrupado **vendedor → cliente → pedido**, tabela por item com: Cód, Produto, Emb, Qtd, Tabela (base), Custo, Preço mín, Vendido/un, Desc., Falta/un, Regra, Curva (A).
- **Exportar Excel:** porta `exportXlsx` do anexo (mesma planilha de divergências, com estilos).
- Banner verde quando 0 divergências; aviso amarelo listando itens "sem cadastro".

## 7. Tratamento de erros / bordas

- Catálogo vazio → aviso, não processa.
- Relatório de Vendas inválido → aviso claro, nada é alterado.
- Data do relatório: exibida; **não trava** por dia.
- `packsize(emb)` portado para converter fardo/caixa → unidade.
- Itens sem código no catálogo → lista "sem preço de tabela" (não avaliados), sem virar divergência.

## 8. Fora de escopo (YAGNI)

- Gate/senha de acesso à aba (decidido: visível a todos).
- Reimportar atacado/varejo/curva na auditoria (decidido: reusa catálogo).
- Persistir histórico de auditorias / mandar pro GitHub (a auditoria é uma análise pontual em cima do dia; não entra no loop de biblioteca).
- Versão mobile dedicada.

## 9. Testes

1. **Teste isolado da conta** (Node, como feito no preço-menor-dos-3): casos com divergência clara, no limite exato (não conta), curva A vs não-A, `packsize > 1`, item sem cadastro.
2. **Validação de sintaxe** dos `<script>` do app (`new Function` por bloco).
3. **Smoke real** (ideal): rodar com 1 relatório de Vendas real + o catálogo do dia e conferir 1–2 divergências à mão.

## 10. Impacto no arquivo

- Edições em `app/cotacao_ia_oficial.html`: +1 botão na appbar, +1 overlay, +funções (`parseVendas`, `packsize`, `auditar`, render do resultado, `exportXlsxAuditoria`). Reuso de `CATALOG`, `descontoMaxValor`, XLSX.
- Regenerar a cópia publicável (`Downloads/cotacao-atacaderj-OFICIAL.html`).
- Sem mudança no esquema de `window.storage` (auditoria não persiste nada novo).
