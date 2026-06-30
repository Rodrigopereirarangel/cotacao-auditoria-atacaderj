# ============================================================================
#  INSTALADOR — Sync da biblioteca Atacaderj -> GitHub (rode no PC do OPERADOR)
#  Cole TUDO isto no PowerShell. So edite a linha do TOKEN abaixo.
#  Faz tudo sozinho: escreve o script, salva config, agenda (30 min) e testa.
# ============================================================================

# >>>>>> COLE AQUI seu token fino do GitHub (Contents: Read and write, SO este repo) <<<<<<
$TOKEN = 'github_pat_COLE_SEU_TOKEN_AQUI'
# ============================================================================

$ErrorActionPreference = 'Stop'
# Se voce nao editou a linha do TOKEN acima, ele pergunta agora (digitacao escondida):
if ($TOKEN -notmatch '^github_pat_|^ghp_') {
  $sec = Read-Host 'Cole o token do GitHub (fino, Contents:write, so este repo) e tecle Enter' -AsSecureString
  $TOKEN = [System.Net.NetworkCredential]::new('', $sec).Password
}
if ($TOKEN -notmatch '^github_pat_|^ghp_') { Write-Host 'Token invalido ou vazio. Cancelado.' -ForegroundColor Red; return }

$dir = Join-Path $env:LOCALAPPDATA 'AtacaderjSync'
New-Item -ItemType Directory -Force $dir | Out-Null
$scriptPath = Join-Path $dir 'sync-biblioteca.ps1'

# 1) config.json (token + repo)
@{
  token    = $TOKEN
  repo     = 'Rodrigopereirarangel/cotacao-atacaderj'
  repoPath = 'biblioteca/snapshots/operador-latest.json'
  branch   = 'main'
} | ConvertTo-Json | Set-Content -Path (Join-Path $dir 'config.json') -Encoding UTF8

# 2) o script de sync (estatico; le o config.json ao lado dele)
$sync = @'
$ErrorActionPreference='Stop'
try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12}catch{}
$dir = Split-Path -Parent $PSCommandPath
$cfg = (Get-Content (Join-Path $dir 'config.json') -Raw) | ConvertFrom-Json
$Token=$cfg.token; $Repo=$cfg.repo; $RepoPath=$cfg.repoPath; $Branch=$cfg.branch
if(-not $Token){ exit 0 }
$Downloads = Join-Path $env:USERPROFILE 'Downloads'
$Marker = Join-Path $dir 'last.txt'
$f = Get-ChildItem $Downloads -Filter 'atacaderj-biblioteca*.json' -File -ErrorAction SilentlyContinue |
     Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $f){ exit 0 }
$hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.Trim()
$last = if(Test-Path $Marker){ (Get-Content $Marker -Raw).Trim() } else { '' }
if($hash -eq $last){ exit 0 }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
$headers = @{ Authorization="Bearer $Token"; 'User-Agent'='atacaderj-sync'; Accept='application/vnd.github+json' }
$api = "https://api.github.com/repos/$Repo/contents/$RepoPath"
$sha = $null
try{ $cur = Invoke-RestMethod -Uri ($api + "?ref=$Branch") -Headers $headers -Method Get; $sha = $cur.sha }catch{}
$body = @{ message="snapshot biblioteca (operador) $(Get-Date -Format 'yyyy-MM-dd HH:mm')"; content=$b64; branch=$Branch }
if($sha){ $body.sha = $sha }
Invoke-RestMethod -Uri $api -Headers $headers -Method Put -Body ($body | ConvertTo-Json -Compress) | Out-Null
Set-Content -Path $Marker -Value $hash -Encoding ascii
'@
Set-Content -Path $scriptPath -Value $sync -Encoding UTF8

# 3) agenda a cada 30 min (no contexto do usuario, oculto)
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date)
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)).Repetition
Register-ScheduledTask -TaskName 'AtacaderjSyncBiblioteca' -Action $action -Trigger $trigger -Description 'Sync biblioteca Atacaderj -> GitHub' -Force | Out-Null

# 4) roda uma vez agora (testa)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath

Write-Host ''
Write-Host "OK! Sync instalado em: $dir" -ForegroundColor Green
Write-Host "Tarefa 'AtacaderjSyncBiblioteca' agendada a cada 30 min." -ForegroundColor Green
Write-Host "Quando o operador atualizar o catalogo, o snapshot sobe sozinho pro GitHub." -ForegroundColor Green
