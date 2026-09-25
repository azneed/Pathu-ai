/**
 * Browser copy of Pathu voice wake/state helpers (kept in sync with src/voice/*).
 * Attaches to window.PathuVoiceCore for the /voice page IIFE.
 */
(function (global) {
  "use strict";

  var DEFAULT_WAKE_PHRASES = ["hey pathu", "pathu"];

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeSpeech(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findWakeMatch(transcript, phrases) {
    var normalized = normalizeSpeech(transcript);
    if (!normalized) return null;
    var list = (phrases || DEFAULT_WAKE_PHRASES)
      .map(normalizeSpeech)
      .filter(Boolean)
      .sort(function (a, b) {
        return b.length - a.length;
      });
    var best = null;
    for (var i = 0; i < list.length; i += 1) {
      var phrase = list[i];
      var re = new RegExp("(?:^|\\s)" + escapeRegExp(phrase) + "(?=\\s|$)", "i");
      var match = re.exec(normalized);
      if (!match) continue;
      var index = match.index + (match[0].charAt(0) === " " ? 1 : 0);
      var endIndex = index + phrase.length;
      if (
        !best ||
        index < best.index ||
        (index === best.index && phrase.length > best.phrase.length)
      ) {
        best = { phrase: phrase, index: index, endIndex: endIndex };
      }
    }
    return best;
  }

  function extractCommandAfterWake(transcript, phrases) {
    var match = findWakeMatch(transcript, phrases);
    if (!match) return { woke: false, phrase: null, command: "" };
    var normalized = normalizeSpeech(transcript);
    var after = normalized.slice(match.endIndex).trim();
    var command = after.replace(/^(please|can you|could you)\s+/i, "").trim();
    return { woke: true, phrase: match.phrase, command: command };
  }

  function createVoiceMachineState(mode) {
    return {
      state: "IDLE",
      mode: mode || "handsfree",
      pendingCommand: null,
      lastError: null,
    };
  }

  function shouldRunWakeDetector(machine) {
    return machine.mode === "handsfree" && machine.state === "IDLE";
  }

  function reduceVoiceState(current, event) {
    switch (event.type) {
      case "MODE_CHANGED":
        return createVoiceMachineState(event.mode);
      case "WAKE": {
        if (current.mode !== "handsfree") return current;
        if (current.state === "PROCESSING" || current.state === "SPEAKING") {
          return current;
        }
        var command = String(event.command || "").trim();
        if (command) {
          return {
            state: "PROCESSING",
            mode: current.mode,
            pendingCommand: command,
            lastError: null,
          };
        }
        return {
          state: "LISTENING",
          mode: current.mode,
          pendingCommand: null,
          lastError: null,
        };
      }
      case "COMMAND_CAPTURED": {
        var text = String(event.text || "").trim();
        if (!text) return current;
        if (
          current.mode === "handsfree" &&
          current.state !== "LISTENING" &&
          current.state !== "IDLE" &&
          current.state !== "ERROR"
        ) {
          return current;
        }
        return {
          state: "PROCESSING",
          mode: current.mode,
          pendingCommand: text,
          lastError: null,
        };
      }
      case "SPEAK_STARTED":
      case "RESPONSE_READY":
        if (current.state !== "PROCESSING" && current.state !== "SPEAKING") {
          return current;
        }
        return {
          state: "SPEAKING",
          mode: current.mode,
          pendingCommand: current.pendingCommand,
          lastError: null,
        };
      case "SPEAK_ENDED":
        return {
          state: "IDLE",
          mode: current.mode,
          pendingCommand: null,
          lastError: null,
        };
      case "ERROR":
        return {
          state: "ERROR",
          mode: current.mode,
          pendingCommand: null,
          lastError: event.message || "Voice error",
        };
      case "RECOVER":
        return {
          state: "IDLE",
          mode: current.mode,
          pendingCommand: null,
          lastError: null,
        };
      default:
        return current;
    }
  }

  function statusLabelForState(state, mode) {
    if (state === "IDLE") {
      return mode === "handsfree" ? "Say Hey Pathu" : "Ready — hold to talk";
    }
    if (state === "LISTENING") return "Pathu is listening…";
    if (state === "PROCESSING") return "Thinking…";
    if (state === "SPEAKING") return "Pathu is speaking…";
    if (state === "ERROR") return "Voice unavailable — tap to retry";
    return "Ready.";
  }

  /**
   * Transcript-based wake detector (interim engine).
   * Chromium may send mic audio to the browser vendor for STT — not to Pathu LLMs.
   */
  function createTranscriptWakeDetector(options) {
    var phrases = options.phrases || DEFAULT_WAKE_PHRASES;
    var createRecognition = options.createRecognition;
    var isArmed = options.isArmed || function () { return true; };
    var callback = null;
    var recognition = null;
    var running = false;
    var restarting = false;
    var lastFiredAt = 0;

    function processTranscript(transcript) {
      if (!running || !isArmed()) return;
      var extracted = extractCommandAfterWake(transcript, phrases);
      if (!extracted.woke || !extracted.phrase) return;
      var now = Date.now();
      if (now - lastFiredAt < 1500) return;
      lastFiredAt = now;
      if (callback) {
        callback({
          phrase: extracted.phrase,
          command: extracted.command,
          rawTranscript: transcript,
        });
      }
    }

    function ensureRecognition() {
      if (recognition) return;
      recognition = createRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = function (event) {
        var chunk = "";
        for (var i = event.resultIndex; i < event.results.length; i += 1) {
          chunk += event.results[i][0].transcript;
        }
        processTranscript(chunk);
      };
      recognition.onerror = function () {};
      recognition.onend = function () {
        if (!running || restarting) return;
        restarting = true;
        setTimeout(function () {
          restarting = false;
          if (!running) return;
          try {
            recognition.start();
          } catch (_) {}
        }, 250);
      };
    }

    return {
      kind: "transcript-webspeech",
      privacyNote:
        "Wake matching uses browser SpeechRecognition. Chromium may send mic audio to the browser vendor for STT. Not sent to Pathu LLM providers. Local Porcupine custom model is the future path.",
      onWake: function (cb) {
        callback = cb;
      },
      start: function () {
        if (running) return;
        running = true;
        ensureRecognition();
        try {
          recognition.start();
        } catch (_) {}
      },
      stop: function () {
        running = false;
        try {
          if (recognition) recognition.stop();
        } catch (_) {}
      },
      destroy: function () {
        this.stop();
        recognition = null;
        callback = null;
      },
    };
  }

  global.PathuVoiceCore = {
    DEFAULT_WAKE_PHRASES: DEFAULT_WAKE_PHRASES,
    normalizeSpeech: normalizeSpeech,
    extractCommandAfterWake: extractCommandAfterWake,
    createVoiceMachineState: createVoiceMachineState,
    reduceVoiceState: reduceVoiceState,
    shouldRunWakeDetector: shouldRunWakeDetector,
    statusLabelForState: statusLabelForState,
    createTranscriptWakeDetector: createTranscriptWakeDetector,
  };
})(typeof window !== "undefined" ? window : globalThis);
