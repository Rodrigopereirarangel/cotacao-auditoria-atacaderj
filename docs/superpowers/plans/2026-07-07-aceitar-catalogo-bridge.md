# Aceitar o arquivo único do bridge (catalogo_bridge.json) — Plano de Implementação

> **STATUS 2026-07-08: IMPLEMENTADO** (sessão do PC-ponte, commit no CHANGELOG),
> com uma **extensão de contrato**: o arquivo único também carrega
> `"pedidos_venda"` (itens dos pedidos de venda/DAV fechados nos últimos 7
> dias), persistido no storage compartilhado (`atacaderj_pedidos_venda`) pelo
> `confirmarCatalogoBridge()` — é o que faz o seletor de dia da aba 🔍 Auditoria
> funcionar dentro do artifact (sem fetch). O `#catConfirmar` chama
> `confirmarCatalogoBridge()` (que persiste o histórico e delega ao
> `confirmarCatalogo()` intocado); os IDs do contrato com o robô não mudaram.
> Diferença p/ este plano: a cópia pública do app não tem a constante da trava
> de integridade, então `npm run selar` não se aplica (validação usada:
> `ferramentas/_aud/validar-sintaxe.mjs`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O botão "📦 Catálogo" do app passa a aceitar o `catalogo_bridge.json` gerado pelo `erp-bridge-atacaderj` (arquivo único, já mesclado e com data), mantendo o fluxo dos 3 relatórios do ERP como contingência — e com IDs estáveis para o robô de upload operar.

**Architecture:** Duas mudanças no `app/cotacao-auditoria-atacaderj.html` (dentro do `#app-core`): (1) novas funções `processarCatalogoBridge` + helpers, inseridas antes de `abrirAtualizarCatalogo`; (2) uma seção "Arquivo único do bridge" no topo do modal do catálogo, com `input#catBridgeArq` (auto-processa no `onchange`) e botão de confirmação `#catConfirmar` que reusa o `confirmarCatalogo()` existente (storage, chips, reset de buscas e snapshot continuam iguais). Um gerador de fixture em `ferramentas/` permite testar offline (o fluxo de catálogo não usa IA).

**Tech Stack:** HTML/JS vanilla (app é 1 arquivo), Node (ferramentas), selo de integridade via `npm run selar`.

**Spec:** `erp-bridge-atacaderj/docs/superpowers/specs/2026-07-07-estrutura-acesso-cotacao-design.md`

## Global Constraints

- **Após QUALQUER mudança no app**: rodar `npm run selar` (recalcula o hash de integridade do `#app-core`) antes do commit; `npm run selar:check` deve passar.
- **IDs estáveis — contrato com o robô** (não renomear nunca): `btnCatalogo` e `catalogBadge` (já existem), `catBridgeArq` e `catConfirmar` (novos).
- Fluxo dos 3 relatórios (atacado/varejo/curva) **intocado** — é o plano C.
- Formato consumido (contrato verbatim com o bridge): `{"origem":"erp-bridge","gerado_em":"YYYY-MM-DD HH:MM:SS","total":N,"produtos":[{"c","p","q","v","vu"?,"custo"?,"cv"?}]}`; `gerado_em` TEM que ser de hoje (mesma exigência dos 3 relatórios).
- Mensagens de erro no padrão do app: explicar o problema e terminar com "Nada foi alterado no banco atual."
- Commits em pt-BR, estilo do histórico (`app:`, `ferramentas:`, `docs:`). Push ao final.

---

### Task 1: Gerador de fixture (`ferramentas/gerar-fixture-bridge.mjs`)

**Files:**
- Create: `ferramentas/gerar-fixture-bridge.mjs`

**Interfaces:**
- Produces: `node ferramentas/gerar-fixture-bridge.mjs` → escreve `ferramentas/fixtures/catalogo_bridge.hoje.json` (60 produtos falsos, `gerado_em` = agora). Usado nos testes manuais da Task 2.

- [ ] **Step 1: Criar o script**

```javascript
// Gera um catalogo_bridge.json FALSO com data de hoje, para testar o fluxo
// "Arquivo único do bridge" do app sem depender do erp-bridge/MySQL.
// Uso: node ferramentas/gerar-fixture-bridge.mjs
import fs from 'node:fs';

const agora = new Date();
const p2 = n => String(n).padStart(2, '0');
const gerado_em = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}` +
                  ` ${p2(agora.getHours())}:${p2(agora.getMinutes())}:00`;

const produtos = [];
for (let i = 1; i <= 60; i++) {
  const item = {
    c: 1000 + i,
    p: `PRODUTO TESTE ${String(i).padStart(3, '0')} 1KG`,
    q: i % 5 === 0 ? 12 : 1,
    v: Math.round((2 + i * 0.37) * 100) / 100,
  };
  if (i % 5 === 0) item.vu = Math.round(item.v * 1.25 * 100) / 100; // tem preco de varejo
  if (i % 2 === 0) item.custo = Math.round(item.v * 0.8 * 100) / 100;
  if (i % 7 === 0) item.cv = 'A';
  produtos.push(item);
}

const obj = { origem: 'erp-bridge', gerado_em, total: produtos.length, produtos };
fs.mkdirSync('ferramentas/fixtures', { recursive: true });
fs.writeFileSync('ferramentas/fixtures/catalogo_bridge.hoje.json', JSON.stringify(obj));
console.log(`OK ferramentas/fixtures/catalogo_bridge.hoje.json — ${produtos.length} produtos, ${gerado_em}`);
```

- [ ] **Step 2: Rodar e conferir**

Run: `node ferramentas/gerar-fixture-bridge.mjs`
Expected: `OK ferramentas/fixtures/catalogo_bridge.hoje.json — 60 produtos, <data de hoje>`

- [ ] **Step 3: Ignorar as fixtures geradas e commitar**

Acrescentar ao `.gitignore`:

```text
ferramentas/fixtures/
```

```bash
git add ferramentas/gerar-fixture-bridge.mjs .gitignore
git commit -m "ferramentas: gerador de fixture do catalogo_bridge.json (teste offline)"
```

---

### Task 2: App aceita o arquivo único (funções + seção no modal)

**Files:**
- Modify: `app/cotacao-auditoria-atacaderj.html` (duas regiões dentro do `#app-core`)

**Interfaces:**
- Consumes: `confirmarCatalogo()`, `_novoCatalogo`, `_escHtml`, `_fmtR`, `_temVarejo` — todos já existem no `#app-core`.
- Produces: `processarCatalogoBridge(input)` (onchange do `#catBridgeArq`); botão `#catConfirmar` na prévia (o robô clica nele); nada muda em `confirmarCatalogo`, storage ou trava de data.

- [ ] **Step 1: Inserir as novas funções**

Localizar (Grep) `function abrirAtualizarCatalogo()` e inserir IMEDIATAMENTE ANTES dela:

```javascript
function _brDataHoje(){return new Date().toLocaleDateString('pt-BR');}
function _bridgeDataDoGeradoEm(g){const m=String(g||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1]}`:null;}
async function processarCatalogoBridge(input){const res=document.getElementById('catBridgeResultado');const file=input.files[0];if(!file)return;input.value='';
try{const obj=JSON.parse(await file.text());
if(obj.origem!=='erp-bridge'||!Array.isArray(obj.produtos))throw new Error(`"${file.name}" não é um catalogo_bridge.json do erp-bridge (campos origem/produtos ausentes). Nada foi alterado no banco atual.`);
const dataArq=_bridgeDataDoGeradoEm(obj.gerado_em);
if(!dataArq)throw new Error(`"${file.name}": campo gerado_em ilegível (${obj.gerado_em}). Nada foi alterado no banco atual.`);
if(dataArq!==_brDataHoje())throw new Error(`"${file.name}" foi gerado em ${dataArq}, NÃO é de hoje (${_brDataHoje()}). Preços mudam todo dia — rode o bridge de novo. Nada foi alterado no banco atual.`);
const produtos=[];for(const r of obj.produtos){const c=parseInt(r.c);const p=String(r.p||'').toUpperCase().trim();const v=Number(r.v);let q=parseInt(r.q);if(!Number.isFinite(q)||q<1)q=1;
if(!Number.isInteger(c)||p.length<4||!(v>0))continue;if(/MORTO|EXCLUIDO|<<<.*>>>/.test(p))continue;
const item={c,p,q,v:Math.round(v*100)/100};const vu=Number(r.vu);if(vu>0&&Math.round(vu*100)/100!==item.v)item.vu=Math.round(vu*100)/100;
const custo=Number(r.custo);if(custo>0)item.custo=Math.round(custo*100)/100;if(r.cv)item.cv=String(r.cv).trim().toUpperCase()[0];
produtos.push(item);}
if(produtos.length<=50)throw new Error(`"${file.name}": só ${produtos.length} produtos válidos — arquivo suspeito de estar incompleto. Nada foi alterado no banco atual.`);
if(Number.isInteger(obj.total)&&obj.total!==produtos.length)throw new Error(`"${file.name}": o arquivo declara ${obj.total} produtos, mas a leitura validou ${produtos.length}. Gere de novo pelo bridge — nada foi alterado no banco atual.`);
produtos.sort((a,b)=>a.p.localeCompare(b.p,'pt-BR'));_novoCatalogo=produtos;
const nAtacado=produtos.filter(x=>x.vu!=null).length;const nCurvaA=produtos.filter(x=>x.cv==='A').length;const nCusto=produtos.filter(x=>x.custo!=null).length;const amostra=produtos.slice(0,5);
res.innerHTML=`
  <div style="font-size:12.5px;line-height:1.7;background:#f0f4ff;border:1px solid #d0d8f0;border-radius:8px;padding:10px 14px;color:#0D3364">
    ✓ <b>${_escHtml(file.name)}</b> gerado hoje às ${String(obj.gerado_em).slice(11,16)} pelo erp-bridge<br>
    ✓ <b>${produtos.length.toLocaleString('pt-BR')} produtos</b> — ${nAtacado.toLocaleString('pt-BR')} com preço de atacado · ${nCurvaA.toLocaleString('pt-BR')} curva A · ${nCusto.toLocaleString('pt-BR')} com custo
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-top:10px">
    <tr style="text-align:left;opacity:.6;text-transform:uppercase;font-size:10px"><th style="padding:3px">Cód.</th><th style="padding:3px">Produto</th><th style="padding:3px;text-align:center">Qtde</th><th style="padding:3px;text-align:right">Preço</th></tr>
    ${amostra.map(p2 => `<tr style="border-top:1px solid rgba(128,128,128,.2)"><td style="padding:4px 3px">${p2.c}</td><td style="padding:4px 3px">${_escHtml(p2.p)}</td><td style="padding:4px 3px;text-align:center">${_temVarejo(p2)||p2.q>1?'mín '+p2.q:'un'}</td><td style="padding:4px 3px;text-align:right">${_temVarejo(p2)?'un '+_fmtR(p2.vu)+' · ':''}${_fmtR(p2.v)}</td></tr>`).join('')}
  </table>
  <button id="catConfirmar" onclick="confirmarCatalogo()" style="width:100%;height:40px;margin-top:12px;border:none;border-radius:8px;background:#1a7f37;color:#fff;font-weight:700;font-size:13px;cursor:pointer">✓ Substituir catálogo (${produtos.length.toLocaleString('pt-BR')} produtos)</button>`;
}catch(e){console.error('Catálogo bridge:',e);_novoCatalogo=null;res.innerHTML=`
  <div style="font-size:13px;line-height:1.6;background:#fde8e8;border:1.5px solid #c0392b;border-radius:8px;padding:12px 14px;color:#8c1d12;font-weight:700">
    ⚠️ ATENÇÃO — ERRO NO ARQUIVO DO BRIDGE<br><span style="font-weight:600">${_escHtml(e.message)}</span>
  </div>`;}}
