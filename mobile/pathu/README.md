# Pathu (mobile)

Expo SDK 57 development client for the Pathu assistant.

## Architecture

```
Mobile UI (src/app)
  → src/api client
  → Pathu backend http://127.0.0.1:3001  (USB via adb reverse)
  → existing /chat AI + tools + devices
```

The mobile app does **not** run its own LLM.

## USB Android development

Prerequisites:

1. Pathu backend running on the PC at port **3001** (`npm start` from the repo root).
2. Development APK already installed (`com.anonymous.pathu`).
3. Phone connected over USB with debugging enabled.

Start Metro + reverse both ports + open the app:

```bash
npm run dev:android
```

This helper:

- uses JDK 17
- verifies ADB
- runs `adb reverse tcp:8081 tcp:8081` (Metro)
- runs `adb reverse tcp:3001 tcp:3001` (Pathu API)
- starts Expo Metro on 8081
- opens the Pathu dev client at `127.0.0.1:8081`

### API URL

```bash
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3001
```

Copy `.env.example` to `.env` if needed. Do **not** use the LAN IP for the USB workflow.

### Endpoints used

- `GET /health` → connection indicator
- `POST /chat` with `{ "message": "..." }` → `{ "reply": "...", ... }`

### Status

- **Phase 6** text chat — COMPLETE
- **Phase 7A** sherpa-onnx foreground wake — COMPLETE as an experiment; the current model does not reliably recognize the user's own “Hey Pathu” (WAV self-test passes)
- **Phase 7** foreground voice conversation — COMPLETE
- **Phase 7B.1** microphone foreground service implemented; locked-screen wake pending (current wake model unsuitable for the user's voice)
- **Next (planned, not implemented):** custom openWakeWord “Hey Pathu” model + native Android voice core

Voice is **Phase 7 (foreground voice conversation)**:

1. Local sherpa-onnx KWS detects **“Hey Pathu”** (Phase 7A experiment baseline)
2. KWS releases the mic → `expo-speech-recognition` captures one command
3. Transcript → existing `POST /chat`
4. Real Pathu `reply` spoken with `expo-speech`
5. Return to wake listening (say “Hey Pathu” again for the next command)

**Foreground only** — background / locked-screen is Phase 7B. Command STT prefers on-device recognition when Android supports it; otherwise it uses the system/remote speech service (not claimed fully offline).

### Phase 7B.1 — locked-screen wake baseline

A microphone foreground service (`modules/pathu-wake-fgs`) starts with wake listening and shows the notification “Pathu is listening for Hey Pathu”. It keeps the existing sherpa-onnx listener alive while the screen is locked (single KWS instance; no second mic consumer). Start listening while the app is open; stopping wake listening stops the service. Needs a native rebuild.

Physical iQOO result (2026-09-28): service, notification, locked-screen mic capture (unsilenced), stop/restart and duplicate-start guards verified. Live-voice “Hey Pathu” does not trigger the current KWS model (unlocked or locked; WAV self-test passes). Follow-up analysis traced this to model/phrase compatibility with the user's pronunciation, not the capture pipeline, so locked-screen wake detection stays pending until the wake model is replaced. OEM battery settings may still interfere with long locked periods.

### DEV diagnostics (Diagnostics panel, `__DEV__` only)

- **Test WAV (Hey Pathu)** — feeds `assets/wakeword/testdata/hey_pathu_16k.wav` through KWS
- **Mic diagnostic (5 s)** — 16 kHz mono `MIC` capture stats, app-private `mic_diag.wav`, offline KWS on the capture (no upload)
- **STT only, no KWS** — isolates `expo-speech-recognition`
- **Resume voice controller**

`dev-android.ps1` defaults can be overridden with `PATHU_JDK17` / `PATHU_ADB`.

### Wake models

```bash
powershell -File scripts/fetch-kws-models.ps1
```

Place/confirm models under `assets/wakeword/sherpa-kws-en/`. After adding native modules, rebuild once:

```bash
npm run android
```

Then day-to-day JS iteration:

```bash
npm run dev:android
```
