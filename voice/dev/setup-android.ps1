# Installs Android Studio (portable zip) and the Android SDK into
# %LOCALAPPDATA%\LittlandDev for the LittlandVoice Android app.
# Running it means accepting the Android SDK License Agreement
# (https://developer.android.com/studio/terms).
$ErrorActionPreference = 'Stop'
$dev = Join-Path $env:LOCALAPPDATA 'LittlandDev'
$sdk = Join-Path $dev 'android-sdk'
New-Item -ItemType Directory -Force $dev, $sdk | Out-Null

# Official Google downloads with the SHA-256 published on developer.android.com/studio
$studio = @{
    Url = 'https://redirector.gvt1.com/edgedl/android/studio/ide-zips/2026.2.1.8/android-studio-rabbit1-windows.zip'
    Sha = '6e83e7ce3e0a76c4e8e78d98eb5ef538cbc9fb386c745bda425fc0bacb9de6d4'
    File = Join-Path $dev 'android-studio.zip'
}
$tools = @{
    Url = 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
    Sha = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
    File = Join-Path $dev 'cmdline-tools.zip'
}

function Get-Verified($d) {
    if ((Test-Path $d.File) -and (Get-FileHash $d.File -Algorithm SHA256).Hash -eq $d.Sha.ToUpper()) { return }
    Write-Host "Descargando $(Split-Path $d.File -Leaf)..."
    & curl.exe -L --fail --retry 5 --retry-delay 3 -C - -o $d.File $d.Url
    if ($LASTEXITCODE -ne 0) { throw "Falló la descarga de $($d.Url)" }
    if ((Get-FileHash $d.File -Algorithm SHA256).Hash -ne $d.Sha.ToUpper()) {
        Remove-Item $d.File
        throw "Checksum incorrecto en $($d.File)"
    }
    Write-Host '  checksum OK' -ForegroundColor Green
}

# Command-line SDK tools -> android-sdk\cmdline-tools\latest
if (-not (Test-Path (Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
    Get-Verified $tools
    $tmp = Join-Path $dev 'cmdline-tools-tmp'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory $tmp | Out-Null
    & tar.exe -xf $tools.File -C $tmp
    New-Item -ItemType Directory -Force (Join-Path $sdk 'cmdline-tools') | Out-Null
    Move-Item (Join-Path $tmp 'cmdline-tools') (Join-Path $sdk 'cmdline-tools\latest')
    Remove-Item $tmp -Recurse -Force
    Remove-Item $tools.File
}

# Android Studio -> android-studio\
if (-not (Test-Path (Join-Path $dev 'android-studio\bin\studio64.exe'))) {
    Get-Verified $studio
    Write-Host 'Descomprimiendo Android Studio (tarda unos minutos)...'
    & tar.exe -xf $studio.File -C $dev
    Remove-Item $studio.File
}

# SDK packages: newest stable platform + build tools, platform-tools and the emulator.
# sdkmanager prints a deprecation warning on stderr; PowerShell 5 must not treat it as fatal.
$ErrorActionPreference = 'Continue'
$env:JAVA_HOME = (Get-ChildItem $dev -Directory -Filter 'jdk-21*' | Select-Object -First 1).FullName
$env:ANDROID_HOME = $sdk
$sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
$list = & $sdkmanager --list --sdk_root=$sdk 2>$null
# Platforms are named android-36, android-37.2...: pick the highest version.
$platform = $list | Select-String '^\s*platforms;android-(\d+(\.\d+)?)\s' | ForEach-Object { $_.Matches[0].Groups[1].Value } |
    Sort-Object { [version]($_ + '.0') } -Descending | Select-Object -First 1
$buildTools = $list | Select-String '^\s*build-tools;(\d+\.\d+\.\d+)\s' | ForEach-Object { $_.Matches[0].Groups[1].Value } |
    Sort-Object { [version]$_ } -Descending | Select-Object -First 1
Write-Host "Instalando SDK: android-$platform, build-tools $buildTools"

# Accept the SDK licenses (agreed to before running this script).
1..20 | ForEach-Object { 'y' } | & $sdkmanager --licenses --sdk_root=$sdk | Out-Null
& $sdkmanager --sdk_root=$sdk --install "platform-tools" "platforms;android-$platform" "build-tools;$buildTools" "emulator"
if ($LASTEXITCODE -ne 0) { throw 'sdkmanager falló' }

Write-Host "Android listo: Studio en $dev\android-studio, SDK en $sdk" -ForegroundColor Green
