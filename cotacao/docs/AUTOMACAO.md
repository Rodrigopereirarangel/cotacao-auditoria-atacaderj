# Automacao — o CI que protege cada rodada

> Cotacao IA do Atacaderj. Este documento explica **como o CI protege cada
> rodada de cotacao**, o **fluxo de abrir uma rodada via branch + PR**, e
> **por que o gate roda no PR, antes do merge**.

A "regra de ouro" do projeto: nunca sacrificar nenhum dos **3 eixos** —
**velocidade** (numero de requisicoes, latencia, cache-hit), **qualidade**
(precisao/recall do match) e **tokens** (input/output/cache_read por cotacao).
A biblioteca de aprendizado e o que segura os tres ao mesmo tempo. Se ela
corromper, todos os tres caem juntos. O CI existe para isso nao acontecer.

---

## 1. O que e uma "rodada" e por que ela e fragil

Uma **rodada** e uma cotacao real rodada na ferramenta: o usuario cola/foto a
lista, o pipeline roda
(`separar -> interpretar -> filtro local -> busca em lote (haiku) -> confirmacao
-> fallback catalogo inteiro (sonnet, cacheado) -> aprende apelido`) e, ao
confirmar matches, o app **aprende** — grava na biblioteca.

Hoje a biblioteca vive **so no `localStorage` do navegador** (1 dispositivo, sem
versao, sem revisao, sem backup):

| Chave localStorage     | Variavel interna        | Conteudo                                                                 |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `atacaderj_apelidos`   | `_apelidos`             | Map `termo -> [codigos]`. Aprendido por `aprenderApelido()`. Cap 400.    |
| `atacaderj_buscas`     | `_buscasSalvas`         | Map `chaveBusca -> resultado`. Versionado por `versaoCatalogo()`. Cap 600/400. |
| `atacaderj_ausentes`   | `_catInteiroAusentes`   | Chaves que **nem o catalogo inteiro achou** (as falhas do fallback). Cap 300. |
| `atacaderj_catalogo`   | override do catalogo    | `{ produtos:[{c,p,q,v,vu}], data }`.                                      |

O problema: **um aprendizado errado contamina todas as rodadas seguintes**. Um
apelido apontando para o codigo errado faz a IA "acertar com confianca" o
produto errado (mata a **qualidade**); um termo duplicado ou um JSON quebrado
pode fazer o reuso de busca parar de bater (mata a **velocidade** e queima
**tokens** reprocessando). Como o aprendizado e cumulativo, o estrago se propaga
silenciosamente.

A robustez do projeto move esse aprendizado para **arquivos versionados** no
repositorio, dentro de `biblioteca/`:

```
biblioteca/
  apelidos.json     <- espelha atacaderj_apelidos   { entradas: [[termo,[cods]], ...] }
  ausentes.json     <- espelha atacaderj_ausentes   { versao, itens: [chave, ...] }
  correcoes.jsonl   <- log append-only de correcoes manuais (1 JSON por linha)
  catalogo.json     <- OPCIONAL: { produtos:[{c,p,q,v,vu}], data } (lista de codigos)
```

Versionado = tem historico, tem revisao, tem rollback. E e exatamente por ser
versionado que da para colocar um **gate automatico antes de cada mudanca**.

---

## 2. Como o CI protege cada rodada

O gate e o workflow [`.github/workflows/validar.yml`](../.github/workflows/validar.yml),
que dispara em **`pull_request`** e em **`push`**. Ele faz:

1. **Checkout** do repositorio.
2. **Instala Node 20**.
3. **GATE 1 — valida a biblioteca**: roda
   [`ferramentas/validar-biblioteca.mjs`](../ferramentas/validar-biblioteca.mjs).
4. **GATE 2 — benchmark estatico**: roda `benchmark/avaliar.mjs --estatico`
   (so com dados commitados, sem API).

Se qualquer um sair com codigo `!= 0`, o **check fica vermelho** e o merge e
bloqueado.

### O validador (`ferramentas/validar-biblioteca.mjs`)

E um script Node (ESM) **estatico**: nao chama a API da Anthropic, nao acessa a
rede, nao precisa de segredos. Ele verifica:

- **Schema correto** de cada arquivo — exatamente o formato que o app le/grava
  (ex.: `apelidos.json` precisa ser `{ entradas: [[termo, [cods]], ...] }`, com
  `cods` inteiros; `ausentes.json` precisa de `versao` string e `itens` array de
  strings).
- **Sem termo de apelido duplicado** — um `Map` nao pode ter chave repetida; se o
  arquivo tem o mesmo `termo` em duas entradas, e erro (os codigos deveriam estar
  fundidos numa unica entrada).
- **Sem apelido orfao** — se houver `biblioteca/catalogo.json`, **nenhum** apelido
  pode apontar para um codigo que nao existe no catalogo. Esse e o erro mais
  perigoso para a **qualidade**: um apelido orfao e um match errado aprendido.
- **`correcoes.jsonl` valido linha a linha** — cada linha nao-vazia precisa ser um
  objeto JSON valido, com `termo` e `codigos` coerentes; numa correcao `add`, os
  codigos tambem precisam existir no catalogo.

Ele imprime um **relatorio legivel** (contexto, avisos, erros) e **sai com codigo
`!= 0` se houver qualquer inconsistencia**. Exemplo de saida quando ha problema:

```
--- ERROS (bloqueiam o merge) ---
  X apelidos.json: termo DUPLICADO "amac ype" (entradas[1] e entradas[0]). ...
  X apelidos.json: APELIDO ORFAO — "amac ype" aponta para codigo 999, que nao existe no catalogo.json.
  X correcoes.jsonl:2: JSON invalido — Expected double-quoted property name ...
==========================================================
 Resultado: INCONSISTENTE  (3 erro(s), 0 aviso(s))
```

