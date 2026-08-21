$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $PSScriptRoot
Set-Location $serviceRoot

$logDirectory = Join-Path $serviceRoot "logs"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logFile = Join-Path $logDirectory "bridge.log"
$node = (Get-Command node -ErrorAction Stop).Source
$entry = Join-Path $serviceRoot "src\server.mjs"

& $node $entry *>> $logFile
exit $LASTEXITCODE
