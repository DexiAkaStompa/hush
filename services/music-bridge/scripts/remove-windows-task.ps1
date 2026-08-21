$ErrorActionPreference = "Stop"
$taskName = "Hush Music Bridge"
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Task rimosso: $taskName"
