# Skills de apoio ao loop (prompts.chat)

Dois **Agent Skills** baixados do [prompts.chat](https://prompts.chat) que servem de **motor da Etapa 4 (Melhorar)** do loop — especificamente a alavanca de **refino de prompt**, que mexe nos eixos **TOKENS** e **QUALIDADE** sem tocar no caminho de busca.

> Estes skills **não** fazem o loop sozinhos (não existe skill pronto para o loop inteiro — ver recap no README do `cotacao/`). Eles são ferramentas para uma etapa: quando uma rodada decide enxugar um prompt do app (`interpretarLote`, `buscaSemanticaLote`, `PROMPT_LEITURA`), use-os para reescrever o prompt de forma mais curta **mantendo a qualidade**, e então valide pelo gate dos 3 eixos.

| Skill | Pasta | Uso no loop |
|---|---|---|
| **Prompt Refiner** | [`prompt-refiner/`](prompt-refiner/) | Reescreve um prompt cru/verboso num prompt-mestre **token-efficient** (framework PCTCE+O). Alvo: reduzir tokens de `interpretarLote`/`buscaSemanticaLote`/OCR. |
| **Prompt Engineering Expert** | [`prompt-engineering-expert/`](prompt-engineering-expert/) | Metodologia de **melhoria iterativa de prompt** (BEST_PRACTICES, TECHNIQUES, TROUBLESHOOTING). Alvo: o "manual" ao mexer em qualquer prompt do app. |

## Como usar

Estes são skills no formato Claude Code (`SKILL.md` + arquivos de referência). Para ativar num ambiente Claude Code, copie a pasta do skill para `.claude/skills/<slug>/` (ou use o mecanismo de skills do seu cliente). Aqui no repo eles ficam **versionados** para que toda rodada parta da mesma referência.

## Regra de ouro (relembrando)

Refino de prompt **reduz tokens**, mas pode mudar sutilmente o que a IA retorna. Por isso **nunca** se aceita um prompt enxugado sem rodar `benchmark/avaliar.mjs`: se a **qualidade** (precisão/recall contra o golden-set) cair além da tolerância, a mudança é revertida — mesmo que economize tokens.

## Proveniência

- Prompt Refiner — autor: Kiệt Nguyễn Tuấn — https://prompts.chat/prompts/cmng63hxo0001jg044rice18j_prompt-refiner
- Prompt Engineering Expert — autor: TomsTools — https://prompts.chat/prompts/cmlb8cqbo0001l504wxxjlh2l_prompt-engineering-expert

Baixados em 2026-06-29 via `/prompts.chat:skills`.
