# Design — Promoção vence = desconto zero (cotação + auditoria)

**Data:** 2026-07-04
**Status:** aprovado (design) — aguardando revisão do spec
**Repositório:** `cotacao-atacaderj` · app: `app/cotacao_ia_oficial.html` · lógica pura: `ferramentas/auditoria-calc.mjs`

## 1. Objetivo

Quando o preço de tabela de um produto (o **menor entre varejo, promoção e atacado**) for o da **promoção**:

1. **Cotação:** não autorizar **nenhum desconto** (nem o teto de 3%/5% — comporta-se como quando o piso de markup 10% já trava o desconto em 0%). Se o vendedor fizer **alteração manual** de preço abaixo do promocional, informar a mensagem de preço abaixo do permitido (mesmo fluxo atual de "desconto acima do permitido": aviso → autorização do gerente).
2. **Auditoria:** venda abaixo do preço de tabela promocional entra como **divergência**, com a regra exibida "promoção".

A lógica de escolha do preço de tabela **não muda**: continua vencendo o menor dos 3.

## 2. Decisões tomadas (com o dono)

1. **Gatilho:** a regra vale **só quando a promoção vence** a mesclagem (promo < varejo e promo ≤ atacado). Se o atacado for estritamente menor que a promoção, o vencedor é o atacado e valem as regras normais de desconto (piso 10% / teto 3%/5%). Empate exato promoção = atacado: fica a promoção (o código atual só troca para o atacado quando ele é estritamente menor) → desconto zero.
2. **Edição manual abaixo do promocional:** **mesmo fluxo atual** — aviso + o gerente pode autorizar (selo "✔ gerente"). Sem bloqueio total.
3. **Abordagem:** marcar a **origem** do preço vencedor no catálogo (flag `pr`), decidida uma única vez na mesclagem; cotação e auditoria leem a mesma marca. (Alternativas descartadas: guardar o valor da promo em todo produto — YAGNI, incha o catálogo; reimportar o relatório de varejo na hora do uso — contradiz a arquitetura já decidida de reusar o catálogo.)

## 3. Contexto técnico (estado atual)

- `mesclarCatalogos` (app): para as linhas do varejo, `if (o.promo > 0 && o.promo < o.v) o.v = o.promo; delete o.promo` — a promoção vence mas a **origem é descartada**. Depois, o atacado substitui quando `r.v < ex.v` (estrito).
- `descontoMaxValor(preco, custo, cv)`: piso de markup `PISO_MARKUP = 0.10`; teto `0.03` (curva A) / `0.05`. `descontoMaxProduto(p)` aplica sobre `_basePreco(p) = p.v`. `precoMinimoProduto(p) = base × (1 − descMax)`.
- `opcoesDescontoProduto(p)` monta o seletor a partir de `descontoMaxProduto` — quando o máximo é 0, o seletor já mostra só "0%".
- `salvarEdicaoPreco`: preço manual abaixo de `precoMinimoProduto` → aviso "⚠️ preço abaixo do limite permitido" → `_travaGerente()` → `_aplicarAutorizado()` (selo "✔ gerente").
- Auditoria: lógica pura em `ferramentas/auditoria-calc.mjs` (`descMaxFrac`, `regraBind`, `auditarItens`, com testes) espelhada no app (`_audDescFrac`, `_audRegra`, `_audItens`); o mapa do catálogo da auditoria (`catMap`) hoje carrega só `{v, cv}` por código.
- O `#app-core` tem trava de integridade — qualquer edição exige re-selar com `ferramentas/selar-app.mjs`.

## 4. Mudança 1 — Catálogo: flag `pr` (promoção venceu)

Em `mesclarCatalogos`:

- Quando a promoção vence o varejo (`o.promo > 0 && o.promo < o.v`): além de `o.v = o.promo`, gravar `pr: 1`.
- Quando o atacado substitui o preço (`r.v < ex.v`): remover a marca (`delete ex.pr`) — o vencedor passou a ser o atacado.
- Produto sem promoção vencedora **não carrega o campo** (catálogo não incha; itens só-atacado nunca têm `pr`).

Propagação: as cópias de produto usadas na renderização e nas regras (busca/`cardAdd`, apelidos, tela de revisão/`revAdd`, export) passam a copiar `pr` junto de `c, p, q, v, vu, custo, cv`.

**Transição/compatibilidade:** catálogos salvos antes da mudança (inclusive o selado no HTML) não têm `pr` → o app se comporta exatamente como hoje até a próxima "Substituir catálogo". Como o catálogo é atualizado diariamente, a regra vale na prática a partir do dia seguinte ao deploy.

