# Design — Sistema de Precificação Semanal (Atacaderj)

- **Data:** 2026-06-27
- **Status:** **Aprovado pelo usuário em 2026-06-27.** Seguindo para `writing-plans` (plano de implementação).
- **Loja:** atacarejo único (CEASA, São Gonçalo/RJ). Markup agregado ~20%.

---

## 1. Objetivo

Desenhar um **motor semanal de precificação de prateleira** para uma loja física única que: mantém os ~20-30 itens-vitrine (KVI) competitivos contra 2-3 vizinhos diretos, sobe lucro na cauda de baixo giro via busca de *sweet spot* item a item, usa a ponta de gôndola como única exposição extra, e respeita travas duras (piso de margem por item + paridade etiqueta=caixa/PROCON). **Prioridade = lucro total (giro × lucro unitário), não margem nem volume isolados.**

## 2. Restrições (tratadas como lei)

- Loja **única**; preço de etiqueta público; **sem** negociação por cliente.
- Concorrência = só os **2-3 vizinhos locais**; ignorar "mercado" amplo.
- Gôndola **não** é alavanca, **exceto a ponta**.
- **Não** usar ML; regras + ritual. (A camada de IA é crítico/explicador, nunca calcula preço — ver §9.)
- KVI sempre competitivo; cauda captura lucro onde o cliente não decora preço.
- **Travas duras:** piso `preco_min` por item (inviolável) + **paridade gôndola=caixa** (PROCON).
- Banco MySQL é acessado por usuário **`viewer` somente-leitura** — o sistema **nunca** escreve no banco.

## 3. Princípios de produto

1. **Barata onde o cliente olha, lucrativa onde ele não olha.**
2. **Número vem do código; juízo e narrativa vêm da IA.** A IA nunca define preço.
3. **HOLD ("não mexer") é decisão de primeira classe**, não falha.
4. **Privacidade:** **não é restrição dura** deste projeto (decisão do usuário, 2026-06-27) — a camada de IA pode operar sobre os dados completos. Anonimização / modelo local ficam como opções futuras, não requisitos (§9.3).
5. **Tool propõe, humano aplica** (modelo 1-A). O sistema só sugere; o gestor aplica no ERP.

## 4. Arquitetura (visão geral)

Fluxo híbrido: pipeline determinístico em Python + camada de IA opcional por cima + UI de revisão isolada.

```
MySQL (viewer, RO)
      │  (extração agendada, regular)
      ▼
[A] Extrator (Python)  ──►  dados_AAAA-Sxx.json   (dados crus da semana)
      │
      ▼
[B] Motor determinístico (Python)  ──►  sugestoes_AAAA-Sxx.json  +  estado (§11)
      │
      ▼
[C] Camada de IA (Python, OPCIONAL/toggle)  ──►  anota/critica/propõe (§9)
      │
      ▼
[E] UI de revisão (HTML/JS vanilla, servida por serve.py)
      │  gestor revisa, edita, aprova
      ▼
[F] Export: Excel + PDF
      │
      ▼
Gestor aplica os preços no ERP (manual)
      │
      └──► próxima extração traz o preço praticado real ──► motor reconcilia (§11)
```

A ferramenta é **isolada** do `cotacao.html`: HTML próprio, código próprio. Único ponto de contato com o mundo da cotação seria, no máximo, ler o `produtos.json` — mas este projeto usa seu **próprio extrator/JSON** (§5).

## 5. Dados de entrada (do extrator [A])

Um script Python próprio (no padrão do `bridge_export.py` existente) extrai do MySQL, regularmente, por SKU:

| Campo | Uso |
|---|---|
| `interno` (código) | chave do SKU |
| `produto`, `emb` | descrição |
| `curva` (ABC) | separa KVI vs cauda |
| `custo` | base do markup (atualizado a cada extração) |
| `preco_praticado` | preço atual de prateleira (reconciliação, §11) |
| `preco_min` | **piso/trava de margem** (inviolável) |
| `giro_semana` | venda da semana corrente |
| `giro_ewma90` | baseline suavizado (EWMA 90 dias) do giro |
| `preco_vizinhos[]` | preço dos 2-3 vizinhos para os KVI |

> Régua de preço: sempre **markup sobre o custo** — `preço = custo × (1 + markup)`. Margem (sobre o preço) **não** é usada.

## 6. As três zonas

### 6.1 KVI — itens-vitrine (~20-30, "vivo")

- **Seleção: híbrida.** O tool sugere por curva A + maior giro; o gestor **edita e trava** a lista. Revista a cada trimestre.
- **Regra de preço:** os **3-5 "estrela"** (sugeridos por maior tráfego/giro, gestor confirma) **afundam abaixo do menor vizinho**; os demais KVI **igualam o menor vizinho**. Sempre respeitando `preco_min`.

### 6.2 Cauda — baixo giro (captura de lucro)