```

- [ ] **Step 2: Inserir a seção no modal do catálogo**

Dentro de `abrirAtualizarCatalogo()`, no template do modal, localizar a linha do rótulo
`1 — Relatório de ATACADO` (logo acima do `input#catArq1`) e inserir IMEDIATAMENTE ANTES dela:

```html
      <div style="border:1.5px solid #bfe3cb;background:#e7f5ec;border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:13px;font-weight:800;color:#157f3b;margin-bottom:6px">⚡ Arquivo único do bridge (recomendado)</div>
        <p style="font-size:12px;line-height:1.5;margin-bottom:8px;color:#1d2733">
          Selecione o <b>catalogo_bridge.json</b> gerado pelo erp-bridge (pasta da loja).
          Já vem mesclado (atacado + varejo + promoção + curva + custo) e validado por data.
        </p>
        <input type="file" id="catBridgeArq" accept=".json,application/json" style="width:100%;font-size:12px" onchange="processarCatalogoBridge(this)">
        <div id="catBridgeResultado" style="margin-top:10px"></div>
      </div>
      <div style="font-size:11px;font-weight:800;color:#94a1b2;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Contingência — 3 relatórios do ERP</div>
```

- [ ] **Step 3: Re-selar o app**

Run: `npm run selar`
Expected: recalcula e grava o hash de integridade do `#app-core`.