## 5. Mudança 2 — Cotação: desconto zero + aviso na edição manual

Ponto único de regra: **`descontoMaxProduto(p)` devolve `0` quando `p.pr`** (antes de consultar custo/curva). Decorrências automáticas, sem código novo:

- o seletor de desconto (`opcoesDescontoProduto`) mostra só "0%";
- `precoMinimoProduto(p)` = preço de tabela (o promocional);
- edição manual abaixo dele cai no fluxo existente: aviso → "OK, chamar gerente" → "Gerente autoriza — confirmar" (selo "✔ gerente").

Retoques de clareza (código novo, pequeno):

- **Mensagem específica** no aviso de `salvarEdicaoPreco` quando `p.pr`: "🏷 produto em PROMOÇÃO — o preço de tabela já é o promocional; desconto não permitido. Abaixo disso, só com autorização do gerente."
- **Badge "promo"** ao lado do preço na linha do produto (`_precoCellHtml`), com tooltip "preço de tabela é o da promoção — sem desconto", para o vendedor entender por que o seletor só tem 0%.

`precoMinimoVu` fica intocado (o `vu` só existe quando o atacado venceu — caso em que não há `pr`).

## 6. Mudança 3 — Auditoria: divergência com regra "promoção"

Na lógica pura (`auditoria-calc.mjs`) e no espelho do app:

- o mapa do catálogo passa a carregar `pr`: `{v, cv, pr}`;
- para item cujo produto tem `pr`: `descMax = 0` (ignora custo da venda e curva), `precoMin = base` (o preço promocional), e a `regra` exibida = **"promoção"**;
- venda no preço exato **não** diverge; abaixo dele diverge, com `falta/un`, `impacto`, `desconto praticado` calculados como hoje;
- painel e Excel não mudam de estrutura — a coluna "Regra" apenas passa a poder exibir "promoção";
- catálogo sem `pr` (antigo) → comportamento idêntico ao atual.

## 7. Tratamento de erros / bordas

- Empate promoção = atacado → promoção mantém a vitória → desconto zero (comportamento derivado do `<` estrito atual; documentado, não alterado).
- Catálogo antigo sem `pr` → regras atuais (sem falso positivo na auditoria, sem trava indevida na cotação).
- Item em promoção sem custo na venda: irrelevante — `descMax = 0` independe de custo.
- Nenhum fluxo de erro novo; validações de planilha permanecem as mesmas.

## 8. Fora de escopo (YAGNI)

- Guardar o **valor** da promoção perdedora (quando o atacado vence) ou exibi-lo.
- Regra de desconto para `vu` de produto em promoção (combinação não existe nos catálogos gerados pelo app).
- Bloqueio total sem gerente (decidido: gerente pode autorizar).
- Regerar o catálogo selado no HTML com flags `pr` (a regra entra pelo fluxo diário de "Substituir catálogo").

## 9. Testes

1. **TDD na lógica pura** (`auditoria-calc.test.mjs`): venda abaixo do promocional → divergência com regra "promoção"; venda no preço exato → não diverge; produto com promoção perdedora (sem `pr`) → regra normal (piso/teto); catálogo sem `pr` → resultados idênticos aos atuais.
2. **Validação de sintaxe** dos `<script>` do app (`ferramentas/_aud/validar-sintaxe.mjs`).
3. **Re-selar** o app (`node ferramentas/selar-app.mjs`) após editar `#app-core` — obrigatório, senão o app se auto-bloqueia.
4. **Smoke manual:** subir as 3 planilhas com ao menos 1 produto de promoção vencedora → conferir badge "promo", seletor só com "0%", aviso de promoção na edição manual abaixo do preço; rodar a auditoria com uma venda abaixo do promocional → divergência com regra "promoção".

## 10. Impacto nos arquivos

- `app/cotacao_ia_oficial.html`: `mesclarCatalogos` (flag), `descontoMaxProduto` (regra), `salvarEdicaoPreco` (mensagem), `_precoCellHtml` (badge), cópias de produto (`pr`), espelho da auditoria (`_audCatMap`/`_audDescFrac`/`_audRegra`/`_audItens`) + re-selagem.
- `ferramentas/auditoria-calc.mjs` + `ferramentas/auditoria-calc.test.mjs`: `pr` no catMap, desconto zero, regra "promoção", casos novos.
- Regenerar a cópia publicável, como no ciclo anterior.
- Esquema de `window.storage['atacaderj_catalogo']`: campo novo **opcional** `pr` por produto (retrocompatível).
