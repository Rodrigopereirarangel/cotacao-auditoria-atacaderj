# proxy-teste — testar a IA do app localmente

O app chama `https://api.anthropic.com/v1/messages` **sem chave** e **sem o header de CORS de browser**. Por isso, abrindo como arquivo (`file://`), a IA não responde (CORS + 401) — só as partes locais funcionam. Este proxy resolve isso **sem alterar o app**.

## Como funciona (e por que não quebra a trava de integridade)

1. Serve o app em `http://localhost:8787`.
2. Injeta um `<script>` logo após `<head>` — que fica **fora do `#app-core`**, então o **hash de integridade não muda** e o app continua "versão oficial". Esse script faz *monkey-patch* do `window.fetch`: chamadas para `api.anthropic.com` viram chamadas same-origin para `/__anthropic`.
3. `/__anthropic` encaminha para a Anthropic injetando `x-api-key` (sua chave) + `anthropic-version`.

## Uso

Você precisa de uma **chave da Anthropic** (`sk-ant-...`). Defina na variável de ambiente — **nunca cole a chave em arquivo nem no chat**.

**PowerShell:**
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."
node ferramentas/proxy-teste/servir.mjs
```

**bash:**
```bash
ANTHROPIC_API_KEY=sk-ant-... node ferramentas/proxy-teste/servir.mjs
```

Depois abra **http://localhost:8787**. A cotação por IA passa a responder usando a sua chave/cota.

Flags: `--porta 8787`, `--app app/cotacao-auditoria-atacaderj.html`.

## Segurança

- A chave fica **só na sua máquina** (variável de ambiente em memória). Não é commitada.
- Use uma chave de **teste** com limite de gasto.
- Isto é para **desenvolvimento/teste local** — não exponha esta porta na internet (ela encaminha requests com a sua chave).

## Sem chave própria?

Se você não tem uma chave da Anthropic e o app normalmente roda em outro lugar (algum proxy/host que injeta a autenticação), me diga como é esse setup que eu adapto o teste para ele.
