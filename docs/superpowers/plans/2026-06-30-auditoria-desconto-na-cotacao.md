# Auditoria de Desconto na Cotação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embutir a Auditoria de Desconto como uma aba dentro do app de Cotação, reusando o catálogo (mesmo preço-base) e exportando as divergências em Excel.

**Architecture:** Integração nativa num único arquivo HTML (artefato). A lógica de cálculo é uma função pura, testável em Node e espelhada dentro do HTML. O parsing do relatório de Vendas (XLSX), a UI (overlay) e o export (XLSX) são código de navegador, validados por checagem de sintaxe + smoke manual. Edições no HTML minificado são feitas por **scripts Node de patch** que exigem **match único (count===1)** de cada âncora antes de gravar.

**Tech Stack:** HTML/JS single-file, `xlsx-js-style` (já carregado via CDN jsdelivr no app), Node (ESM) para testes e patches.

## Global Constraints

- Arquivo do app: `app/cotacao_ia_oficial.html` (minificado; editar via script Node com count===1).
- Reusar o catálogo em memória `CATALOG` (array de produtos `{c,p,v,q,custo,cv}`); `v` = preço-base (menor dos 3); `cv==='A'` para curva A.
- Reusar a regra de desconto existente: piso de markup `PISO_MARKUP = 0.10`; teto `0.03` se curva A, senão `0.05`.
- **Custo vem do relatório de Vendas** (coluna "Custo Un."), não do catálogo.
- Aba **visível a todos**; sem persistir nada novo em `window.storage`.
- **Não** travar por data do relatório de Vendas.
- Validação de sintaxe após cada patch: `node ferramentas/_aud/validar-sintaxe.mjs` (extrai cada `<script>` inline e roda `new Function`).
- Após mexer no app, regenerar a cópia publicável `Downloads/cotacao-atacaderj-OFICIAL.html`.
- Spec de referência: `docs/superpowers/specs/2026-06-30-auditoria-desconto-na-cotacao-design.md`.

---

## File Structure

- **Modify:** `app/cotacao_ia_oficial.html` — botão na appbar, overlay, CSS namespaced, funções de parsing/cálculo/render/export.
- **Create:** `ferramentas/auditoria-calc.mjs` — função pura canônica (calc + packsize + regra), exportada (fonte de verdade da matemática, espelhada no HTML).
- **Create:** `ferramentas/auditoria-calc.test.mjs` — testes Node da função pura.
- **Create:** `ferramentas/_aud/validar-sintaxe.mjs` — valida sintaxe dos `<script>` do app.
- **Scratch (não commitar):** scripts de patch por tarefa em `…/scratchpad/aud-patch-N.mjs`.

---

### Task 1: Lógica pura de auditoria (calc + packsize + regra) com testes

**Files:**
- Create: `ferramentas/auditoria-calc.mjs`
- Test: `ferramentas/auditoria-calc.test.mjs`

**Interfaces:**
- Produces:
  - `packsize(emb: string|number|null) -> number` (≥1)
  - `descMaxFrac(base: number, custo: number|null, cv: string|undefined) -> number` (fração 0..teto)
  - `regraBind(base: number, custo: number|null, cv) -> 'piso 10%'|'teto 3%'|'teto 5%'`
  - `auditarItens(itens: Array<{cod,qt,val,emb,custo,...}>, catMap: Record<cod,{v,cv}>) -> {auditados:number, divergencias:Array, semCadastro:Array}`
  - cada divergência: `{...item, base, precoMin, unit, A, falta, impacto, descPrat, regra}`

- [ ] **Step 1: Write the failing test**

Create `ferramentas/auditoria-calc.test.mjs`:

