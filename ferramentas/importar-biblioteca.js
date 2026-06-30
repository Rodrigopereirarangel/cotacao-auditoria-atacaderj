/*
 * ============================================================================
 *  importar-biblioteca.js
 *  Cole no Console do DevTools (F12) COM O APP cotacao_ia_oficial.html ABERTO.
 *  Abre um seletor de arquivos: escolha 1 ou mais dos JSONs da pasta /biblioteca
 *  (apelidos.json, buscas.json, ausentes.json). Grava de volta no localStorage
 *  fazendo MERGE (uniao) — NUNCA apaga o que ja existe.
 *
 *  IMPORTANTE: recarregue a pagina (F5) DEPOIS de importar, para o app recarregar
 *  _apelidos / _buscasSalvas / _catInteiroAusentes a partir do localStorage.
 *
 *  Regras de merge (alinhadas com biblioteca/_SCHEMA.md):
 *   - apelidos : uniao POR TERMO (une conjuntos de codigos; nunca perde codigo). Cap 400.
 *   - buscas   : so importa entradas cuja versao bate com versaoCatalogo() atual;
 *                uniao por chave, mantendo a entrada JA EXISTENTE em caso de colisao
 *                (a do disco e a curada, mas em duvida preservamos o que o app validou).
 *                Para forcar sobrescrita pela do arquivo, mude PREFERIR_ARQUIVO=true.
 *   - ausentes : uniao por versao (se versao do arquivo != atual, ignora). Cap 300.
 *   - correcoes.jsonl: NAO e importado (o app nao tem essa chave; vive so no repo).
 * ============================================================================
 */
