# Builds the Littland Android app (debug APK) with the tools from
# voice\dev\setup-android.ps1. Output: app\build\outputs\apk\debug\app-debug.apk
#   -Release  build the release APK instead
param([switch]$Release)
$ErrorActionPreference = 'Stop'
$dev = Join-Path $env:LOCALAPPDATA 'LittlandDev'
$env:JAVA_HOME = (Get-ChildItem $dev -Directory -Filter 'jdk-21*' | Select-Object -First 1).FullName
$env:ANDROID_HOME = Join-Path $dev 'android-sdk'
Push-Location $PSScriptRoot
try {
    # Gradle reads the SDK location from local.properties (backslashes escaped).
    "sdk.dir=$($env:ANDROID_HOME -replace '\\', '\\')" | Set-Content local.properties -Encoding ascii
    $task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
    & .\gradlew.bat $task --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'La compilación falló' }
    Get-ChildItem .\app\build\outputs\apk -Recurse -Filter *.apk | ForEach-Object { "OK: $($_.FullName)" }
} finally {
    Pop-Location
}
