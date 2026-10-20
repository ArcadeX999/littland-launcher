# Runs the launcher from source against the local test server
# (voice\dev\run-server.ps1) with voice enabled.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$modpack = Start-Process node -ArgumentList "`"$PSScriptRoot\serve-modpack.js`"" -PassThru -WindowStyle Hidden
try {
    $env:LITTLAND_MANIFEST_URL = 'http://127.0.0.1:8766/manifest.json'
    $env:LITTLAND_SERVER_ADDRESS = 'localhost:25565'
    Push-Location $root
    # Electron is a GUI app: without -Wait PowerShell returns at once and the
    # finally block would stop the modpack server while the launcher runs.
    Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList '.' -Wait -NoNewWindow
} finally {
    Pop-Location
    Stop-Process -Id $modpack.Id -ErrorAction SilentlyContinue
    Remove-Item Env:LITTLAND_MANIFEST_URL, Env:LITTLAND_SERVER_ADDRESS -ErrorAction SilentlyContinue
}
