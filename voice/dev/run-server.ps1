# Starts a local Purpur 1.21.8 test server with the freshly built LittlandVoice
# plugin. Run voice\dev\setup.ps1 first and voice\plugin\build.ps1 to rebuild.
#   -AcceptEula  accept the Minecraft EULA (https://aka.ms/MinecraftEULA)
param([switch]$AcceptEula)
$ErrorActionPreference = 'Stop'
$dev = Join-Path $env:LOCALAPPDATA 'LittlandDev'
$server = Join-Path $dev 'server'
$java = Join-Path (Get-ChildItem $dev -Directory -Filter 'jdk-21*' | Select-Object -First 1).FullName 'bin\java.exe'
$jar = Get-ChildItem (Join-Path $PSScriptRoot '..\plugin\build\libs\LittlandVoice-*.jar') | Select-Object -First 1
if (-not $jar) { throw 'Compila el plugin primero: voice\plugin\build.ps1' }

New-Item -ItemType Directory -Force (Join-Path $server 'plugins') | Out-Null
Get-ChildItem (Join-Path $server 'plugins\LittlandVoice-*.jar') -ErrorAction SilentlyContinue | Remove-Item
Copy-Item $jar.FullName (Join-Path $server 'plugins')

$eula = Join-Path $server 'eula.txt'
if ($AcceptEula) { Set-Content $eula 'eula=true' -Encoding ascii }
if (-not ((Test-Path $eula) -and (Get-Content $eula -Raw) -match 'eula=true')) {
    Write-Host 'Hay que aceptar el EULA de Minecraft (https://aka.ms/MinecraftEULA): vuelve a ejecutar con -AcceptEula' -ForegroundColor Yellow
    exit 1
}

$props = Join-Path $server 'server.properties'
if (-not (Test-Path $props)) {
    @(
        'online-mode=false', 'server-port=25565', 'motd=Littland voice test',
        'level-type=minecraft\:flat', 'generate-structures=false', 'spawn-protection=0',
        'view-distance=4', 'simulation-distance=4', 'gamemode=creative', 'enforce-secure-profile=false'
    ) | Set-Content $props -Encoding ascii
}

# Offline-mode UUIDs so the test bots are operators (they need /tp).
function Get-OfflineUuid($name) {
    $md5 = [Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes("OfflinePlayer:$name"))
    $md5[6] = ($md5[6] -band 0x0f) -bor 0x30
    $md5[8] = ($md5[8] -band 0x3f) -bor 0x80
    $h = -join ($md5 | ForEach-Object { $_.ToString('x2') })
    "$($h.Substring(0,8))-$($h.Substring(8,4))-$($h.Substring(12,4))-$($h.Substring(16,4))-$($h.Substring(20))"
}
$ops = 'BotA', 'BotB', 'Loro', 'MovilTest' | ForEach-Object {
    [ordered]@{ uuid = (Get-OfflineUuid $_); name = $_; level = 4; bypassesPlayerLimit = $false }
}
ConvertTo-Json @($ops) | Set-Content (Join-Path $server 'ops.json') -Encoding ascii

Set-Location $server
& $java -Xms1G -Xmx2G -jar purpur.jar --nogui
