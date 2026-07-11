// =============================================================================
// auditoria-xlsx.mjs — monta o workbook estilizado da Auditoria de Desconto,
// desenhado para leitura NO CELULAR (o arquivo é entregue por WhatsApp).
// -----------------------------------------------------------------------------
// 3 abas:
//   Resumo       — título, 3 indicadores e ranking de vendedores por impacto
//   Divergências — layout mobile: vendedor e cliente/pedido são FAIXAS
//                  (linhas mescladas), cada item tem só 5 colunas
//                  (Produto · Qt · Mín · Vendido · Impacto) — cabe na tela
//                  em pé sem truncar nem rolar de lado
//   Completa     — as 17 colunas de antes, com autofiltro, para uso no PC
//
// Não importa xlsx-js-style: recebe o módulo por parâmetro para preservar o
// padrão de dependência opcional do auditoria-diaria.mjs (sem a lib -> só txt).
// =============================================================================

const NAVY = '1F3864', NAVY2 = '2E5395', BLOCO = 'D9E4F5', ZEBRA = 'F5F7FA',
  VERMELHO = 'C00000', ROSA = 'FDECEC', AMBAR = 'FFF3CC', BORDA = 'D9D9D9';
const NUM = '#,##0.00', QTD = '#,##0.##', PCT = '0.0%', INT = '#,##0', MOEDA = '"R$" #,##0.00';
// impacto a partir do qual o item ganha destaque vermelho (vale a conversa)
const IMPACTO_DESTAQUE = 10;

const r2 = (n) => Math.round(n * 100) / 100;
const bAll = (c = BORDA) => ({ top: { style: 'thin', color: { rgb: c } }, bottom: { style: 'thin', color: { rgb: c } }, left: { style: 'thin', color: { rgb: c } }, right: { style: 'thin', color: { rgb: c } } });
const F = (o = {}) => ({ name: 'Calibri', sz: 11, ...o });
const cell = (v, s, z) => {
  const c = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s };
  if (z && c.t === 'n') c.z = z;
  return c;
};

