# Fetch the pre-trained openWakeWord "hey jarvis" model + shared feature models (TFLite, v0.5.1)
# for the native assistant wake path (modules/pathu-assistant).
# Models: https://github.com/dscripka/openWakeWord (pre-trained models are CC BY-NC-SA 4.0).

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Dst = Join-Path $Root 'modules\pathu-assistant\android\src\main\assets\openwakeword'
New-Item -ItemType Directory -Force -Path $Dst | Out-Null

$Base = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1'
foreach ($name in 'melspectrogram.tflite', 'embedding_model.tflite', 'hey_jarvis_v0.1.tflite') {
  $out = Join-Path $Dst $name
  Write-Host "Downloading $name"
  curl.exe -L --fail -o $out "$Base/$name"
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $name" }
}
Get-ChildItem $Dst | Format-Table Name, Length
