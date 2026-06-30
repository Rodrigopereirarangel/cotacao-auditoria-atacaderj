#!/usr/bin/env node
// =============================================================================
// mesclar-snapshot.mjs — funde o snapshot do operador na BIBLIOTECA CURADA.
// -----------------------------------------------------------------------------
// Entrada:  biblioteca/snapshots/operador-latest.json  (gerado pelo app +
//           enviado pelo PC do operador). Formato:
//   { _exportadoEm, versao_catalogo,
//     apelidos:{entradas:[[termo,[cods]]]}, buscas:{versao,entradas:[[chave,res]]},
//     ausentes:{versao,itens:[...]}, apelido_motivos:[{termo,cod,motivo,data}] }
//
// Regra de ouro (do biblioteca/_SCHEMA.md): UNIAO, nunca apaga.
//   - apelidos:        uniao por termo (sempre; independem de versao). Cap 400.
//   - apelido_motivos: append-only no .jsonl, dedup por termo|cod|data.
//   - buscas/ausentes: versionados -> so funde se a versao do catalogo bater.
//
// Uso: node ferramentas/mesclar-snapshot.mjs [pasta-biblioteca] [snapshot.json]
// Depois rode: node ferramentas/validar-biblioteca.mjs biblioteca
// =============================================================================
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DIR = process.argv[2] || 'biblioteca';
const SNAP = process.argv[3] || join(DIR, 'snapshots', 'operador-latest.json');

function lerJSON(p, def) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return def; } }
function gravarJSON(p, o) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); }

if (!existsSync(SNAP)) { console.error('ERRO: snapshot nao encontrado: ' + SNAP); process.exit(1); }
const snap = lerJSON(SNAP, null);
if (!snap || typeof snap !== 'object') { console.error('ERRO: snapshot invalido (JSON).'); process.exit(1); }

const rel = [];

// ---- apelidos: uniao por termo (sempre) ----
{
  const fp = join(DIR, 'apelidos.json');
  const cur = lerJSON(fp, { versao_catalogo: null, atualizado_em: null, entradas: [] });
  const map = new Map((cur.entradas || []).map(([t, c]) => [t, new Set(c)]));
  let novos = 0, lig = 0;
  for (const par of ((snap.apelidos && snap.apelidos.entradas) || [])) {
    if (!Array.isArray(par) || par.length !== 2) continue;
    const [t, cods] = par;
    if (typeof t !== 'string' || !Array.isArray(cods)) continue;
    if (!map.has(t)) { map.set(t, new Set()); novos++; }
    const s = map.get(t);
    for (const c of cods) { if (Number.isInteger(c) && !s.has(c)) { s.add(c); lig++; } }
  }
  let entradas = [...map.entries()].map(([t, s]) => [t, [...s]]);
  if (entradas.length > 400) entradas = entradas.slice(-400);
  cur.entradas = entradas;
  cur.atualizado_em = snap._exportadoEm || cur.atualizado_em || null;
  gravarJSON(fp, cur);
  rel.push(`apelidos: +${novos} termos novos, +${lig} ligacoes termo->cod (total ${entradas.length})`);
}

// ---- apelido_motivos: append-only jsonl, dedup ----
{
  const fp = join(DIR, 'apelido_motivos.jsonl');
  const vistos = new Set();
  if (existsSync(fp)) {
    for (const l of readFileSync(fp, 'utf8').split(/\r?\n/)) {
      const s = l.trim(); if (!s) continue;
      try { const o = JSON.parse(s); vistos.add(o.termo + '|' + o.cod + '|' + (o.data || '')); } catch (e) {}
    }
  }
  let add = 0, buf = '';
  for (const o of (Array.isArray(snap.apelido_motivos) ? snap.apelido_motivos : [])) {
    if (!o || typeof o !== 'object') continue;
    const k = o.termo + '|' + o.cod + '|' + (o.data || '');
    if (!vistos.has(k)) { vistos.add(k); buf += JSON.stringify(o) + '\n'; add++; }
  }
  if (buf) appendFileSync(fp, buf);
  rel.push(`apelido_motivos: +${add} linhas (jsonl)`);
}

// ---- buscas: so funde se versao do catalogo bater ----
{
  const fp = join(DIR, 'buscas.json');
  const cur = lerJSON(fp, { versao_catalogo: null, entradas: [] });
  const sb = snap.buscas;
  if (sb && Array.isArray(sb.entradas)) {
    const curV = cur.versao_catalogo;
    const snapV = (sb.versao != null ? sb.versao : (snap.versao_catalogo != null ? snap.versao_catalogo : null));
    if (curV == null || snapV == null || curV === snapV) {
      const map = new Map((cur.entradas || []).map(([k, v]) => [k, v]));
      let add = 0;
      for (const par of sb.entradas) { if (!Array.isArray(par) || par.length !== 2) continue; const [k, v] = par; if (!map.has(k)) { map.set(k, v); add++; } }
      let entradas = [...map.entries()];
      if (entradas.length > 600) entradas = entradas.slice(-400);
      cur.entradas = entradas;
      if (cur.versao_catalogo == null) cur.versao_catalogo = snapV;
      gravarJSON(fp, cur);
      rel.push(`buscas: +${add} (versao ${snapV})`);
    } else { rel.push(`buscas: PULADO (versao do snapshot "${snapV}" != curada "${curV}")`); }
  } else { rel.push('buscas: nada no snapshot'); }
}

// ---- ausentes: so funde se versao bater ----
{
  const fp = join(DIR, 'ausentes.json');
  const cur = lerJSON(fp, { versao_catalogo: null, itens: [] });
  const sa = snap.ausentes;
  if (sa && Array.isArray(sa.itens)) {
    const curV = cur.versao_catalogo;
    const snapV = (sa.versao != null ? sa.versao : (snap.versao_catalogo != null ? snap.versao_catalogo : null));
    if (curV == null || snapV == null || curV === snapV) {
      const set = new Set(cur.itens || []);
      let add = 0;
      for (const it of sa.itens) { if (typeof it === 'string' && !set.has(it)) { set.add(it); add++; } }
      let itens = [...set];
      if (itens.length > 300) itens = itens.slice(-300);
      cur.itens = itens;
      if (cur.versao_catalogo == null) cur.versao_catalogo = snapV;
      gravarJSON(fp, cur);
      rel.push(`ausentes: +${add} (versao ${snapV})`);
    } else { rel.push(`ausentes: PULADO (versao "${snapV}" != "${curV}")`); }
  } else { rel.push('ausentes: nada no snapshot'); }
}

console.log('================ MERGE do snapshot na biblioteca curada ================');
console.log('Snapshot: ' + SNAP + (snap._exportadoEm ? ('  (exportado ' + snap._exportadoEm + ')') : ''));
for (const r of rel) console.log('  - ' + r);
console.log('------------------------------------------------------------------------');
console.log('Feito. Valide com:  node ferramentas/validar-biblioteca.mjs biblioteca');
