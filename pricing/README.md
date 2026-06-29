# pricing-atacaderj

Sistema de **precificação semanal de prateleira** para um atacarejo único (CEASA / São Gonçalo-RJ).

> **Status:** fase de design. Ainda **não há código** — só o documento de design. A implementação vem depois, a partir do plano gerado por `writing-plans`.

## O que é

Um motor que, toda semana, propõe preços para três zonas:

- **KVI (vitrine, ~20-30 SKUs):** sempre competitivos contra 2-3 vizinhos.
- **Cauda (baixo giro):** busca o *sweet spot* de lucro item a item (hill-climb por giro × lucro unitário).
- **Ponta de gôndola (10 SKUs/semana):** única exposição extra, em promo controlada.

Prioridade: **lucro total**, não margem nem volume isolados. Travas duras: piso de margem por item e paridade etiqueta=caixa (PROCON).

## Arquitetura (resumo)

Pipeline **determinístico em Python** (extrator + motor) + **camada de IA opcional** que critica/explica/propõe melhorias (nunca calcula preço) + **UI de revisão** local (HTML servido por `serve.py`). Estado em **JSONs datados em disco**. MySQL acessado **somente-leitura**; o sistema nunca escreve no banco. Modelo: **propõe, humano aplica**.

## Documentação

- Design completo: [`docs/superpowers/specs/2026-06-27-precificacao-atacaderj-design.md`](docs/superpowers/specs/2026-06-27-precificacao-atacaderj-design.md)

## Privacidade

Preço e custo **não saem da rede local**. A camada de IA é opcional e, quando ligada, recebe dados **anonimizados**.
