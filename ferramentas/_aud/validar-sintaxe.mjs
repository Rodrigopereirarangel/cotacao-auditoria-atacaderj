import { readFileSync } from 'node:fs';
const html = readFileSync('app/cotacao-auditoria-atacaderj.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html)) !== null) {
  i++; if (!m[1].trim()) continue;
  try { new Function(m[1]); } catch (e) { bad++; console.error(`SCRIPT #${i} (len ${m[1].length}) SINTAXE: ${e.message}`); }
}
console.log(`blocos: ${i} | falhas: ${bad}`);
process.exit(bad ? 1 : 0);
