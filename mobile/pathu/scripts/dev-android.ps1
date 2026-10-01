# Pathu Android USB development helper
# - JDK 17 for any future Gradle needs
# - Verifies ADB device
# - Sets adb reverse for Metro (8081) and Pathu API (3001)
# - Starts Expo dev-client Metro bound for IPv4 (no --localhost)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# Override per machine with PATHU_JDK17 / PATHU_ADB.
$Jdk17 = if ($env:PATHU_JDK17) { $env:PATHU_JDK17 } else { 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot' }
$Adb = if ($env:PATHU_ADB) { $env:PATHU_ADB } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }
$MetroPort = 8081
$ApiPort = 3001
$Package = 'com.anonymous.pathu'
$DeepLink = "exp+pathu://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$MetroPort"

function Set-PathuAdbReverse {
  param([string]$AdbPath, [int]$Metro, [int]$Api)
  & $AdbPath reverse --remove-all | Out-Null
  & $AdbPath reverse "tcp:$Metro" "tcp:$Metro" | Out-Null
  & $AdbPath reverse "tcp:$Api" "tcp:$Api" | Out-Null
}

if (-not (Test-Path $Jdk17)) {
  throw "JDK 17 not found at $Jdk17"
}
if (-not (Test-Path $Adb)) {
  throw "ADB not found at $Adb"
}

$env:JAVA_HOME = $Jdk17
$env:Path = "$Jdk17\bin;$(Split-Path $Adb);$env:Path"
# Prefer IPv4 localhost for USB reverse clients (avoid IPv6-only --localhost bind)
$env:REACT_NATIVE_PACKAGER_HOSTNAME = '127.0.0.1'

Write-Host "JAVA_HOME=$env:JAVA_HOME"
& java -version

$devices = & $Adb devices | Select-String -Pattern '\tdevice$'
if (-not $devices) {
  throw 'No Android device in "device" state. Plug in USB and enable USB debugging.'
}
Write-Host "ADB device(s):"
$devices | ForEach-Object { Write-Host "  $_" }

Set-PathuAdbReverse -AdbPath $Adb -Metro $MetroPort -Api $ApiPort
Write-Host "ADB reverse:"
& $Adb reverse --list

# Launch Pathu once Metro is up (background job polls then deep-links)
$launchJob = Start-Job -ScriptBlock {
  param($Adb, $MetroPort, $ApiPort, $Package, $DeepLink)
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$MetroPort/status" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { break }
    } catch {
      Start-Sleep -Seconds 1
      continue
    }
    Start-Sleep -Seconds 1
  }
  & $Adb reverse --remove-all | Out-Null
  & $Adb reverse "tcp:$MetroPort" "tcp:$MetroPort" | Out-Null
  & $Adb reverse "tcp:$ApiPort" "tcp:$ApiPort" | Out-Null
  & $Adb shell am force-stop $Package | Out-Null
  Start-Sleep -Milliseconds 500
  & $Adb shell am start -a android.intent.action.VIEW -d $DeepLink $Package
} -ArgumentList $Adb, $MetroPort, $ApiPort, $Package, $DeepLink

Write-Host ""
Write-Host "Starting Expo Metro on port $MetroPort (dev-client)..."
Write-Host "API USB reverse: http://127.0.0.1:$ApiPort"
Write-Host "Will open Pathu with: $DeepLink"
Write-Host ""

try {
  pnpm exec expo start --dev-client --port $MetroPort
} finally {
  Stop-Job $launchJob -ErrorAction SilentlyContinue
  Remove-Job $launchJob -Force -ErrorAction SilentlyContinue
}