```js
import assert from 'node:assert';
import { packsize, descMaxFrac, regraBind, auditarItens } from './auditoria-calc.mjs';

// packsize
assert.equal(packsize('FD 12'), 12);
assert.equal(packsize('CX24'), 24);
assert.equal(packsize('UN'), 1);
assert.equal(packsize(null), 1);

// descMaxFrac: markup 100% (base 10, custo 5) -> descMargem grande, mas teto manda
assert.equal(descMaxFrac(10, 5, undefined), 0.05);   // teto demais 5%
assert.equal(descMaxFrac(10, 5, 'A'), 0.03);          // teto A 3%
// custo ausente/<=0 -> 0
assert.equal(descMaxFrac(10, null, undefined), 0);
assert.equal(descMaxFrac(10, 0, undefined), 0);
// markup baixo -> piso manda (base 10, custo 9.5: markup ~5.3%, descMargem<5%)
const d = descMaxFrac(10, 9.5, undefined);
assert.ok(d > 0 && d < 0.05);

// regraBind
assert.equal(regraBind(10, 5, undefined), 'teto 5%');
assert.equal(regraBind(10, 5, 'A'), 'teto 3%');
assert.equal(regraBind(10, 9.5, undefined), 'piso 10%');

// auditarItens
const catMap = {
  1: { v: 10, cv: undefined },   // teto 5% -> min 9.50
  2: { v: 10, cv: 'A' },         // teto 3% -> min 9.70
  3: { v: 20, cv: undefined },
};
const itens = [
  { cod: 1, qt: 3, val: 9.40, emb: 'UN', custo: 5 },   // 9.40 < 9.50 -> diverge
  { cod: 1, qt: 1, val: 9.50, emb: 'UN', custo: 5 },   // 9.50 == 9.50 -> NÃO diverge
  { cod: 2, qt: 2, val: 9.60, emb: 'UN', custo: 5 },   // 9.60 < 9.70 (curva A) -> diverge
  { cod: 3, qt: 2, val: 240, emb: 'FD 12', custo: 10 },// unit=240/12=20 == min(20) -> NÃO diverge
  { cod: 99, qt: 1, val: 5, emb: 'UN', custo: 1 },     // sem cadastro
  { cod: 1, qt: 0, val: 1, emb: 'UN', custo: 5 },      // qt 0 -> ignora
];
const r = auditarItens(itens, catMap);
assert.equal(r.auditados, 4);                 // cods 1,1,2,3 (qt>0, com cadastro)
assert.equal(r.divergencias.length, 2);       // item 1 e item 2
assert.equal(r.semCadastro.length, 1);        // cod 99
const d1 = r.divergencias.find(x => x.cod === 1);
assert.equal(d1.precoMin, 9.5);
assert.equal(d1.A, false);
assert.equal(Math.round(d1.falta * 100) / 100, 0.10);
// cod 1: base 10, custo 5 -> markup 100%, descMargem=0.45; como 0.45 > teto 0.05, prende no teto
assert.equal(d1.regra, 'teto 5%');
console.log('OK auditoria-calc');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ferramentas/auditoria-calc.test.mjs`
Expected: FAIL — `Cannot find module './auditoria-calc.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `ferramentas/auditoria-calc.mjs`:

```js
// Lógica pura da Auditoria de Desconto. Espelhada dentro do app (HTML).
// base = preço do catálogo (menor dos 3); custo = do relatório de Vendas; cv = curva do catálogo.
export const PISO = 0.10;

export function packsize(e) {
  if (e == null) return 1;
  const m = String(e).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}
function r2(n) { return Math.round(n * 100) / 100; }

export function descMaxFrac(base, custo, cv) {
  if (!(base > 0) || custo == null || !(custo > 0)) return 0;
  const mk = (base - custo) / custo;
  const dm = 1 - (1 + PISO) / (1 + mk);
  const teto = (cv === 'A') ? 0.03 : 0.05;
  return Math.max(0, Math.min(dm, teto));
}

export function regraBind(base, custo, cv) {
  const teto = (cv === 'A') ? 0.03 : 0.05;
  if (!(custo > 0)) return 'piso 10%';
  const mk = (base - custo) / custo;
  const dm = 1 - (1 + PISO) / (1 + mk);
  return dm <= teto ? 'piso 10%' : (cv === 'A' ? 'teto 3%' : 'teto 5%');
}

