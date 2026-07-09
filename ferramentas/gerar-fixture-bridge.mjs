// Gera um catalogo_bridge.json FALSO com data de hoje, para testar o fluxo
// "Arquivo único do bridge" do app sem depender do erp-bridge/MySQL.
// Inclui a seção pedidos_venda (histórico p/ a aba Auditoria).
// Uso: node ferramentas/gerar-fixture-bridge.mjs
import fs from 'node:fs';

const agora = new Date();
const p2 = n => String(n).padStart(2, '0');
const hojeIso = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}`;
const gerado_em = `${hojeIso} ${p2(agora.getHours())}:${p2(agora.getMinutes())}:00`;

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

// historico falso de pedidos de venda: hoje e ontem, 2 pedidos por dia
const ontem = new Date(agora.getTime() - 86400000);
const ontemIso = `${ontem.getFullYear()}-${p2(ontem.getMonth() + 1)}-${p2(ontem.getDate())}`;
const pedidos = [];
let ped = 9000;
for (const dia of [ontemIso, hojeIso]) {
  for (let k = 0; k < 2; k++) {
    ped++;
    const itens = [];
    for (let j = 1; j <= 4; j++) {
      const prod = produtos[(ped + j * 7) % produtos.length];
      // [codigo, emb, qtde, valor_por_volume, custo_un] — 1 item vendido abaixo do minimo
      const abaixo = j === 1 && k === 1;
      itens.push([prod.c, j === 4 ? 'CX-12' : 'UN', j,
        Math.round(prod.v * (abaixo ? 0.85 : 1) * (j === 4 ? 12 : 1) * 100) / 100,
        prod.custo || Math.round(prod.v * 0.8 * 100) / 100]);
    }
    pedidos.push({ dia, ped, dav: 6000 + ped % 100, cli: `CLIENTE TESTE ${ped % 3}`,
      vend: ['Ana Teste', 'Beto Teste'][ped % 2], itens });
  }
}

const obj = { origem: 'erp-bridge', gerado_em, total: produtos.length, produtos,
  pedidos_venda: { janela_dias: 7, pedidos } };
fs.mkdirSync('ferramentas/fixtures', { recursive: true });
fs.writeFileSync('ferramentas/fixtures/catalogo_bridge.hoje.json', JSON.stringify(obj));
console.log(`OK ferramentas/fixtures/catalogo_bridge.hoje.json — ${produtos.length} produtos, ` +
  `${pedidos.length} pedidos de venda, ${gerado_em}`);
