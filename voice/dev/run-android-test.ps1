# Runs the Android app in the "Littland" emulator against the local test server.
# Start first: voice\dev\run-server.ps1, node voice\dev\serve-modpack.js and
# node voice\dev\bot\standin.js MovilTest (the stand-in "Bedrock player").
#   -Gamertag   name the app connects as (default MovilTest)
#   -Threshold  voice threshold in dB; -80 transmits constantly (handy for tests)
#   -Discord    preview the Discord button with this link
param([string]$Gamertag = 'MovilTest', [float]$Threshold = -80, [string]$Discord = '')
$ErrorActionPreference = 'Continue'
$sdk = Join-Path $env:LOCALAPPDATA 'LittlandDev\android-sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$apk = Join-Path $PSScriptRoot '..\android\app\build\outputs\apk\debug\app-debug.apk'

if (-not (& $adb devices | Select-String 'emulator-\d+\s+device')) {
    Write-Host 'Arrancando el emulador (con el micrófono del PC)...'
    Start-Process (Join-Path $sdk 'emulator\emulator.exe') -ArgumentList '-avd', 'Littland', '-allow-host-audio', '-no-snapshot-save' -WindowStyle Minimized
    & $adb wait-for-device
    do { Start-Sleep 2 } until ((& $adb shell getprop sys.boot_completed) -match '1')
}
Write-Host 'Instalando la app...'
& $adb install -r $apk
& $adb shell pm grant net.littland.app android.permission.RECORD_AUDIO
& $adb shell pm grant net.littland.app android.permission.POST_NOTIFICATIONS
& $adb logcat -c
# The emulator reaches this PC as 10.0.2.2.
& $adb shell am start -S -n net.littland.app/.MainActivity `
    --es manifestUrl "'http://10.0.2.2:8766/manifest.json?host=10.0.2.2&discord=$Discord'" `
    --es gamertag $Gamertag --ef threshold $Threshold --ez autoVoice true
Write-Host "App abierta como $Gamertag. Registro de voz (Ctrl+C para salir):" -ForegroundColor Green
& $adb logcat -s LittlandVoice:I AndroidRuntime:E