Para rodar localmente antes de abrir o PR:

```bash
node ferramentas/validar-biblioteca.mjs            # usa ./biblioteca
node ferramentas/validar-biblioteca.mjs --strict   # avisos viram erros
```

### Por que o benchmark roda em modo estatico (sem API)

O CI **nao tem** (e nao deve ter) chave da API. O app, em producao, chama
`api.anthropic.com` direto do navegador **sem `x-api-key`**, dependendo de um
proxy/sessao — credencial nenhuma vive no repositorio. Por isso o gate roda o
benchmark com `--estatico`: ele mede a qualidade do match usando **so os
casos-ouro e a biblioteca ja commitados**, comparando contra o esperado, sem
gastar uma unica requisicao nem um unico token. Isso mantem o gate **rapido,
deterministico e gratuito** — e fiel ao eixo **tokens**: o proprio gate custa
zero tokens.

> O passo do benchmark e tolerante: se `benchmark/avaliar.mjs` ainda nao existe
> no repo, o passo apenas emite um aviso e segue. Assim que o arquivo for
> commitado, ele passa a rodar e pode reprovar o PR.

---

## 3. Fluxo: abrir uma rodada via branch + PR

Toda mudanca na biblioteca (novos apelidos aprendidos, correcoes manuais,
atualizacao de catalogo) entra pelo mesmo caminho:

```
main  ──────────────●──────────────────────────●─────▶
                     │                          ▲
                     │ (1) branch               │ (5) merge
                     ▼                          │
 rodada/2026-06-29 ──●──●──●───────────────────●
                     (2)(3) commit   (4) PR + CI verde
```

1. **Crie um branch** para a rodada (nunca commite direto na `main`):

   ```bash
   git switch -c rodada/2026-06-29
   ```

2. **Exporte o aprendizado** do navegador para `biblioteca/` (snippet de console
   de export -> salvar `apelidos.json` / `ausentes.json`; anexar correcoes
   manuais em `correcoes.jsonl`).

3. **Valide localmente** antes de empurrar — pega o erro na sua maquina, sem
   gastar uma rodada de CI:

   ```bash
   node ferramentas/validar-biblioteca.mjs
   git add biblioteca/ && git commit -m "rodada 2026-06-29: novos apelidos + correcoes"
   git push -u origin rodada/2026-06-29
   ```

4. **Abra o Pull Request** para a `main`. O push e o PR disparam
   `validar-biblioteca`. O CI roda o validador e o benchmark estatico:
   - **Verde** -> a biblioteca esta consistente; pode revisar e mesclar.
   - **Vermelho** -> leia o log do passo que falhou, corrija no branch, commite
     de novo (o CI roda outra vez sozinho).

5. **Merge** so depois do check verde (idealmente com a branch protegida exigindo
   o check `validar-biblioteca` — veja abaixo).

### Recomendado: branch protegida

Em **Settings -> Branches -> Branch protection rules** da `main`, marque
**"Require status checks to pass before merging"** e selecione o check
**`validar-biblioteca`**. Com isso, o botao de merge fica **desabilitado** ate o
gate passar — a protecao deixa de depender de disciplina humana e passa a ser
imposta pela plataforma.

---

## 4. Por que o gate roda no PR, **antes** do merge

Rodar a validacao no PR (e nao so depois que o codigo ja entrou na `main`) e o
ponto central da automacao:

- **A `main` permanece sempre confiavel.** Cada rodada parte da biblioteca da
  `main`. Se uma biblioteca quebrada entrar na `main`, **toda rodada seguinte**
  parte de um estado corrompido — e o estrago e cumulativo (aprendizado por cima
  de aprendizado errado). Barrar no PR mantem a `main` como uma base de partida
  sempre boa.

- **O erro e barato no PR e caro na producao.** No PR, o custo de um apelido
  orfao e um check vermelho e uma correcao de 1 linha. Em producao, e a IA
  "acertando com confianca" o produto errado numa cotacao de cliente — perda de
  **qualidade** que pode virar prejuizo real de margem.

- **Revisao acontece sobre um diff ja validado.** Quem aprova o PR ve, ao lado do
  diff, o check ja verde. A revisao humana foca no que importa (esse apelido faz
  sentido para o negocio?) em vez de cacar erro de schema ou virgula.

- **Feedback rapido e isolado.** O gate roda **so no branch da rodada**, sem
  afetar a `main` nem outras rodadas em andamento. Cada PR e um experimento
  isolado: se reprovar, o estrago fica contido no branch.

- **Custo zero e sem segredos.** Como o gate e estatico (sem API, sem
  `x-api-key`), ele pode rodar em **todo** PR e **todo** push sem gastar tokens e
  sem expor credencial — fiel ao eixo **tokens** ate no proprio CI.

Em uma frase: **o gate no PR transforma "a gente confia que a biblioteca esta
boa" em "o robo provou que a biblioteca esta boa antes de qualquer rodada nova
comecar".**

---

## 5. Referencia rapida

| Arquivo                                   | Papel                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `ferramentas/validar-biblioteca.mjs`      | Valida schema, duplicatas, orfaos e `correcoes.jsonl`. Sai != 0 se inconsistente. |
| `.github/workflows/validar.yml`           | Roda o validador + benchmark estatico em PR e push. Sem segredos. Falha o check se inconsistente. |
| `benchmark/avaliar.mjs --estatico`        | Mede qualidade do match com dados commitados, sem API (entregue por outra tarefa). |
| `biblioteca/*.json` / `correcoes.jsonl`   | A biblioteca de aprendizado versionada que o gate protege.        |

```bash
# checagem local, igual a do CI:
node ferramentas/validar-biblioteca.mjs biblioteca
```