(function importarBiblioteca(){
  'use strict';

  var PREFERIR_ARQUIVO = false; // false = na colisao de busca, mantem a do localStorage.

  // ---- versaoCatalogo() igual ao app -------------------------------------
  function calcularVersaoCatalogo(){
    try {
      if (typeof CATALOG !== 'undefined' && Array.isArray(CATALOG) && CATALOG.length) {
        return CATALOG.length + '_' + CATALOG.reduce(function(s,p){ return s + (p.v||0); }, 0).toFixed(2);
      }
    } catch (e) {}
    try {
      var ov = JSON.parse(localStorage.getItem('atacaderj_catalogo') || 'null');
      if (ov && Array.isArray(ov.produtos) && ov.produtos.length) {
        return ov.produtos.length + '_' + ov.produtos.reduce(function(s,p){ return s + (p.v||0); }, 0).toFixed(2);
      }
    } catch (e) {}
    return null;
  }
  var VERSAO_ATUAL = calcularVersaoCatalogo();
  console.log('[importar] versaoCatalogo atual =', VERSAO_ATUAL);

  function lerLS(chave){ try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) { return null; } }

  // ---- MERGE: apelidos ---------------------------------------------------
  // Estrutura LS: { entradas: [[chave,[codigos]]] }. Uniao por termo.
  function mergeApelidos(arquivo){
    var atual = lerLS('atacaderj_apelidos');
    var map = new Map((atual && Array.isArray(atual.entradas)) ? atual.entradas : []);
    var novas = (arquivo && Array.isArray(arquivo.entradas)) ? arquivo.entradas : [];
    var add = 0, novosTermos = 0;
    novas.forEach(function(par){
      var termo = par[0];
      var cods  = Array.isArray(par[1]) ? par[1] : [];
      if (!termo) return;
      var set = new Set(map.get(termo) || []);
      if (!map.has(termo)) novosTermos++;
      cods.forEach(function(c){ if (Number.isInteger(c) && !set.has(c)) { set.add(c); add++; } });
      map.set(termo, [].concat.apply([], [Array.from(set)])); // array de codigos
    });
    var entradas = Array.from(map.entries());
    if (entradas.length > 400) entradas = entradas.slice(-400); // mesmo cap do app
    localStorage.setItem('atacaderj_apelidos', JSON.stringify({ entradas: entradas }));
    console.log('[importar] apelidos: +' + novosTermos + ' termos, +' + add + ' codigos. total=' + entradas.length);
  }

  // ---- MERGE: buscas (versionado) ----------------------------------------
  // Estrutura LS: { versao, entradas: [[chave, resultado]] }.
  function mergeBuscas(arquivo){
    var vArq = arquivo && (arquivo.versao_catalogo || arquivo.versao);
    if (vArq && VERSAO_ATUAL && vArq !== VERSAO_ATUAL) {
      console.warn('[importar] buscas IGNORADAS: versao do arquivo (' + vArq + ') != versao atual (' + VERSAO_ATUAL + '). Precos podem ter mudado.');
      return;
    }
    var atual = lerLS('atacaderj_buscas');
    // So aproveita o que ja existe no LS se for da versao certa.
    var baseEntradas = (atual && atual.versao === VERSAO_ATUAL && Array.isArray(atual.entradas)) ? atual.entradas : [];
    var map = new Map(baseEntradas);
    var novas = (arquivo && Array.isArray(arquivo.entradas)) ? arquivo.entradas : [];
    var add = 0;
    novas.forEach(function(par){
      var chave = par[0];
      if (!chave) return;
      var existe = map.has(chave);
      if (!existe || PREFERIR_ARQUIVO) { map.set(chave, par[1]); if (!existe) add++; }
    });
    var entradas = Array.from(map.entries());
    if (entradas.length > 600) entradas = entradas.slice(-400); // mesmo cap/poda do app
    localStorage.setItem('atacaderj_buscas', JSON.stringify({ versao: VERSAO_ATUAL, entradas: entradas }));
    console.log('[importar] buscas: +' + add + ' novas. total=' + entradas.length + ' (versao ' + VERSAO_ATUAL + ')');
  }

  // ---- MERGE: ausentes (versionado) --------------------------------------
  // Estrutura LS: { versao, itens: [chave...] }. Uniao de Set.
  function mergeAusentes(arquivo){
    var vArq = arquivo && (arquivo.versao_catalogo || arquivo.versao);
    if (vArq && VERSAO_ATUAL && vArq !== VERSAO_ATUAL) {
      console.warn('[importar] ausentes IGNORADOS: versao do arquivo (' + vArq + ') != atual (' + VERSAO_ATUAL + ').');
      return;
    }
    var atual = lerLS('atacaderj_ausentes');
    var base = (atual && atual.versao === VERSAO_ATUAL && Array.isArray(atual.itens)) ? atual.itens : [];
    var set = new Set(base);
    var antes = set.size;
    (arquivo && Array.isArray(arquivo.itens) ? arquivo.itens : []).forEach(function(t){ if (t) set.add(t); });
    var itens = Array.from(set).slice(-300); // mesmo cap do app
    localStorage.setItem('atacaderj_ausentes', JSON.stringify({ versao: VERSAO_ATUAL, itens: itens }));
    console.log('[importar] ausentes: +' + (set.size - antes) + '. total=' + itens.length);
  }

  // ---- Roteia cada arquivo pelo nome/conteudo ----------------------------
  function processar(nome, dados){
    var n = (nome || '').toLowerCase();
    if (n.indexOf('apelidos') >= 0)      return mergeApelidos(dados);
    if (n.indexOf('buscas') >= 0)        return mergeBuscas(dados);
    if (n.indexOf('ausentes') >= 0)      return mergeAusentes(dados);
    if (n.indexOf('correcoes') >= 0) {
      console.warn('[importar] correcoes.jsonl nao e importado para o localStorage (o app nao usa essa chave). Mantenha-o no repo.');
      return;
    }
    // Fallback: tenta inferir pelo formato.
    if (dados && Array.isArray(dados.entradas)) {
      var pareceApelido = dados.entradas.length && Array.isArray(dados.entradas[0][1]) && dados.entradas[0][1].every(Number.isInteger);
      return pareceApelido ? mergeApelidos(dados) : mergeBuscas(dados);
    }
    if (dados && Array.isArray(dados.itens)) return mergeAusentes(dados);
    console.warn('[importar] arquivo nao reconhecido: ' + nome);
  }

  // ---- UI: input file (multiplo) -----------------------------------------
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', function(){
    var files = Array.from(input.files || []);
    if (!files.length) { console.log('[importar] nenhum arquivo escolhido.'); document.body.removeChild(input); return; }
    var pend = files.length;
    files.forEach(function(file){
      var reader = new FileReader();
      reader.onload = function(){
        try {
          var dados = JSON.parse(reader.result);
          processar(file.name, dados);
        } catch (e) {
          console.error('[importar] erro ao processar ' + file.name + ':', e);
        }
        if (--pend === 0) {
          console.log('%c[importar] CONCLUIDO. Recarregue a pagina (F5) para o app aplicar.', 'color:#0a0;font-weight:bold');
          document.body.removeChild(input);
        }
      };
      reader.readAsText(file);
    });
  });

  input.click();
  console.log('[importar] selecione apelidos.json / buscas.json / ausentes.json (pode varios de uma vez).');
})();
