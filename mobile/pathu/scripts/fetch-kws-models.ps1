# Fetch English sherpa-onnx KWS models (int8) for Pathu Phase 7A.
# Keyword "HEY PATHU" is encoded into keywords.txt with SentencePiece.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Dst = Join-Path $Root 'assets\wakeword\sherpa-kws-en'
New-Item -ItemType Directory -Force -Path $Dst | Out-Null

$Tar = Join-Path $env:TEMP 'sherpa-kws-gigaspeech.tar.bz2'
$Url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2'

Write-Host "Downloading $Url"
curl.exe -L --fail -o $Tar $Url

$Extract = Join-Path $env:TEMP 'sherpa-kws-extract'
Remove-Item -Recurse -Force $Extract -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Extract | Out-Null
tar -xjf $Tar -C $Extract

$Src = Join-Path $Extract 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'
Copy-Item "$Src\encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx" $Dst -Force
Copy-Item "$Src\decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx" $Dst -Force
Copy-Item "$Src\joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx" $Dst -Force
Copy-Item "$Src\tokens.txt" $Dst -Force
Copy-Item "$Src\bpe.model" $Dst -Force

$EncodePy = Join-Path $env:TEMP 'pathu_encode_kw.py'
@'
import os, sys
import sentencepiece as spm
dst = sys.argv[1]
sp = spm.SentencePieceProcessor()
sp.load(os.path.join(dst, "bpe.model"))
pieces = sp.encode("HEY PATHU", out_type=str)
line = " ".join(pieces) + " :1.5 #0.25"
open(os.path.join(dst, "keywords.txt"), "w", encoding="utf-8", newline="\n").write(line + "\n")
print("ok")
'@ | Set-Content -Path $EncodePy -Encoding ascii

uv run --with sentencepiece python $EncodePy $Dst
Write-Host "Models ready in $Dst"
Get-ChildItem $Dst | Format-Table Name, Length -AutoSize
