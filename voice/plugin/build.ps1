# Builds the LittlandVoice plugin with the dev JDK in %LOCALAPPDATA%\LittlandDev.
# Output: voice\plugin\build\libs\LittlandVoice-<version>.jar
$ErrorActionPreference = 'Stop'
$dev = Join-Path $env:LOCALAPPDATA 'LittlandDev'
$env:JAVA_HOME = (Get-ChildItem $dev -Directory -Filter 'jdk-21*' | Select-Object -First 1).FullName
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path .\gradlew.bat)) {
        & (Join-Path $dev 'gradle-9.8.2\bin\gradle.bat') wrapper --gradle-version 9.8.2 -q
    }
    & .\gradlew.bat build -q
    if ($LASTEXITCODE -ne 0) { throw 'La compilación falló' }
    Get-ChildItem .\build\libs\*.jar | ForEach-Object { "OK: $($_.FullName)" }
} finally {
    Pop-Location
}
