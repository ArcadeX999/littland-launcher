# Saves a screenshot of the emulator to voice\dev\screenshots\<name>.png
param([string]$Name = 'app')
$adb = Join-Path $env:LOCALAPPDATA 'LittlandDev\android-sdk\platform-tools\adb.exe'
$dir = Join-Path $PSScriptRoot 'screenshots'
New-Item -ItemType Directory -Force $dir | Out-Null
& $adb shell screencap -p /sdcard/littland-shot.png
& $adb pull /sdcard/littland-shot.png (Join-Path $dir "$Name.png") | Out-Null
& $adb shell rm /sdcard/littland-shot.png
"Captura: $(Join-Path $dir "$Name.png")"
