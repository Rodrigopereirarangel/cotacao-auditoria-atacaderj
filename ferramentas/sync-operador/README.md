# sync-operador — biblioteca do operador → GitHub (automático e invisível)

Fecha o último elo do loop quando **o operador é quem atualiza o catálogo**: o app baixa o snapshot da biblioteca na Downloads do operador, e este script (agendado no PC do operador) o **envia sozinho pro GitHub**. O operador **não faz nada e não vê nada**.

> Setup é feito **uma vez, pelo DONO**, no PC do operador. Depois roda em background.

## Como funciona
```
Operador atualiza o catálogo no app (artefato)
   → app baixa atacaderj-biblioteca.json na Downloads (silencioso)
Agendador do Windows roda sync-biblioteca.ps1 (ex.: a cada 30 min)
   → pega o arquivo mais novo → envia pro GitHub (API) → biblioteca/snapshots/operador-latest.json
(idempotente: se não mudou, não faz nada)
```

## Setup (uma vez, pelo dono, no PC do operador)

### 1) Criar um token fino do GitHub
- GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new token**.
- **Repository access:** *Only select repositories* → `cotacao-atacaderj`.
- **Permissions:** *Repository → Contents → Read and write*.
- Gere e **copie** o token (`github_pat_...`).

### 2) Guardar o token no PC do operador (variável de ambiente)
No PowerShell (como o usuário do operador), defina permanente:
```powershell
[Environment]::SetEnvironmentVariable('ATACADERJ_GH_TOKEN','github_pat_COLE_AQUI','User')
```

### 3) Copiar o script
Copie `sync-biblioteca.ps1` para uma pasta no PC do operador, ex.: `C:\atacaderj\sync-biblioteca.ps1`.

### 4) Agendar (Agendador de Tarefas)
- Abra o **Agendador de Tarefas** → *Criar Tarefa*.
- **Disparadores:** ex. *Diariamente* repetindo a cada *30 minutos*; e também *Ao iniciar sessão* (opcional).
- **Ações:** *Iniciar um programa*:
  - Programa: `powershell.exe`
  - Argumentos: `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\atacaderj\sync-biblioteca.ps1"`
- Marque *Executar estando o usuário conectado ou não* e *Oculto*.

### 5) Testar
- Atualize o catálogo no app (gera o download), ou copie um `atacaderj-biblioteca.json` para a Downloads.
- Rode a tarefa manualmente. Confira `biblioteca/snapshots/operador-latest.json` no GitHub.

## Segurança (leia)
- O token tem escopo **mínimo**: só este repo, só *Contents*. Mesmo vazando, o dano se limita a este repositório.
- Ideal: criar o token numa **conta-robô** do GitHub com acesso só a este repo (não a sua conta pessoal).
- O token fica **só** na variável de ambiente do PC do operador; **nunca** é commitado.

## Depois (lado do dono)
O snapshot cru cai em `biblioteca/snapshots/operador-latest.json`. O dono (ou o loop) **valida e mescla** isso na biblioteca curada (`apelidos.json` etc.) passando pelo gate de qualidade, e re-publica o artefato. Assim o aprendizado do operador entra no loop **sem o operador participar**.
