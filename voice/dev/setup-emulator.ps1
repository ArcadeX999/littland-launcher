# Creates the "Littland" Android emulator (Android 16, Pixel-like) for testing
# the app. Needs voice\dev\setup-android.ps1 first.
# The system image is downloaded with curl (resumes on flaky connections; the
# SDK manager restarts from zero) and checked against Google's published SHA-1.
$ErrorActionPreference = 'Stop'
$sdk = Join-Path $env:LOCALAPPDATA 'LittlandDev\android-sdk'
$imageDir = Join-Path $sdk 'system-images\android-36\google_apis\x86_64'
$zip = Join-Path $env:LOCALAPPDATA 'LittlandDev\sysimg-x86_64-36_r07.zip'
$url = 'https://dl.google.com/android/repository/sys-img/google_apis/x86_64-36_r07.zip'
$sha1 = 'c6bf44bdcd885bb902b4ba752d111a073ad7a817'

if (-not (Test-Path (Join-Path $imageDir 'system.img'))) {
    $tries = 0
    while (-not ((Test-Path $zip) -and (Get-FileHash $zip -Algorithm SHA1).Hash -eq $sha1.ToUpper())) {
        if (++$tries -gt 30) { throw 'No se pudo descargar la imagen del emulador' }
        Write-Host "Descargando imagen de Android 16 (1,9 GB), intento $tries..."
        & curl.exe -L --fail --retry 10 --retry-delay 3 --retry-all-errors -C - -o $zip $url
    }
    Write-Host '  checksum OK' -ForegroundColor Green
    New-Item -ItemType Directory -Force (Split-Path $imageDir) | Out-Null
    & tar.exe -xf $zip -C (Split-Path $imageDir) # the zip holds an x86_64\ folder
    Remove-Item $zip
}

# AVD files written directly (the emulator only needs these two).
$avdRoot = Join-Path $env:USERPROFILE '.android\avd'
$avd = Join-Path $avdRoot 'Littland.avd'
New-Item -ItemType Directory -Force $avd | Out-Null
@(
    'avd.ini.encoding=UTF-8',
    "path=$avd",
    'path.rel=avd\Littland.avd',
    'target=android-36'
) | Set-Content (Join-Path $avdRoot 'Littland.ini') -Encoding ascii
@(
    'AvdId=Littland', 'avd.ini.displayname=Littland',
    'abi.type=x86_64', 'hw.cpu.arch=x86_64', 'hw.cpu.ncore=4',
    'image.sysdir.1=system-images\android-36\google_apis\x86_64\',
    'tag.id=google_apis', 'tag.display=Google APIs', 'PlayStore.enabled=false',
    'hw.ramSize=3072', 'disk.dataPartition.size=6G',
    'hw.lcd.width=1080', 'hw.lcd.height=2400', 'hw.lcd.density=420',
    'hw.keyboard=yes', 'hw.gpu.enabled=yes', 'hw.gpu.mode=auto',
    # Let the virtual phone use the PC's microphone and speakers.
    'hw.audioInput=yes', 'hw.audioOutput=yes'
) | Set-Content (Join-Path $avd 'config.ini') -Encoding ascii
Write-Host 'Emulador "Littland" listo.' -ForegroundColor Green
