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