Run: `npm run selar:check`
Expected: OK (hash confere).

- [ ] **Step 4: Teste manual — caminho feliz**

1. `node ferramentas/gerar-fixture-bridge.mjs`
2. Abrir `app/cotacao-auditoria-atacaderj.html` direto no navegador (duplo clique; o fluxo de catálogo não usa IA).
3. Clicar em "📦 Catálogo" → na seção verde, selecionar `ferramentas/fixtures/catalogo_bridge.hoje.json`.
Expected: prévia azul com "60 produtos — 12 com preço de atacado · 8 curva A · 30 com custo" + tabela de 5 amostras + botão verde "✓ Substituir catálogo (60 produtos)".
4. Clicar no botão verde.
Expected: dispara o download do snapshot da biblioteca (comportamento existente), o modal fecha, a barra de status mostra "✓ Catálogo substituído: 60 produtos em uso." e o chip `📦 catálogo atualizado em <hoje> — 60 produtos` aparece.
5. Recarregar a página e clicar em "Cotar" com um item qualquer digitado.
Expected: NÃO aparece o modal vermelho "banco de dados desatualizado" (a trava reconhece a data de hoje).

- [ ] **Step 5: Teste manual — caminho de erro (arquivo velho)**

1. Gerar uma fixture velha:

```bash
node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync('ferramentas/fixtures/catalogo_bridge.hoje.json'));o.gerado_em='2020-01-01 05:00:00';fs.writeFileSync('ferramentas/fixtures/catalogo_bridge.velho.json',JSON.stringify(o));console.log('ok')"
```

