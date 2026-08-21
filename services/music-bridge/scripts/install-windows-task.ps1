$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Apri PowerShell come amministratore e riprova."
}

$serviceRoot = Split-Path -Parent $PSScriptRoot
$taskName = "Hush Music Bridge"
$runner = Join-Path $PSScriptRoot "start-windows.ps1"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20 o superiore non trovato nel PATH." }
if (-not (Test-Path (Join-Path $serviceRoot ".env"))) {
  Copy-Item (Join-Path $serviceRoot ".env.example") (Join-Path $serviceRoot ".env")
  Write-Warning "Creato .env: compilalo prima di avviare il task."
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $serviceRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Description "Hush Lavalink music bridge"
Start-ScheduledTask -TaskName $taskName
Write-Host "Hush Music Bridge avviato come task Windows: $taskName"
Write-Host "Log: $(Join-Path $serviceRoot 'logs\bridge.log')"
