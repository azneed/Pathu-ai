# Pathu wake-word assets (Phase 7A · experiment baseline)

Engine: sherpa-onnx open-vocabulary keyword spotting (English GigaSpeech 3.3M int8).

**Status:** the pipeline works end-to-end on-device (the known-good WAV self-test detects `HEY PATHU`), but this model does **not** reliably recognize the user's own spoken “Hey Pathu” on the physical iQOO Neo 10R. Kept as the baseline until the planned custom openWakeWord “Hey Pathu” model replaces it (not implemented yet).

Required files (run `powershell -File scripts/fetch-kws-models.ps1` if missing):

- encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx
- decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx
- joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx
- tokens.txt
- bpe.model
- keywords.txt  (BPE encoding of "HEY PATHU", `:1.5 #0.25`)
- keywords_raw.txt  (human-readable source line for keywords.txt)

Test data: `testdata/hey_pathu_16k.wav` — known-good 16 kHz mono PCM16 clip used by the WAV self-test.

Source: https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2

No cloud wake detection. No transcript matcher.