- Motor de **subida de morro (hill-climb)** no lucro unitário, item a item (§8).
- Markup por **curva** (B e C com alvos distintos) como ponto de partida; o degrau ajusta a partir do markup atual de cada item.

### 6.3 Ponta de gôndola (única exposição extra)

- **10 SKUs/semana.** Sugeridos por **margem alta × giro médio**; gestor confirma. **Nunca** recebe KVI.
- **Preço:** promo controlada **acima do piso** (troca um pouco de margem por giro, aproveitando a exposição).

## 7. Cadência

- **O motor "pensa" toda semana** (agilidade do atacarejo: custo CEASA muda quase diário): analisa preço praticado vs semana anterior + giro + markup e **sugere**.
- **A aplicação é seletiva:** só entra na lista de reetiquetagem o SKU cujo preço novo difere do atual **acima de um limiar** (corta trabalho de etiqueta e risco PROCON). Nem tudo muda toda semana. **O valor do limiar fica a definir futuramente** — parâmetro em aberto, calibrável (decisão do usuário, 2026-06-27).

## 8. Motor de aprendizado (escada + braço de teste — unificados)

**Insight central:** a "escada de margem" e o "braço de teste" são a **mesma coisa** — um *hill-climb* no **lucro unitário** (`giro × (preço − custo)`) de cada item. A direção do degrau é "ladeira acima" em lucro; o tamanho vem da faixa de markup; o freio lê, através do ruído semanal, se o último passo ajudou.

### 8.1 Degrau bidirecional por faixa de markup

Degrau **± (sobe ou desce)**, **pré-estabelecido por faixa**: margem menor → degrau menor (mais sensível, menos ruído); margem maior → degrau maior (mais folga pra achar o *sweet spot*).

| Markup atual do item | Degrau semanal (±) |
|---|---|
| < 15% (magro) | ±0,3 pp |
| 15–30% | ±0,5 pp |
| 30–50% | ±0,7 pp |
| > 50% (gordo) | ±1,0 pp |

*(Valores iniciais; calibráveis com dados reais.)*

### 8.2 Freio de giro (robusto ao ruído semanal)

Giro semanal de atacarejo é barulhento — o freio **não** olha uma semana isolada. Combina:

- **(a) Baseline EWMA 90d:** compara o giro da semana com sua própria média exponencial de 90 dias (semanas recentes pesam mais).
- **(b) Relativo ao controle:** compara a variação do item com a variação **média da cauda** na mesma semana — se o item caiu *muito mais que o conjunto*, é preço; se caiu junto com todo mundo, foi a semana (fluxo/feriado/clima).
- Recuo só quando **(a) E (b)** apontam o mesmo, tornando o **valor exato do gatilho pouco crítico** (começa frouxo, o histórico calibra).

### 8.3 Braço de teste deliberado

- **5 SKUs/semana** (ajustável) da cauda C elegível (giro estável, histórico mínimo; gestor pode vetar).
- Magnitude **±8%** no preço; **4 sobe / 1 desce** (prioriza lucro; 1 "pra baixo" ancora a curva).
- Nesses SKUs **não** se aplica a escada de rotina (a única coisa que muda é o teste).
- Comparação **semanal** contra a semana anterior + EWMA; o resultado **sugere a próxima magnitude/direção**.
- Tudo alimenta uma **tabela de sensibilidade revelada** acumulada (o "aprendizado" sem ML).

## 9. Camada de IA (crítico / explicador) — OPCIONAL

### 9.1 Escopo

A IA **lê a saída determinística** e:

1. **Por decisão:** aponta onde a regra deve ser **respeitada** vs onde vale **sobrescrever** (exceções justificadas), e **escreve a justificativa em português** de cada mudança.
2. **No projeto:** propõe **melhorias para a semana seguinte** (ajuste de faixas, gatilho, lista KVI), com evidência.

A IA **nunca calcula preço e nunca aplica** — só sugere e justifica; o gestor aceita/ignora.

### 9.2 Trava anti-overfit (impedir o "loop que gira sem sair do lugar")

1. **Duas cadências:** o motor **age** semanal, mas **parâmetros ficam congelados** por janela maior; a IA só propõe mexer em parâmetro numa cadência **lenta** (ex.: a cada 4 semanas) e **com evidência**.
2. **Zona-morta + histerese:** não reverte movimento recente sem o sinal **furar a zona-morta E persistir**.
3. **Memória de reversões:** se a IA vai desfazer algo que já desfez antes pela mesma razão → bloqueia ou exige evidência muito mais forte.
4. **Orçamento de mudança:** teto de SKUs sobrescritos/semana e de quanto um parâmetro anda/período.
5. **HOLD é saída válida:** sinal que não fura o ruído → recomenda **segurar**.
6. **Métrica "está saindo do lugar?":** acompanha o objetivo (giro×lucro suavizado) **contra** a quantidade de mudança; mudança↑ e objetivo chato → **congela e segura**.
7. **Itens de controle intocados:** linha-base; melhoria só "conta" se **bater o controle**.

