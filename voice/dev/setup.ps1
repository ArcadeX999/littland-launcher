# Installs the LittlandVoice dev tools into %LOCALAPPDATA%\LittlandDev
# (outside OneDrive): Temurin JDK 21, Gradle and a Purpur 1.21.8 test server.
# Every download is checked against its published checksum.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dev = Join-Path $env:LOCALAPPDATA 'LittlandDev'
New-Item -ItemType Directory -Force (Join-Path $dev 'server') | Out-Null

function Get-Verified($url, $file, $algorithm, $expected) {
    if ((Test-Path $file) -and (Get-FileHash $file -Algorithm $algorithm).Hash -eq $expected.ToUpper()) { return }
    Write-Host "Descargando $(Split-Path $file -Leaf)..."
    Invoke-WebRequest $url -OutFile $file -UseBasicParsing
    $actual = (Get-FileHash $file -Algorithm $algorithm).Hash
    if ($actual -ne $expected.ToUpper()) { Remove-Item $file; throw "Checksum incorrecto en $file" }
}

# JDK 21
if (-not (Get-ChildItem $dev -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue)) {
    $asset = (Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?os=windows&architecture=x64&image_type=jdk&vendor=eclipse')[0].binary.package
    $zip = Join-Path $dev 'jdk21.zip'
    Get-Verified $asset.link $zip 'SHA256' $asset.checksum
    Expand-Archive $zip $dev -Force
    Remove-Item $zip
}

# Gradle
$gradleVersion = '9.8.2'
if (-not (Test-Path (Join-Path $dev "gradle-$gradleVersion"))) {
    $url = "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip"
    $sha = (New-Object Net.WebClient).DownloadString("$url.sha256").Trim()
    $zip = Join-Path $dev 'gradle.zip'
    Get-Verified $url $zip 'SHA256' $sha
    Expand-Archive $zip $dev -Force
    Remove-Item $zip
}

# Purpur 1.21.8 test server
$jar = Join-Path $dev 'server\purpur.jar'
$info = Invoke-RestMethod 'https://api.purpurmc.org/v2/purpur/1.21.8/latest'
Get-Verified 'https://api.purpurmc.org/v2/purpur/1.21.8/latest/download' $jar 'MD5' $info.md5

$jdk = (Get-ChildItem $dev -Directory -Filter 'jdk-21*' | Select-Object -First 1).FullName
& "$jdk\bin\java.exe" -version
Write-Host "Herramientas listas en $dev" -ForegroundColor Green
