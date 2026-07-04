# Arquitetura de Sincronização — cotacao-auditoria-atacaderj

Como o app de cotação roda, como a **biblioteca de aprendizado** acumula entre operadores, e como tudo volta pro **GitHub** (backup + loop de melhoria) — **sem o operador fazer nada nem saber de nada**.

> Documento de referência. Se você esquecer "como isso funciona", leia daqui.

---

## 1. Contexto: o app roda como **artefato do claude.ai**

O app (`app/cotacao-auditoria-atacaderj.html`) é um arquivo único client-side. Ele roda como **artefato de chat do claude.ai** (iframe sandbox em `*.claudeusercontent.com`). Isso define **tudo**:

- A IA funciona porque o **ambiente do artefato injeta o acesso** à API da Anthropic na conta de quem abre. Por isso o app chama `api.anthropic.com` sem chave — e por isso **não** funciona em `file://`.
- **Distribuição:** o dono **publica** o artefato e compartilha o **link**. Quem abre roda com a **própria conta e créditos** (você não paga pelo uso do operador). GitHub **não** entra na distribuição — é só o cofre de versões.

## 2. As paredes do artefato (o que define o desenho)

Confirmado por pesquisa (Anthropic Help Center + cobertura técnica, 2026):

| Restrição | Confiança | Consequência |
|---|---|---|
| `fetch()` para domínio externo arbitrário (GitHub, Gist, endpoint próprio) é **bloqueado** por CSP. Só passa `api.anthropic.com`. | alta | O app **não** consegue mandar dado pro GitHub sozinho. |
| `localStorage`/`IndexedDB` **não funcionam** no sandbox (falham silenciosamente). | alta | A persistência **tem** que usar `window.storage`. |
| Existe a API oficial **`window.storage`** (`set/get/delete`, flag `shared`, 20 MB texto, **só publicado**, planos Pro/Max/Team/Enterprise). | alta | É o **banco central** nativo, inclusive **compartilhado entre usuários** (`shared:true`). |
| Link publicado roda com a conta/créditos de quem abre; "always share latest" atualiza no lugar. | média-alta | Operador sempre pega a versão nova; você não paga o uso dele. |

**Resumo:** o artefato é uma página passiva, isolada, que só fala com a Anthropic. Não roda no fundo, não alcança o GitHub.

## 3. Modelo de dados — `window.storage`

A camada `_store` no app abstrai o armazenamento (com **cache em memória** + `preload` async no boot + **fallback** para `localStorage` fora do artefato). Chaves:

| Chave | Modo | Conteúdo |
|---|---|---|
| `atacaderj_apelidos` | **shared** (central) | termo → códigos aprendidos |
| `atacaderj_buscas` | **shared** | cache de buscas resolvidas (versionado por catálogo) |
| `atacaderj_ausentes` | **shared** | itens que nem o fallback achou |
| `atacaderj_apelido_motivos` | **shared** | log do aprendizado por IA (termo/cod/motivo/data) |
| `atacaderj_catalogo` | **shared** | override de catálogo/preços (central) |
| `atacaderj_msgdia` | pessoal | contador de mensagens do dia (por operador) |

> **`shared` = todos os operadores leem/escrevem o MESMO dado.** É a "biblioteca central" — sem backend. (Trocar shared↔pessoal de uma chave = 1 linha em `_STORE_SHARED`, dentro do app.)

## 4. O fluxo completo (operador = zero esforço, inconsciente)

```
[Operador] usa o app (conta+créditos dele)
   → ao confirmar matches, aprende → window.storage SHARED          [automático, invisível]

[Operador] atualiza o catálogo (confirmarCatalogo)
   → o app, em silêncio, baixa atacaderj-biblioteca.json na Downloads  [sem modal, sem menção]

[PC do operador] sync-biblioteca.ps1 (Agendador do Windows)
   → pega o arquivo mais novo → envia pro GitHub via API             [invisível, idempotente]
     → biblioteca/snapshots/operador-latest.json

[Dono / este repo] npm run mesclar
   → funde o snapshot na biblioteca curada (UNIÃO, nunca apaga)
   npm run validar → gate de qualidade

[Dono] re-publica o artefato (mesmo link)
   → operador, ao abrir, já roda a versão melhor
```