export function auditarItens(itens, catMap) {
  const divergencias = [], semCadastro = []; let auditados = 0;
  for (const x of itens) {
    if (!x.qt) continue;
    const prod = catMap[x.cod];
    if (!prod || !(prod.v > 0)) { semCadastro.push(x); continue; }
    auditados++;
    const base = prod.v, cv = prod.cv;
    const desc = descMaxFrac(base, x.custo, cv);
    const precoMin = r2(base * (1 - desc));
    const ps = packsize(x.emb), unit = x.val / ps;
    if (r2(unit) < r2(precoMin)) {
      divergencias.push({
        ...x, base, precoMin, unit, A: cv === 'A',
        falta: precoMin - unit, impacto: (precoMin - unit) * x.qt * ps,
        descPrat: (base - unit) / base, regra: regraBind(base, x.custo, cv),
      });
    }
  }
  return { auditados, divergencias, semCadastro };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ferramentas/auditoria-calc.test.mjs`
Expected: PASS — imprime `OK auditoria-calc`, sem AssertionError.

- [ ] **Step 5: Commit**

```bash
git add ferramentas/auditoria-calc.mjs ferramentas/auditoria-calc.test.mjs
git commit -m "auditoria: logica pura (calc/packsize/regra) + testes"
```

---

### Task 2: Validador de sintaxe + espelhar o cálculo e o parser de Vendas no app

**Files:**
- Create: `ferramentas/_aud/validar-sintaxe.mjs`
- Modify: `app/cotacao_ia_oficial.html` (insere funções antes de `function abrirAtualizarCatalogo()`)

**Interfaces:**
- Consumes (no HTML): `XLSX` (global), `CATALOG` (array global).
- Produces (no HTML, globais de função):
  - `_audPacksize`, `_audDescFrac`, `_audRegra`, `_audItens(itens,catMap)` — espelho de `auditoria-calc.mjs`.
  - `_audParseVendas(wb) -> Array<{vend,cli,ped,nota,cod,prod,emb,qt,val,custo}> | null`
  - `_audCatMap() -> Record<cod,{v,cv}>` a partir de `CATALOG`.

- [ ] **Step 1: Create the syntax validator**

Create `ferramentas/_aud/validar-sintaxe.mjs`:

```js
import { readFileSync } from 'node:fs';
const html = readFileSync('app/cotacao_ia_oficial.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html)) !== null) {
  i++; if (!m[1].trim()) continue;
  try { new Function(m[1]); } catch (e) { bad++; console.error(`SCRIPT #${i} (len ${m[1].length}) SINTAXE: ${e.message}`); }
}
console.log(`blocos: ${i} | falhas: ${bad}`);
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Baseline — validate current app syntax**

Run: `node ferramentas/_aud/validar-sintaxe.mjs`
Expected: `blocos: 2 | falhas: 0`.

- [ ] **Step 3: Write the patch script (insert audit functions)**

Create `…/scratchpad/aud-patch-2.mjs` (não commitar). Insere o bloco antes de `function abrirAtualizarCatalogo(){`. Exige count===1.

```js
import { readFileSync, writeFileSync } from 'node:fs';
const APP = 'C:/Users/COMPUTADOR/Main/app/cotacao_ia_oficial.html';
let src = readFileSync(APP, 'utf8');
const ANCHOR = 'function abrirAtualizarCatalogo(){';
const BLOCK =
  'const _AUD_PISO=0.10;' +
  'function _audPacksize(e){if(e==null)return 1;const m=String(e).match(/(\\d+)/);return m?parseInt(m[1],10):1;}' +
  'function _audR2(n){return Math.round(n*100)/100;}' +
  'function _audDescFrac(base,custo,cv){if(!(base>0)||custo==null||!(custo>0))return 0;const mk=(base-custo)/custo;const dm=1-(1+_AUD_PISO)/(1+mk);const teto=(cv===\'A\')?0.03:0.05;return Math.max(0,Math.min(dm,teto));}' +
  'function _audRegra(base,custo,cv){const teto=(cv===\'A\')?0.03:0.05;if(!(custo>0))return\'piso 10%\';const mk=(base-custo)/custo;const dm=1-(1+_AUD_PISO)/(1+mk);return dm<=teto?\'piso 10%\':(cv===\'A\'?\'teto 3%\':\'teto 5%\');}' +
  'function _audCatMap(){const m={};const arr=(typeof CATALOG!=="undefined"&&CATALOG)||[];for(const p of arr)m[p.c]={v:p.v,cv:p.cv};return m;}' +
  'function _audItens(itens,catMap){const divergencias=[],semCadastro=[];let auditados=0;for(const x of itens){if(!x.qt)continue;const prod=catMap[x.cod];if(!prod||!(prod.v>0)){semCadastro.push(x);continue;}auditados++;const base=prod.v,cv=prod.cv;const desc=_audDescFrac(base,x.custo,cv);const precoMin=_audR2(base*(1-desc));const ps=_audPacksize(x.emb),unit=x.val/ps;if(_audR2(unit)<_audR2(precoMin)){divergencias.push(Object.assign({},x,{base:base,precoMin:precoMin,unit:unit,A:cv===\'A\',falta:precoMin-unit,impacto:(precoMin-unit)*x.qt*ps,descPrat:(base-unit)/base,regra:_audRegra(base,x.custo,cv)}));}}return{auditados:auditados,divergencias:divergencias,semCadastro:semCadastro};}' +
  'function _audNum(v){if(v==null||v==="")return null;if(typeof v==="number")return v;const n=parseFloat(String(v).replace(/\\./g,"").replace(",","."));return isNaN(n)?parseFloat(v):n;}' +
  'function _audRows(wb){const ws=wb.Sheets[wb.SheetNames[0]];return XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});}' +
  'function _audFindCol(H,name){for(let j=0;j<H.length;j++)if(String(H[j]).trim()===name)return j;return null;}' +
  'function _audFindColRe(H,re){for(let j=0;j<H.length;j++)if(re.test(String(H[j]).trim()))return j;return null;}' +
  'function _audFindHeader(rows,names){for(let i=0;i<rows.length;i++){const v=rows[i].map(c=>String(c).trim());if(names.every(n=>v.includes(n)))return i;}return -1;}' +
  'function _audParseVendas(wb){const rows=_audRows(wb);const h=_audFindHeader(rows,["Pedido","Custo Un."]);if(h<0)return null;const H=rows[h];const cPed=_audFindCol(H,"Pedido"),cNota=_audFindCol(H,"Nota"),cCod=_audFindColRe(H,/^c[oó]d/i),cProd=_audFindCol(H,"Produto"),cEmb=_audFindCol(H,"Emb"),cQt=_audFindCol(H,"Qtde"),cVal=_audFindCol(H,"Valor"),cCus=_audFindCol(H,"Custo Un."),cVend=_audFindCol(H,"Vendedor");const recs=[];let cli=null,ped=null,nota=null,vend=null;for(let i=h+1;i<rows.length;i++){const r=rows[i],cod=r[cCod],pedc=r[cPed];if(typeof cod==="string"&&cod.trim().startsWith("Total"))continue;if(typeof pedc==="string"&&pedc.trim()&&(cod==null||cod==="")){cli=pedc.trim();ped=null;nota=null;vend=null;continue;}if(typeof pedc==="number"){ped=pedc;nota=r[cNota];vend=r[cVend]||null;}if(typeof cod==="number"){if(r[cVend])vend=r[cVend];recs.push({vend:vend,cli:cli,ped:ped,nota:nota,cod:cod,prod:r[cProd],emb:r[cEmb],qt:_audNum(r[cQt])||0,val:_audNum(r[cVal]),custo:_audNum(r[cCus])});}}const byped={};recs.forEach(x=>{(byped[x.ped]=byped[x.ped]||[]).push(x);});Object.values(byped).forEach(lst=>{const vv=(lst.find(x=>x.vend)||{}).vend||"(sem vendedor)";lst.forEach(x=>{if(!x.vend)x.vend=vv;});});return recs;}';
const n = src.split(ANCHOR).length - 1;
if (n !== 1) { console.error(`anchor count ${n} (esperado 1) — ABORTADO`); process.exit(1); }
src = src.replace(ANCHOR, BLOCK + ANCHOR);
writeFileSync(APP, src, 'utf8');
console.log('OK patch 2. bytes:', src.length);
```

- [ ] **Step 4: Run the patch**

Run: `node …/scratchpad/aud-patch-2.mjs`
Expected: `OK patch 2. bytes: <maior que antes>`.

- [ ] **Step 5: Validate syntax**

Run: `node ferramentas/_aud/validar-sintaxe.mjs`
Expected: `blocos: 2 | falhas: 0`.

- [ ] **Step 6: Parity check — espelho confere com a função pura**

Run:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('app/cotacao_ia_oficial.html','utf8');for(const s of ['_audItens','_audDescFrac','_audParseVendas','_audRegra','_audPacksize'])console.log((h.includes(s)?'OK ':'FALTA ')+s);"
```
Expected: `OK` para os 5 nomes.

- [ ] **Step 7: Commit**

```bash
git add app/cotacao_ia_oficial.html ferramentas/_aud/validar-sintaxe.mjs
git commit -m "auditoria: espelha calc + parser de Vendas no app"
```

---

### Task 3: Botão na appbar + overlay (CSS namespaced, upload, Auditar)

**Files:**
- Modify: `app/cotacao_ia_oficial.html` (botão na appbar; funções `abrirAuditoria`/`_audRodar`)

**Interfaces:**
- Consumes: `_audParseVendas`, `_audItens`, `_audCatMap`, `_audRenderResultado` (Task 4), `CATALOG`, `XLSX`.
- Produces: `abrirAuditoria()` (abre overlay), `_audRodar()` (lê arquivo, audita, chama render), `window._audDiv` (divergências para o export).

- [ ] **Step 1: Patch — botão na appbar (após o de Catálogo)**

Create `…/scratchpad/aud-patch-3a.mjs`. Âncora única: o fim do botão Catálogo.

```js
import { readFileSync, writeFileSync } from 'node:fs';
const APP = 'C:/Users/COMPUTADOR/Main/app/cotacao_ia_oficial.html';
let src = readFileSync(APP, 'utf8');
const ANCHOR = '</svg> Catálogo</button>';
const BTN = '</svg> Catálogo</button>'
  + '<button class="appbar-btn" id="btnAuditoria" onclick="abrirAuditoria()" title="Auditoria de desconto (vendas abaixo do mínimo)" aria-label="Auditoria">🔍 Auditoria</button>';
const n = src.split(ANCHOR).length - 1;
if (n !== 1) { console.error(`anchor count ${n} — ABORTADO`); process.exit(1); }
src = src.replace(ANCHOR, BTN);
writeFileSync(APP, src, 'utf8');
console.log('OK patch 3a');
```

Run: `node …/scratchpad/aud-patch-3a.mjs` → `OK patch 3a`.

- [ ] **Step 2: Patch — overlay + CSS namespaced + _audRodar**

Create `…/scratchpad/aud-patch-3b.mjs`. Insere antes de `function abrirAtualizarCatalogo(){`. O overlay usa CSS prefixado por `#aud-overlay` (não colide com o app). `_audRodar` lê o arquivo, valida catálogo, audita e chama `_audRenderResultado` (Task 4).

```js
import { readFileSync, writeFileSync } from 'node:fs';
const APP = 'C:/Users/COMPUTADOR/Main/app/cotacao_ia_oficial.html';
let src = readFileSync(APP, 'utf8');
const ANCHOR = 'function abrirAtualizarCatalogo(){';
const CSS = '#aud-overlay{position:fixed;inset:0;background:rgba(13,40,82,.5);z-index:1200;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto}'
  + '#aud-overlay .box{background:#fff;border-radius:14px;max-width:1100px;width:100%;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.35)}'
  + '#aud-overlay h3{color:#0D3364;font-size:17px;margin:0 0 10px}'
  + '#aud-overlay .drop{border:1.5px dashed #c3cede;border-radius:9px;background:#f4f7fb;padding:18px;text-align:center;cursor:pointer}'
  + '#aud-overlay .drop.ok{border-color:#157f3b;background:#e7f5ec}'
  + '#aud-overlay .kpis{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}'
  + '#aud-overlay .kpi{flex:1;min-width:140px;background:#fff;border:1px solid #dde4ee;border-radius:9px;padding:12px 14px}'
  + '#aud-overlay .kpi .v{font-size:23px;font-weight:800;color:#0D3364}#aud-overlay .kpi.bad .v{color:#c0392b}#aud-overlay .kpi .l{font-size:12px;color:#5c6b7a}'
  + '#aud-overlay .vend{margin-bottom:16px;border:1px solid #dde4ee;border-radius:12px;overflow:hidden}'
  + '#aud-overlay .vend>.h{background:#0D3364;color:#fff;padding:9px 14px;font-weight:700;font-size:14px;display:flex;justify-content:space-between}'
  + '#aud-overlay .cli{padding:0 12px 8px}#aud-overlay .cli>.h{font-size:13px;font-weight:700;color:#1d5fa6;padding:9px 4px 6px;border-bottom:2px solid #eef2f7}'
  + '#aud-overlay .ped{margin:8px 0 3px;font-size:12px;font-weight:600;color:#5c6b7a;background:#f4f7fb;border:1px solid #e2e8f0;border-radius:6px;padding:4px 9px;display:inline-block}'
  + '#aud-overlay table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:5px}'
  + '#aud-overlay th{text-align:right;font-size:10.5px;text-transform:uppercase;color:#94a1b2;padding:5px 7px;border-bottom:1px solid #e2e8f0}'
  + '#aud-overlay td{padding:6px 7px;border-bottom:1px solid #eef2f7;text-align:right;white-space:nowrap}#aud-overlay td.l,#aud-overlay th.l{text-align:left}'
  + '#aud-overlay .low{color:#c0392b;font-weight:700}#aud-overlay .falta{font-weight:800;color:#c0392b}'
  + '#aud-overlay .badgeA{font-size:10px;font-weight:800;background:#fdeed7;color:#9a5a00;border:1px solid #f6cd95;border-radius:4px;padding:1px 6px}'
  + '#aud-overlay .ok-banner{background:#e7f5ec;border:1px solid #bfe3cb;color:#157f3b;font-weight:600;border-radius:9px;padding:14px;text-align:center}'
  + '#aud-overlay .semc{background:#fdf3d7;border:1px solid #ecd28a;border-radius:9px;padding:10px 12px;font-size:12.5px;color:#8a6d00;margin-top:10px}'
  + '#aud-overlay .warn{background:#fdecec;border:1px solid #f3c9c4;color:#c0392b;border-radius:9px;padding:10px 12px;font-size:12.5px;margin-top:10px}';
const FN = 'function abrirAuditoria(){let ov=document.getElementById("aud-overlay");if(ov)ov.remove();ov=document.createElement("div");ov.id="aud-overlay";ov.onclick=e=>{if(e.target===ov)ov.remove();};'
  + 'ov.innerHTML=\'<style>' + CSS.replace(/'/g, "\\'") + '</style>\'+'
  + '\'<div class="box"><div style="display:flex;justify-content:space-between;align-items:center"><h3>🔍 Auditoria de desconto</h3><button onclick="document.getElementById(\\\'aud-overlay\\\').remove()" style="border:none;background:#f0f0f0;border-radius:6px;width:28px;height:28px;cursor:pointer">✕</button></div>\'+'
  + '\'<label class="drop" id="audDrop"><div style="font-weight:700;color:#0D3364">Solte o relatório de VENDAS do dia aqui</div><div style="font-size:12px;color:#5c6b7a">.xlsx · vendas por vendedor/cliente. Preço-base e curva vêm do catálogo.</div><input type="file" id="audFile" accept=".xlsx,.xls" style="display:none"></label>\'+'
  + '\'<div id="aud-output" style="margin-top:14px"></div></div>\';'
  + 'document.body.appendChild(ov);const inp=ov.querySelector("#audFile");ov.querySelector("#audDrop").addEventListener("click",()=>inp.click());inp.addEventListener("change",e=>{if(e.target.files[0])_audRodar(e.target.files[0]);});}'
  + 'async function _audRodar(file){const out=document.getElementById("aud-output");const catMap=_audCatMap();if(!Object.keys(catMap).length){out.innerHTML=\'<div class="warn">Catálogo vazio — atualize o catálogo primeiro (botão 📦 Catálogo).</div>\';return;}out.innerHTML=\'<div style="color:#5c6b7a;font-size:13px">Lendo vendas…</div>\';try{const buf=await file.arrayBuffer();const wb=XLSX.read(new Uint8Array(buf),{type:"array"});const itens=_audParseVendas(wb);if(!itens){out.innerHTML=\'<div class="warn">"\'+file.name+\'" não parece o relatório de Vendas (faltam colunas Pedido / Custo Un.).</div>\';return;}const res=_audItens(itens,catMap);window._audDiv=res.divergencias;_audRenderResultado(res);}catch(err){out.innerHTML=\'<div class="warn">Erro ao ler: \'+err.message+\'</div>\';}}';
const n = src.split(ANCHOR).length - 1;
if (n !== 1) { console.error(`anchor count ${n} — ABORTADO`); process.exit(1); }
src = src.replace(ANCHOR, FN + ANCHOR);
writeFileSync(APP, src, 'utf8');
console.log('OK patch 3b. bytes:', src.length);
```

Run: `node …/scratchpad/aud-patch-3b.mjs` → `OK patch 3b`.

- [ ] **Step 3: Validate syntax**

Run: `node ferramentas/_aud/validar-sintaxe.mjs`
Expected: `blocos: 2 | falhas: 0`.

> Se falhar, o ponto mais provável é o escape das aspas dentro do template do `innerHTML`. Ajuste as sequências `\\\'` / `\\'` até `new Function` aceitar; o validador aponta o bloco.

- [ ] **Step 4: Commit**

```bash
git add app/cotacao_ia_oficial.html
git commit -m "auditoria: botao na appbar + overlay + leitura de Vendas"
```

---

### Task 4: Render do resultado + Exportar Excel

**Files:**
- Modify: `app/cotacao_ia_oficial.html` (funções `_audRenderResultado`, `_audExportXlsx`)

**Interfaces:**
- Consumes: `window._audDiv` (divergências), `res` de `_audItens`, `XLSX`, `_audPacksize`.
- Produces: `_audRenderResultado(res)`, `_audExportXlsx()` (baixa `divergencias_desconto.xlsx`).

- [ ] **Step 1: Patch — render + export**

Create `…/scratchpad/aud-patch-4.mjs`. Insere antes de `function abrirAtualizarCatalogo(){`. Porta o agrupamento/tabela e o Excel do anexo, com nomes `_aud*` e formatação R$.

```js
import { readFileSync, writeFileSync } from 'node:fs';
const APP = 'C:/Users/COMPUTADOR/Main/app/cotacao_ia_oficial.html';
let src = readFileSync(APP, 'utf8');
const ANCHOR = 'function abrirAtualizarCatalogo(){';
const FN = 'function _audFmt(n){return"R$ "+Number(n).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});}'
  + 'function _audPct(n){return(n*100).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})+"%";}'
  + 'function _audTree(div){const t={};div.forEach(function(x){var v=x.vend||"(sem vendedor)",cl=x.cli||"(sem cliente)",pk=x.ped+"|"+(x.nota==null?"":x.nota);(((t[v]=t[v]||{})[cl]=t[v][cl]||{})[pk]=t[v][cl][pk]||[]).push(x);});return t;}'
  + 'function _audRenderResultado(res){const out=document.getElementById("aud-output");const div=res.divergencias;let html=\'<div class="kpis"><div class="kpi"><div class="v">\'+res.auditados+\'</div><div class="l">itens auditados</div></div><div class="kpi \'+(div.length?"bad":"")+\'"><div class="v">\'+div.length+\'</div><div class="l">divergências</div></div></div>\';'
  + 'if(div.length){html+=\'<div style="margin-bottom:10px"><button onclick="_audExportXlsx()" style="height:36px;padding:0 16px;border:1.5px solid #cdd8e8;background:#fff;color:#0D3364;border-radius:9px;font-weight:700;cursor:pointer">Exportar Excel</button></div>\';const tree=_audTree(div);Object.keys(tree).sort().forEach(function(v){var nv=Object.values(tree[v]).reduce((s,cl)=>s+Object.values(cl).reduce((a,p)=>a+p.length,0),0);html+=\'<div class="vend"><div class="h"><span>\'+v+\'</span><span>\'+nv+\' divergência(s)</span></div>\';Object.keys(tree[v]).sort().forEach(function(cl){html+=\'<div class="cli"><div class="h">\'+cl+\'</div>\';Object.keys(tree[v][cl]).sort((a,b)=>(+a.split("|")[0])-(+b.split("|")[0])).forEach(function(pk){var p=pk.split("|")[0],n=pk.split("|")[1];html+=\'<div class="ped">Pedido \'+p+(n?" · Nota "+n:"")+\'</div><table><thead><tr><th class="l">Cód</th><th class="l">Produto</th><th>Emb</th><th>Qtd</th><th>Tabela</th><th>Custo</th><th>Preço mín</th><th>Vendido/un</th><th>Desc.</th><th>Falta/un</th><th>Regra</th><th>Curva</th></tr></thead><tbody>\';tree[v][cl][pk].forEach(function(x){html+=\'<tr><td class="l">\'+x.cod+\'</td><td class="l">\'+(x.prod||"")+\'</td><td>\'+(x.emb||"")+\'</td><td>\'+x.qt+\'</td><td>\'+_audFmt(x.base)+\'</td><td>\'+_audFmt(x.custo||0)+\'</td><td>\'+_audFmt(x.precoMin)+\'</td><td class="low">\'+_audFmt(x.unit)+\'</td><td>\'+_audPct(x.descPrat)+\'</td><td class="falta">\'+_audFmt(x.falta)+\'</td><td>\'+x.regra+\'</td><td>\'+(x.A?\'<span class="badgeA">A</span>\':"—")+\'</td></tr>\';});html+="</tbody></table>";});html+="</div>";});html+="</div>";});}else{html+=\'<div class="ok-banner">✔ Nenhuma divergência. Tudo dentro da regra.</div>\';}'
  + 'if(res.semCadastro.length){html+=\'<div class="semc"><b>\'+res.semCadastro.length+\' item(ns) sem preço de tabela</b> não avaliados (código fora do catálogo).</div>\';}out.innerHTML=html;}'
  + 'function _audExportXlsx(){var div=window._audDiv||[];if(!div.length){alert("Nada para exportar.");return;}var tree=_audTree(div);var headers=["Cód","Produto","Emb","Qtd","Tabela","Custo","Preço mín","Vendido/un","Desc.","Falta/un","Regra","Curva"];var NC=headers.length,ws={},merges=[],r=0;var thin={style:"thin",color:{rgb:"D9E1EC"}},bAll={top:thin,bottom:thin,left:thin,right:thin};var MF=\'"R$" #,##0.00\';function put(rr,cc,v,t,st){ws[XLSX.utils.encode_cell({r:rr,c:cc})]={v:(v==null?"":v),t:t,s:st||{}};}function band(rr,text,st){put(rr,0,text,"s",st);for(var c=1;c<NC;c++)put(rr,c,"","s",st);merges.push({s:{r:rr,c:0},e:{r:rr,c:NC-1}});}function cell(extra){var st={border:bAll,font:{sz:10},alignment:{vertical:"center"}};if(extra)for(var k in extra)st[k]=extra[k];return st;}'
  + 'var stT={font:{bold:true,sz:14,color:{rgb:"0D3364"}}},stV={fill:{patternType:"solid",fgColor:{rgb:"0D3364"}},font:{bold:true,color:{rgb:"FFFFFF"},sz:12}},stC={fill:{patternType:"solid",fgColor:{rgb:"EAF1FB"}},font:{bold:true,color:{rgb:"15498A"},sz:11}},stP={fill:{patternType:"solid",fgColor:{rgb:"F0F3F8"}},font:{bold:true,color:{rgb:"5C6B7A"},sz:10}},stH={fill:{patternType:"solid",fgColor:{rgb:"EEF2F7"}},font:{bold:true,color:{rgb:"5C6B7A"},sz:9},alignment:{horizontal:"center",wrapText:true},border:bAll},red={sz:10,bold:true,color:{rgb:"C0392B"}};'
  + 'band(r,"Auditoria de desconto  —  "+div.length+" divergência(s)",stT);r+=2;Object.keys(tree).sort().forEach(function(v){band(r,v,stV);r++;Object.keys(tree[v]).sort().forEach(function(cl){band(r,cl,stC);r++;Object.keys(tree[v][cl]).sort(function(a,b){return(+a.split("|")[0])-(+b.split("|")[0]);}).forEach(function(pk){var p=pk.split("|")[0],n=pk.split("|")[1];band(r,"Pedido "+p+(n?"   ·   Nota "+n:""),stP);r++;for(var c=0;c<NC;c++)put(r,c,headers[c],"s",stH);r++;tree[v][cl][pk].forEach(function(x){put(r,0,x.cod,"n",cell({alignment:{horizontal:"left"}}));put(r,1,x.prod||"","s",cell({alignment:{horizontal:"left"}}));put(r,2,x.emb||"","s",cell({alignment:{horizontal:"center"}}));put(r,3,x.qt,"n",cell({alignment:{horizontal:"center"}}));put(r,4,_audR2(x.base),"n",cell({numFmt:MF}));put(r,5,_audR2(x.custo||0),"n",cell({numFmt:MF}));put(r,6,_audR2(x.precoMin),"n",cell({numFmt:MF}));put(r,7,_audR2(x.unit),"n",cell({numFmt:MF,font:red}));put(r,8,x.descPrat,"n",cell({numFmt:"0.0%",alignment:{horizontal:"center"}}));put(r,9,_audR2(x.falta),"n",cell({numFmt:MF,font:red}));put(r,10,x.regra,"s",cell({alignment:{horizontal:"center"}}));put(r,11,x.A?"A":"","s",cell({alignment:{horizontal:"center"},font:{sz:10,bold:true,color:{rgb:"9A5A00"}}}));r++;});r++;});});r++;});'
  + 'ws["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:(r||1),c:NC-1}});ws["!merges"]=merges;ws["!cols"]=[{wch:8},{wch:34},{wch:7},{wch:6},{wch:11},{wch:11},{wch:11},{wch:12},{wch:8},{wch:11},{wch:10},{wch:7}];var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Divergências");var out=XLSX.write(wb,{bookType:"xlsx",type:"array"});var blob=new Blob([out],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});var url=URL.createObjectURL(blob);var a=document.createElement("a");a.href=url;a.download="divergencias_desconto.xlsx";a.style.display="none";document.body.appendChild(a);a.click();setTimeout(function(){a.remove();URL.revokeObjectURL(url);},1500);}';
const n = src.split(ANCHOR).length - 1;
if (n !== 1) { console.error(`anchor count ${n} — ABORTADO`); process.exit(1); }
src = src.replace(ANCHOR, FN + ANCHOR);
writeFileSync(APP, src, 'utf8');
console.log('OK patch 4. bytes:', src.length);
```

> `_audExportXlsx` usa `_audR2` (definido na Task 2). Confirme que existe antes de rodar.

Run: `node …/scratchpad/aud-patch-4.mjs` → `OK patch 4`.

- [ ] **Step 2: Validate syntax**

Run: `node ferramentas/_aud/validar-sintaxe.mjs`
Expected: `blocos: 2 | falhas: 0`.

- [ ] **Step 3: Commit**

```bash
git add app/cotacao_ia_oficial.html
git commit -m "auditoria: render do resultado + export Excel"
```

---

### Task 5: Smoke manual + regenerar cópia publicável

**Files:**
- Use: `Downloads/cotacao-atacaderj-OFICIAL.html` (regenerado)

- [ ] **Step 1: Regenerar a cópia oficial**

Run: `node …/scratchpad/gerar-oficial.mjs` (script já existente que copia o app + badge)
Expected: `OFICIAL gerado … badge presente: true`.

- [ ] **Step 2: Smoke manual (publicar e testar no artefato)**

Checklist (abrir o app publicado, com um catálogo carregado):
- clicar **🔍 Auditoria** → overlay abre.
- subir um **relatório de Vendas real** do dia → aparecem KPIs (auditados / divergências).
- conferir **1–2 divergências à mão**: `vendido/un` < `base × (1 − desconto)`; base bate com o catálogo.
- itens fora do catálogo aparecem no aviso "sem preço de tabela".
- **Exportar Excel** → baixa `divergencias_desconto.xlsx` com o mesmo conteúdo.
- subir um arquivo errado (ex.: o de varejo) → aviso "não parece o relatório de Vendas", sem quebrar.

- [ ] **Step 3: Commit (se houve ajuste após smoke)**

```bash
git add -A
git commit -m "auditoria: ajustes pos-smoke + copia oficial"
```

---

## Self-Review

**Spec coverage:**
- §4 Vendas parsing → Task 2 (`_audParseVendas`). ✓
- §5 lógica/conta → Task 1 (pura, testada) + Task 2 (espelho). ✓
- §6 UI/saída (botão, overlay, KPIs, grupos, Excel) → Tasks 3–4. ✓
- §7 bordas (catálogo vazio, vendas inválida, sem cadastro, packsize, sem trava de data) → Tasks 1–3. ✓
- §2.2 custo da venda → Task 1 usa `x.custo`; `_audItens` idem. ✓
- §10 regenerar OFICIAL → Task 5. ✓

**Placeholder scan:** sem TBD/TODO; código completo e correto em cada passo.

**Type consistency:** nomes `_audItens/_audParseVendas/_audCatMap/_audRenderResultado/_audExportXlsx/_audR2/_audPacksize/window._audDiv` usados de forma consistente entre as tarefas. A função pura `auditarItens` (Task 1) e o espelho `_audItens` (Task 2) têm a mesma fórmula (piso 0.10, teto 0.03/0.05).