export function montarWorkbook(XLSX, { div, res, diaBr, impTot }) {
  const pushRow = (ws, r, cells) => cells.forEach((c, i) => { if (c) ws[XLSX.utils.encode_cell({ r, c: i })] = c; });

  // vendedor (por impacto desc) -> cliente/pedido -> itens
  const ordenado = [...div].sort((a, b) => (a.vend || '').localeCompare(b.vend || '')
    || (a.cli || '').localeCompare(b.cli || '') || a.ped - b.ped);
  const porVend = new Map();
  for (const x of ordenado) {
    const v = x.vend || '(sem vendedor)';
    if (!porVend.has(v)) porVend.set(v, { itens: 0, impacto: 0, clientes: new Map() });
    const pv = porVend.get(v);
    pv.itens++; pv.impacto += x.impacto;
    const kCli = `${x.cli} · ped ${x.ped}${x.nota ? ' · DAV ' + x.nota : ''}`;
    if (!pv.clientes.has(kCli)) pv.clientes.set(kCli, []);
    pv.clientes.get(kCli).push(x);
  }
  const vendOrd = [...porVend.entries()].sort((a, b) => b[1].impacto - a[1].impacto);

  // ---------------- aba 1: Resumo ----------------
  const wsR = {};
  let r = 0;
  pushRow(wsR, r, [cell('🔍 Auditoria de Desconto', { font: F({ sz: 15, bold: true, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: NAVY } }, alignment: { vertical: 'center', indent: 1 } })]); r++;
  pushRow(wsR, r, [cell(`Pedidos fechados de ${diaBr}`, { font: F({ sz: 10, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: NAVY } }, alignment: { vertical: 'center', indent: 1 } })]); r += 2;

  const stL = { font: F(), alignment: { indent: 1, vertical: 'center' }, fill: { fgColor: { rgb: ZEBRA } }, border: bAll() };
  const stV = (cor = '000000') => ({ font: F({ sz: 12, bold: true, color: { rgb: cor } }), alignment: { horizontal: 'right', vertical: 'center' }, fill: { fgColor: { rgb: ZEBRA } }, border: bAll() });
  const kpiIni = r;
  pushRow(wsR, r, [cell('Itens auditados', stL), null, cell(res.auditados, stV(), INT)]); r++;
  pushRow(wsR, r, [cell('Divergências', stL), null, cell(div.length, stV(div.length ? VERMELHO : '2E7D32'), INT)]); r++;
  pushRow(wsR, r, [cell('Impacto total', stL), null, cell(r2(impTot), stV(div.length ? VERMELHO : '2E7D32'), MOEDA)]); r += 2;

  const stCab = { font: F({ sz: 10, bold: true, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: NAVY2 } }, alignment: { horizontal: 'center', vertical: 'center' }, border: bAll(NAVY2) };
  pushRow(wsR, r, [cell('Vendedor', stCab), cell('Itens', stCab), cell('R$', stCab), cell('%', stCab)]); r++;
  vendOrd.forEach(([nome, s], i) => {
    const fill = { fgColor: { rgb: i % 2 ? ZEBRA : 'FFFFFF' } };
    pushRow(wsR, r, [
      cell(nome, { font: F(), fill, border: bAll(), alignment: { indent: 1, wrapText: true, vertical: 'center' } }),
      cell(s.itens, { font: F(), fill, border: bAll(), alignment: { horizontal: 'center', vertical: 'center' } }, INT),
      cell(r2(s.impacto), { font: F({ bold: true }), fill, border: bAll(), alignment: { horizontal: 'right', vertical: 'center' } }, NUM),
      cell(impTot ? s.impacto / impTot : 0, { font: F({ sz: 10 }), fill, border: bAll(), alignment: { horizontal: 'right', vertical: 'center' } }, PCT),
    ]); r++;
  });
  const stTot = (extra = {}) => ({ font: F({ bold: true }), fill: { fgColor: { rgb: BLOCO } }, border: bAll(NAVY2), alignment: { vertical: 'center', ...extra } });
  pushRow(wsR, r, [
    cell('TOTAL', stTot({ indent: 1 })),
    cell(div.length, stTot({ horizontal: 'center' }), INT),
    cell(r2(impTot), stTot({ horizontal: 'right' }), NUM),
    cell(impTot ? 1 : 0, stTot({ horizontal: 'right' }), PCT),
  ]); r++;
  wsR['!ref'] = `A1:D${r}`;
  wsR['!cols'] = [{ wch: 22 }, { wch: 6 }, { wch: 9 }, { wch: 7 }];
  wsR['!rows'] = [{ hpt: 26 }, { hpt: 16 }];
  wsR['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    ...[kpiIni, kpiIni + 1, kpiIni + 2].map((rr) => ({ s: { r: rr, c: 0 }, e: { r: rr, c: 1 } })),
  ];

  // ---------------- aba 2: Divergências (celular) ----------------
  const wsD = {};
  const merges = [];
  const alturas = [];
  let rr = 0;
  const mergeRow = (row) => merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 4 } });

  pushRow(wsD, rr, [cell(`Divergências de ${diaBr} — valores em R$ · Ⓐ = curva A (teto 3%)`,
    { font: F({ sz: 9, italic: true, color: { rgb: '555555' } }), alignment: { vertical: 'center', indent: 1 } })]); mergeRow(rr); rr++;

  pushRow(wsD, rr, ['Produto', 'Qt', 'Mín', 'Vendido', 'Impacto'].map((h, i) => cell(h, {
    font: F({ sz: 10, bold: true, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: NAVY2 } },
    alignment: { horizontal: i === 0 ? 'left' : i === 1 ? 'center' : 'right', vertical: 'center', indent: i === 0 ? 1 : 0 }, border: bAll(NAVY2),
  }))); rr++;

  for (const [nome, s] of vendOrd) {
    pushRow(wsD, rr, [cell(`${nome.toUpperCase()} — ${s.itens} itens · R$ ${r2(s.impacto).toFixed(2).replace('.', ',')}`,
      { font: F({ bold: true, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: NAVY } }, alignment: { vertical: 'center', indent: 1 } })]);
    alturas[rr] = { hpt: 20 }; mergeRow(rr); rr++;
    for (const [kCli, itens] of s.clientes) {
      pushRow(wsD, rr, [cell(kCli, { font: F({ sz: 10, color: { rgb: NAVY } }), fill: { fgColor: { rgb: BLOCO } }, alignment: { vertical: 'center', indent: 1, wrapText: true } })]);
      mergeRow(rr); rr++;
      itens.forEach((x, i) => {
        const impacto = r2(x.impacto), destaque = impacto >= IMPACTO_DESTAQUE;
        const fillRgb = i % 2 ? ZEBRA : 'FFFFFF';
        const stNum = (opts = {}) => ({
          font: F({ bold: !!opts.bold, color: { rgb: opts.cor || '000000' } }),
          fill: { fgColor: { rgb: opts.fill || fillRgb } },
          border: bAll(), alignment: { horizontal: opts.h || 'right', vertical: 'center' },
        });
        pushRow(wsD, rr, [
          cell((x.A ? 'Ⓐ ' : '') + x.prod + ' · ' + x.cod, { font: F({ color: { rgb: x.A ? '7A5B00' : '000000' } }), fill: { fgColor: { rgb: x.A ? AMBAR : fillRgb } }, border: bAll(), alignment: { wrapText: true, vertical: 'center', indent: 1 } }),
          cell(x.qt, stNum({ h: 'center' }), QTD),
          cell(r2(x.precoMin), stNum(), NUM),
          cell(r2(x.unit), stNum({ cor: VERMELHO }), NUM),
          cell(impacto, stNum(destaque ? { bold: true, cor: VERMELHO, fill: ROSA } : {}), NUM),
        ]); rr++;
      });
    }
  }
  const stTotD = (extra = {}) => ({ font: F({ bold: true, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: NAVY } }, border: bAll(NAVY), alignment: { vertical: 'center', ...extra } });
  pushRow(wsD, rr, [
    cell(div.length ? `TOTAL — ${div.length} itens` : 'Nenhuma divergência ✔', stTotD({ indent: 1 })),
    cell('', stTotD()), cell('', stTotD()), cell('', stTotD()),
    cell(r2(div.reduce((s, x) => s + r2(x.impacto), 0)), stTotD({ horizontal: 'right' }), NUM),
  ]);
  alturas[rr] = { hpt: 20 }; rr++;
  wsD['!ref'] = `A1:E${rr}`;
  wsD['!cols'] = [{ wch: 30 }, { wch: 4.5 }, { wch: 8 }, { wch: 8 }, { wch: 9 }];
  wsD['!rows'] = alturas;
  wsD['!merges'] = merges;

  // ---------------- aba 3: Completa (PC) ----------------
  const CAB = ['Vendedor', 'Cliente', 'Pedido', 'DAV', 'Cód', 'Produto', 'Emb', 'Qtd',
    'Tabela', 'Custo', 'Preço mín', 'Vendido/un', 'Desc.', 'Falta/un', 'Regra', 'Curva', 'Impacto'];
  const MONEY = new Set([8, 9, 10, 11, 13, 16]), CENTER = new Set([2, 3, 4, 6, 7, 12, 14, 15]);
  const wsC = {};
  pushRow(wsC, 0, CAB.map((h) => cell(h, { font: F({ sz: 10, bold: true, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: NAVY2 } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bAll(NAVY2) })));
  let vAtual = null, bloco = -1;
  ordenado.forEach((x, i) => {
    if (x.vend !== vAtual) { vAtual = x.vend; bloco++; }
    const fillRgb = bloco % 2 ? 'EAF1FA' : 'FFFFFF';
    const vals = [x.vend, x.cli, x.ped, x.nota || '', x.cod, x.prod, x.emb, x.qt,
      r2(x.base), r2(x.custo || 0), r2(x.precoMin), r2(x.unit),
      x.descPrat, r2(x.falta), x.regra, x.A ? 'A' : '', r2(x.impacto)];
    vals.forEach((v, c) => {
      const z = MONEY.has(c) ? MOEDA : c === 7 ? QTD : c === 12 ? PCT : c === 2 || c === 4 ? INT : undefined;
      wsC[XLSX.utils.encode_cell({ r: i + 1, c })] = cell(v, {
        font: F({ sz: 10 }), fill: { fgColor: { rgb: fillRgb } }, border: bAll(),
        alignment: { horizontal: MONEY.has(c) || c === 12 ? 'right' : CENTER.has(c) ? 'center' : 'left', vertical: 'center' },
      }, z);
    });
  });
  wsC['!ref'] = `A1:Q${ordenado.length + 1}`;
  wsC['!cols'] = [{ wch: 19 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 38 }, { wch: 6 }, { wch: 7 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 9 }, { wch: 7 }, { wch: 11 }];
  wsC['!autofilter'] = { ref: `A1:Q${ordenado.length + 1}` };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumo');
  XLSX.utils.book_append_sheet(wb, wsD, 'Divergências');
  XLSX.utils.book_append_sheet(wb, wsC, 'Completa');
  return wb;
}
