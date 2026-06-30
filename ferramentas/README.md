# ferramentas/ — utilitários do loop

Scripts de apoio ao loop de melhoria. Os `.mjs` rodam com Node (sem dependência, exceto o selador, que usa `jsdom`). Os `.js` são **snippets de Console** (cola no DevTools com o app aberto).

Antes de usar o selador, instale a dependência uma vez: `npm install`.

| Ferramenta | O que faz | Como rodar |
|---|---|---|
| `validar-biblioteca.mjs` | Valida `biblioteca/` (schema, duplicatas, órfãos, JSONL). É o gate do CI. | `npm run validar` |
| **`selar-app.mjs`** | **Re-sela a trava de integridade do app** (recalcula o hash do `#app-core`). **Obrigatório após qualquer mudança no app.** | `npm run selar` / `npm run selar:check` |
| **`evolucao.mjs`** | Mostra a **evolução dos 3 eixos** ao longo das rodadas (lê `metricas/rodada-*.json`). | `npm run evolucao` |
| `exportar-biblioteca.js` | (Console) lê o `localStorage` do app e baixa os JSON da biblioteca. | colar no DevTools |
| `importar-biblioteca.js` | (Console) faz merge da biblioteca de volta no `localStorage`. | colar no DevTools |
| **`proxy-teste/`** | Servidor local que injeta sua chave da Anthropic para **testar a IA** sem o ambiente de produção. | `npm run proxy` (veja o README de lá) |
| `skills/` | Skills do prompts.chat para refino de prompt (Etapa 4 do loop). | — |

## A trava de integridade e o loop

O app tem uma verificação anti-adulteração: ele calcula o `SHA-256` do `textContent` de `#app-core` e compara com um hash fixo. Se não bater, mostra **"CÓDIGO ALTERADO"** e bloqueia a cotação.

Consequência para o loop: **toda rodada que mexe no app precisa re-selar**. O passo é:

```bash
# 1) aplica a mudança da rodada no app
# 2) re-sela (atualiza o hash):
npm run selar
# 3) confere:
npm run selar:check     # deve dizer "OK — app ja esta SELADO"
```

Sem isso, o app aprovado pela rodada se auto-bloqueia ao abrir.