### 9.3 Privacidade (decisão: **não é restrição dura**)

Decisão do usuário (2026-06-27): a salvaguarda d+b **não é necessária** neste projeto. A camada de IA pode operar sobre os **dados completos** (API de nuvem, ex.: Claude, aceitável). Anonimização e/ou modelo local permanecem como **opções futuras**, não requisitos. (Diferente da `cotacao-auto`, cuja promessa de "não sai da rede" **não se aplica** aqui.)

## 10. Travas duras

- **Piso `preco_min` inviolável:** nenhum cálculo (escada, teste, promo da ponta, override da IA) pode furar.
- **Paridade gôndola=caixa (PROCON):** garantida na aplicação (humano) + reconciliação (§11). O sistema nunca altera caixa sem que a etiqueta correspondente mude.

## 11. Estado e reconciliação

- **Estado = série de JSONs datados em disco** (ex.: `sugestoes_2026-S27.json`), gravados via um **mini-endpoint no `serve.py`**. Guarda: degrau/posição de cada item, lista KVI travada, log de testes, preços propostos.
- **Sem botão "apliquei".** O sistema descobre o que foi **praticado de verdade** na **próxima extração** (que traz `preco_praticado` real) e **reconcilia** a base/degraus à realidade antes da próxima proposta.
- *Benefício:* o freio de giro compara contra o preço **realmente praticado** → aprendizado honesto mesmo se o gestor sobrescrever propostas.

## 12. Saída e fluxo do gestor (modelo 1-A)

- **Disparo manual:** o gestor abre/triga o app; o motor roda com o JSON mais recente.
- **Tela de revisão (HTML):** lista por zona, preço atual → sugerido, regra aplicada, números, e (se IA ligada) justificativa + sugestões. Gestor edita/aprova.
- **Export:** **Excel** (conferência) + **PDF** (registro/impressão).
- Gestor aplica no ERP manualmente.

## 13. Pré-mortem (modos de falha → vacina)

| Falha em 6 meses | Vacina |
|---|---|
| Guerra de preço nos KVI | Igualar (não furar) o menor; afundar só 3-5 estrela; piso inviolável |
| Fama de "caro" pela cauda | Teto de markup por faixa; KVIs visíveis carregam a percepção; freio por giro |
| PROCON (etiqueta ≠ caixa) | Aplicação humana + reconciliação na próxima extração; nunca mexe caixa sem etiqueta |
| IA overfitando em loop | Travas §9.2 (duas cadências, zona-morta, memória de reversões, HOLD, métrica de churn) |
| Ruído semanal disparando o freio | EWMA 90d + controle (§8.2) |
| Custo desatualizado → margem ilusória | Cada extração refresca custo; piso usa custo atual |
| Ferramenta vira burocracia | Disparo manual simples; cauda automatizada; humano foca KVI + ponta + revisão |

## 14. Fora de escopo (YAGNI)

- Machine learning / modelos preditivos.
- Escrita no banco (permanece read-only).
- Rede de lojas / multi-loja.
- Otimização de gôndola além da ponta.
- Integração automática de aplicação no ERP (aplicação é humana).

## 15. Componentes e isolamento

| Unidade | Faz o quê | Interface | Depende de |
|---|---|---|---|
| **A. Extrator** | MySQL → `dados_AAAA-Sxx.json` | JSON em disco | MySQL viewer, schema |
| **B. Motor** | dados → `sugestoes` + estado | JSON em disco | A, regras (§6-8) |
| **C. Camada IA** | anota/propõe sobre sugestões | anexa ao JSON de sugestões | B, modelo (local/anon) |
| **D. Estado** | série datada em disco | arquivos JSON | endpoint no serve.py |
| **E. UI** | revisão/edição/aprovação | navegador localhost | B/C JSON, serve.py |
| **F. Export** | Excel + PDF | arquivos | E |

Cada unidade tem propósito único, comunica por JSON em disco, e pode ser testada isolada.

## 16. Testes (como validar)

- **Motor (B):** dados sintéticos → checa degrau por faixa, paridade KVI, piso nunca furado, seleção de ponta.
- **Freio (§8.2):** injeta ruído semanal + queda store-wide → confirma que **não** dispara; injeta queda item-específica persistente → confirma recuo.
- **Anti-overfit (§9.2):** simula série e confirma convergência/HOLD em vez de flip-flop.
- **Reconciliação (§11):** simula override do gestor → confirma que a próxima rodada parte do praticado real.

## 17. Próximos passos

1. Revisão deste spec pelo usuário.
2. `writing-plans` → plano de implementação detalhado.
3. Implementação (extrator → motor → estado/UI → export → camada IA opcional), com TDD.
