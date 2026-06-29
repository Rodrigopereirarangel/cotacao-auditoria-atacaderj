/*
 * ============================================================================
 *  exportar-biblioteca.js
 *  Cole no Console do DevTools (F12) COM O APP cotacao_ia_oficial.html ABERTO.
 *  NAO modifica o app. Apenas LE os localStorage e dispara o download dos JSONs
 *  no formato da pasta /biblioteca (apelidos.json, buscas.json, ausentes.json).
 *
 *  Por que rodar no proprio app aberto: assim conseguimos calcular versaoCatalogo()
 *  exatamente como o app calcula, e carimbar os JSONs com a versao correta.
 * ============================================================================
 */
(function exportarBiblioteca(){
  'use strict';

  // ---- Helpers de leitura segura do localStorage -------------------------
  // Le uma chave e faz JSON.parse; devolve fallback se faltar/estiver corrompido.
  function lerLS(chave, fallback){
    try {
      const raw = localStorage.getItem(chave);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[exportar] falha ao ler ' + chave + ':', e);
      return fallback;
    }
  }

  // ---- versaoCatalogo(): reproduz EXATAMENTE a funcao do app -------------
  // O app define: CATALOG.length + '_' + soma(p.v).toFixed(2).
  // Se a variavel global CATALOG existir (app aberto), usamos ela.
  // Senao, tentamos derivar do override atacaderj_catalogo. Senao, null.
  function calcularVersaoCatalogo(){
    try {
      if (typeof CATALOG !== 'undefined' && Array.isArray(CATALOG) && CATALOG.length) {
        return CATALOG.length + '_' + CATALOG.reduce(function(s,p){ return s + (p.v||0); }, 0).toFixed(2);
      }
    } catch (e) { /* CATALOG pode nao estar no escopo do console */ }
    var ov = lerLS('atacaderj_catalogo', null);
    if (ov && Array.isArray(ov.produtos) && ov.produtos.length) {
      return ov.produtos.length + '_' + ov.produtos.reduce(function(s,p){ return s + (p.v||0); }, 0).toFixed(2);
    }
    return null;
  }

  // ---- Download de um objeto como arquivo .json --------------------------
  function baixar(nomeArquivo, objeto){
    var blob = new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    console.log('[exportar] baixado: ' + nomeArquivo);
  }

  var versao = calcularVersaoCatalogo();
  var agoraISO = new Date().toISOString();
  console.log('[exportar] versaoCatalogo atual =', versao);

  // ====================== apelidos.json ===================================
  // localStorage: atacaderj_apelidos = { entradas: [[chave,[codigos]]] }
  // (apelidos NAO carregam versao no app; gravamos versao_catalogo so como rastreio)
  var apRaw = lerLS('atacaderj_apelidos', null);
  var apEntradas = (apRaw && Array.isArray(apRaw.entradas)) ? apRaw.entradas : [];
  baixar('apelidos.json', {
    versao_catalogo: versao,
    atualizado_em: agoraISO,
    entradas: apEntradas
  });

  // ====================== buscas.json =====================================
  // localStorage: atacaderj_buscas = { versao, entradas: [[chave, resultado]] }
  // resultado = [{nome, produtos:[{c,p,q,v,...}]}]. Versionado.
  var buRaw = lerLS('atacaderj_buscas', null);
  var buEntradas = (buRaw && Array.isArray(buRaw.entradas)) ? buRaw.entradas : [];
  // Preferimos a versao gravada no proprio LS (e a que o app validou); cai p/ a calculada.
  var buVersao = (buRaw && buRaw.versao) ? buRaw.versao : versao;
  baixar('buscas.json', {
    versao_catalogo: buVersao,
    entradas: buEntradas
  });

  // ====================== ausentes.json ===================================
  // localStorage: atacaderj_ausentes = { versao, itens: [chave...] }
  var auRaw = lerLS('atacaderj_ausentes', null);
  var auItens = (auRaw && Array.isArray(auRaw.itens)) ? auRaw.itens : [];
  var auVersao = (auRaw && auRaw.versao) ? auRaw.versao : versao;
  baixar('ausentes.json', {
    _comentario: 'FILA PRIORITARIA DE MELHORIA DE QUALIDADE: termos que nem o fallback do catalogo inteiro casou. Curar cada item (apelido, correcao de catalogo, ou marcar inexistente).',
    versao_catalogo: auVersao,
    itens: auItens
  });

  // ====================== resumo ==========================================
  console.log('[exportar] CONCLUIDO. Resumo:',
    '\n  apelidos:', apEntradas.length,
    '\n  buscas:  ', buEntradas.length, '(versao ' + buVersao + ')',
    '\n  ausentes:', auItens.length, '(versao ' + auVersao + ')');
  console.log('[exportar] OBS: correcoes.jsonl NAO e exportado daqui (o app nao tem essa chave). ' +
    'Ele e mantido/curado no repo, alimentado manualmente ou por uma instrumentacao futura.');
})();