2. No modal 📦, selecionar `catalogo_bridge.velho.json`.
Expected: caixa vermelha "⚠️ ATENÇÃO — ERRO NO ARQUIVO DO BRIDGE … foi gerado em 01/01/2020, NÃO é de hoje … Nada foi alterado no banco atual." e o catálogo em uso NÃO muda.
3. Selecionar um `.json` qualquer inválido (ex.: `package.json`).
Expected: caixa vermelha "não é um catalogo_bridge.json do erp-bridge…".

- [ ] **Step 6: Commit**

```bash
git add app/cotacao-auditoria-atacaderj.html
git commit -m "app: botao Catalogo aceita o arquivo unico do erp-bridge (catalogo_bridge.json) com validacao de data; 3 relatorios viram contingencia"
```

---

### Task 3: CHANGELOG + push

**Files:**
- Modify: `CHANGELOG.md` (seção `## [Não liberado]`)

- [ ] **Step 1: Adicionar a entrada** (dentro de `## [Não liberado]`, acima das rodadas):

```markdown
### Integração erp-bridge — arquivo único de catálogo
- Botão "📦 Catálogo" aceita o `catalogo_bridge.json` do repo `erp-bridge-atacaderj`
  (mesclado: atacado+varejo+promoção+curva+custo; exige `gerado_em` de hoje).
  Os 3 relatórios do ERP viram contingência. IDs estáveis p/ o robô de upload:
  `#catBridgeArq`, `#catConfirmar` (novos), `#btnCatalogo`, `#catalogBadge` (existentes).
- `ferramentas/gerar-fixture-bridge.mjs` — fixture falsa p/ testar o fluxo offline.
- App re-selado (`npm run selar`).
```

- [ ] **Step 2: Commit e push**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog — integracao com o erp-bridge (arquivo unico)"
git push
```

---

## Depois deste plano (manual)

- Republicar o app como artifact na conta Claude (com estas mudanças) e copiar o link —
  ele é o `artifact_url` do robô (plano do repo `erp-bridge-atacaderj`).
- O upload real diário passa a ser feito pelo robô; manualmente, é o mesmo botão 📦.
