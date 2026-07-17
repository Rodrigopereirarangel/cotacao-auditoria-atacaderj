# CLAUDE.md — cotacao-auditoria-atacaderj

Conhecimento versionado + **loop de melhoria** do app de cotação por IA do
AtacadeRJ (`cotacao-auditoria-atacaderj.html`). O app **não é tocado** por este
repo — tudo aqui é aditivo: biblioteca exportável/importável, benchmark,
métricas, backlog.

## Regras inegociáveis

- **Sempre `git add -A && git commit && git push`** ao fim de cada mexida —
  este repo é a memória do loop; mudança sem push não existe.
- **Gate de benchmark**: nenhuma mudança entra se piorar qualquer um dos 3
  eixos (velocidade, qualidade, tokens) contra o baseline. Medir antes de
  aceitar, não confiar no olho.
- Apelido/busca errada contamina as cotações seguintes — mudança na biblioteca
  passa por revisão, nunca edição "rapidinha" direto.

## Ferramentas do ambiente (07/2026)

- **duckdb** CLI: SQL ad-hoc sobre `metricas/` e `benchmark/` (CSV/JSON) sem
  script descartável.
- **Skill browsing** (plugin superpowers-chrome): abrir e testar o app HTML
  localmente via `file://` num Chrome real antes de publicar mudanças de
  biblioteca.