O operador **só cota e atualiza catálogo** (o trabalho normal dele). Não vê backup, não toca GitHub, não sabe que isso existe.

## 5. Componentes

| Arquivo | Papel |
|---|---|
| `app/cotacao-auditoria-atacaderj.html` | o app; camada `_store` (window.storage + fallback); export silencioso dentro de `confirmarCatalogo()` |
| `ferramentas/selar-app.mjs` | re-sela a trava de integridade (SHA-256 do `#app-core`) após qualquer mudança no app |
| `ferramentas/sync-operador/` | script + guia: PC do operador sobe o snapshot pro GitHub sozinho (token fino) |
| `ferramentas/mesclar-snapshot.mjs` | funde `snapshots/operador-latest.json` na biblioteca curada (`npm run mesclar`) |
| `ferramentas/validar-biblioteca.mjs` | valida a biblioteca (gate do CI) |
| `ferramentas/evolucao.mjs` / `metricas/` | acompanha os 3 eixos (velocidade/qualidade/tokens) por rodada |
| `biblioteca/` | a biblioteca curada versionada (apelidos/buscas/ausentes/correcoes/apelido_motivos) |

## 6. Setup único (feito pelo DONO, 1x, no PC do operador)

Detalhe em `ferramentas/sync-operador/README.md`:
1. Token fino do GitHub (Contents: write, **só** este repo) → variável de ambiente `ATACADERJ_GH_TOKEN`.
2. Copiar `sync-biblioteca.ps1` + agendar no Agendador de Tarefas (oculto, a cada ~30 min).
- 🔒 Token mínimo; ideal usar **conta-robô**; nunca commitado.

## 7. Decisões tomadas (e por quê)

- **Opção A (fica no artefato), não Opção B (app web).** Mantém o custo no operador (créditos dele) e a simplicidade do link. Opção B (Vercel/Cloudflare) só se um dia quiser automação 100% sem ninguém + aceitar **pagar a API**.
- **Catálogo central + operador atualiza.** O operador é quem mexe nos preços; isso dispara o snapshot na máquina dele (onde o `sync-operador` roda).
- **Backup atrelado ao `confirmarCatalogo`, silencioso.** Sem modal (operador não pode ver). O backup acontece na ação natural de atualizar catálogo.
- **União, nunca apaga.** Merge e import sempre unem; preços/buscas travados por versão de catálogo pra não servir preço velho.

## 8. O que **não** é possível (e quando reconsiderar)

- **Auto-pro-GitHub a cada cotação, de dentro do artefato:** ❌ (parede do CSP + página passiva). Por isso o backup é atrelado ao catálogo + script no PC do operador.
- Se um dia precisar de **automação total sem nenhum gesto/PC** ou **vários operadores em tempo real**, aí vale **sair do artefato** → app web real (CSP é seu), com proxy da sua chave + commit automático. Custo: você paga a API + hospeda.

## 9. Backup e rollback

- Cada versão do app é um **commit** (e o `#app-core` é selado). Rollback = re-publicar o HTML de um commit anterior.
- A biblioteca curada é versionada; os snapshots crus ficam em `biblioteca/snapshots/`.
- `window.storage shared` é a memória viva; o GitHub é o cofre histórico.

## 10. Pendência crítica

⚠️ **Toda a camada `window.storage` (persistência, `shared`, export no catálogo) ainda NÃO foi testada em runtime** — só validada por sintaxe + selo. **Antes de confiar:** publicar a `main` como artefato e testar: cotar → recarregar (persiste?) → 2 contas (`shared` cruza?) → atualizar catálogo (baixa o JSON?).

---

### Referências
- Restrições do artefato: Anthropic Help Center ("What are artifacts", "Publish and share artifacts"), Anthropic news ("Claude-powered artifacts"), análises técnicas (Simon Willison, 2025; guias 2026).
- Commits-chave: `faaa4d6` (migração window.storage), `ce50b38` (export silencioso no catálogo), `ceaf67a` (sync operador), `c13226a` (merge de snapshot).
