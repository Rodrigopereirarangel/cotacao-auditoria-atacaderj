# =============================================================================
# sync-biblioteca.ps1 — roda no PC do OPERADOR (Agendador do Windows). Invisivel.
# -----------------------------------------------------------------------------
# Fecha o loop "operador -> GitHub" sem o operador fazer nada e sem ele saber:
#   1. O app (artefato), ao o operador ATUALIZAR O CATALOGO, baixa silenciosamente
#      atacaderj-biblioteca.json na pasta Downloads.
#   2. Este script (agendado) pega o arquivo mais novo da Downloads e o ENVIA pro
#      GitHub via API (sem git instalado), sobrescrevendo
#      biblioteca/snapshots/operador-latest.json no repo.
#   3. E idempotente: se o arquivo nao mudou desde o ultimo envio, nao faz nada.
#
# Requer UMA configuracao unica (feita pelo DONO, nao pelo operador):
#   - um token fino do GitHub (Contents: Read and write, SO neste repo) na
#     variavel de ambiente ATACADERJ_GH_TOKEN.
#   - agendar este script no Agendador de Tarefas (ex.: a cada 30 min, oculto).
# Sem token, o script sai em silencio (nao quebra nada).
# =============================================================================
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Repo      = 'Rodrigopereirarangel/cotacao-auditoria-atacaderj'
$RepoPath  = 'biblioteca/snapshots/operador-latest.json'
$Branch    = 'main'
$Token     = $env:ATACADERJ_GH_TOKEN
$Downloads = Join-Path $env:USERPROFILE 'Downloads'
$Marker    = Join-Path $env:LOCALAPPDATA 'atacaderj-sync-last.txt'

if (-not $Token) { exit 0 }  # sem token configurado: nao faz nada, em silencio

# arquivo de biblioteca mais recente baixado pelo app
$f = Get-ChildItem $Downloads -Filter 'atacaderj-biblioteca*.json' -File -ErrorAction SilentlyContinue |
     Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $f) { exit 0 }

# nao re-enviar o mesmo conteudo
$hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.Trim()
$last = if (Test-Path $Marker) { (Get-Content $Marker -Raw).Trim() } else { '' }
if ($hash -eq $last) { exit 0 }

$contentB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
$headers = @{ Authorization = "Bearer $Token"; 'User-Agent' = 'atacaderj-sync'; Accept = 'application/vnd.github+json' }
$apiUrl  = "https://api.github.com/repos/$Repo/contents/$RepoPath"

# pega o sha atual do arquivo no repo (se ja existir), p/ poder sobrescrever
$sha = $null
try { $cur = Invoke-RestMethod -Uri ($apiUrl + "?ref=$Branch") -Headers $headers -Method Get; $sha = $cur.sha } catch {}

$body = @{ message = "snapshot biblioteca (operador) $(Get-Date -Format 'yyyy-MM-dd HH:mm')"; content = $contentB64; branch = $Branch }
if ($sha) { $body.sha = $sha }
Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method Put -Body ($body | ConvertTo-Json -Compress) | Out-Null

Set-Content -Path $Marker -Value $hash -Encoding ascii
