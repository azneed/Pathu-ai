import { describe, expect, it, vi } from "vitest";
import {
  extractCommandAfterWake,
  findWakeMatch,
  matchesWakePhrase,
  normalizeSpeech,
} from "../src/voice/phrases.js";
import {
  canAcceptCommand,
  createVoiceMachineState,
  reduceVoiceState,
  shouldRunWakeDetector,
  statusLabelForState,
} from "../src/voice/stateMachine.js";
import {
  createWakeWordDetector,
  PorcupineWakeWordDetector,
  TranscriptWakeWordDetector,
  type SpeechRecognitionLike,
} from "../src/voice/wakeWord.js";

describe("wake phrases", () => {
  it("normalizes speech", () => {
    expect(normalizeSpeech("  Hey, PATHU!! ")).toBe("hey pathu");
  });

  it("matches hey pathu and pathu", () => {
    expect(matchesWakePhrase("Hey Pathu")).toBe(true);
    expect(matchesWakePhrase("pathu")).toBe(true);
    expect(matchesWakePhrase("hey pathfinder")).toBe(false);
  });

  it("does not match legacy Andru wake phrases by default", () => {
    expect(matchesWakePhrase("Hey Andru")).toBe(false);
    expect(matchesWakePhrase("andru")).toBe(false);
    expect(matchesWakePhrase("Andru, turn the lights off.")).toBe(false);
  });

  it("extracts command from single utterance", () => {
    const result = extractCommandAfterWake(
      "Hey Pathu, turn the AC to 23.",
    );
    expect(result.woke).toBe(true);
    expect(result.phrase).toBe("hey pathu");
    expect(result.command).toMatch(/turn the ac to 23/i);
  });

  it("wake only yields empty command", () => {
    const result = extractCommandAfterWake("Hey Pathu");
    expect(result.woke).toBe(true);
    expect(result.command).toBe("");
  });

  it("prefers longer phrase hey pathu over pathu", () => {
    const match = findWakeMatch("hey pathu turn lights off");
    expect(match?.phrase).toBe("hey pathu");
  });
});

describe("voice state machine", () => {
  it("IDLE → LISTENING on wake without command", () => {
    let s = createVoiceMachineState("handsfree");
    s = reduceVoiceState(s, { type: "WAKE" });
    expect(s.state).toBe("LISTENING");
    expect(shouldRunWakeDetector(s)).toBe(false);
    expect(statusLabelForState(s.state, s.mode)).toMatch(/Pathu is listening/i);
  });

  it("IDLE → PROCESSING on wake with command", () => {
    let s = createVoiceMachineState("handsfree");
    s = reduceVoiceState(s, {
      type: "WAKE",
      command: "turn the AC to 23",
    });
    expect(s.state).toBe("PROCESSING");
    expect(s.pendingCommand).toBe("turn the AC to 23");
  });

  it("LISTENING → PROCESSING on command capture", () => {
    let s = createVoiceMachineState("handsfree");
    s = reduceVoiceState(s, { type: "WAKE" });
    s = reduceVoiceState(s, {
      type: "COMMAND_CAPTURED",
      text: "Turn the lights off.",
    });
    expect(s.state).toBe("PROCESSING");
  });

  it("PROCESSING → SPEAKING → IDLE", () => {
    let s = createVoiceMachineState("handsfree");
    s = reduceVoiceState(s, { type: "WAKE", command: "hi" });
    s = reduceVoiceState(s, { type: "SPEAK_STARTED" });
    expect(s.state).toBe("SPEAKING");
    expect(statusLabelForState(s.state, s.mode)).toMatch(/Pathu is speaking/i);
    s = reduceVoiceState(s, { type: "SPEAK_ENDED" });
    expect(s.state).toBe("IDLE");
    expect(shouldRunWakeDetector(s)).toBe(true);
    expect(statusLabelForState(s.state, s.mode)).toMatch(/Say Hey Pathu/i);
  });

  it("ignores wake while PROCESSING or SPEAKING", () => {
    let s = createVoiceMachineState("handsfree");
    s = reduceVoiceState(s, { type: "WAKE", command: "one" });
    const during = reduceVoiceState(s, {
      type: "WAKE",
      command: "two",
    });
    expect(during.state).toBe("PROCESSING");
    expect(during.pendingCommand).toBe("one");

    s = reduceVoiceState(s, { type: "SPEAK_STARTED" });
    const duringSpeak = reduceVoiceState(s, {
      type: "WAKE",
      command: "three",
    });
    expect(duringSpeak.state).toBe("SPEAKING");
  });

  it("ERROR recovers to IDLE", () => {
    let s = createVoiceMachineState("handsfree");
    s = reduceVoiceState(s, { type: "ERROR", message: "mic denied" });
    expect(s.state).toBe("ERROR");
    expect(statusLabelForState(s.state, s.mode)).toMatch(/unavailable/i);
    s = reduceVoiceState(s, { type: "RECOVER" });
    expect(s.state).toBe("IDLE");
  });

  it("push-to-talk mode does not arm wake detector", () => {
    const s = createVoiceMachineState("pushtotalk");
    expect(shouldRunWakeDetector(s)).toBe(false);
    expect(canAcceptCommand(s)).toBe(true);
  });
});

describe("wake word detector abstraction", () => {
  it("transcript detector starts/stops and fires onWake", async () => {
    let started = false;
    const recognition: SpeechRecognitionLike = {
      continuous: false,
      interimResults: false,
      lang: "",
      onresult: null,
      onerror: null,
      onend: null,
      start() {
        started = true;
      },
      stop() {
        started = false;
      },
    };

    const detector = new TranscriptWakeWordDetector({
      createRecognition: () => recognition,
      isArmed: () => true,
    });

    const wakes: Array<{ phrase: string; command: string }> = [];
    detector.onWake((e) => wakes.push({ phrase: e.phrase, command: e.command }));

    await detector.start();
    expect(started).toBe(true);

    detector.handleTranscriptForTests("Hey Pathu turn the AC to 23", true);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.phrase).toBe("hey pathu");
    expect(wakes[0]?.command).toMatch(/turn the ac to 23/i);

    detector.stop();
    expect(started).toBe(false);
    detector.destroy();
  });

  it("does not fire when disarmed (processing/speaking)", async () => {
    const recognition: SpeechRecognitionLike = {
      continuous: false,
      interimResults: false,
      lang: "",
      onresult: null,
      onerror: null,
      onend: null,
      start() {},
      stop() {},
    };
    let armed = false;
    const detector = new TranscriptWakeWordDetector({
      createRecognition: () => recognition,
      isArmed: () => armed,
    });
    const spy = vi.fn();
    detector.onWake(spy);
    await detector.start();
    detector.handleTranscriptForTests("Hey Pathu", true);
    expect(spy).not.toHaveBeenCalled();
    armed = true;
    detector.handleTranscriptForTests("Hey Pathu lights off", true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("Porcupine stub refuses to start without configuration", async () => {
    const porcupine = new PorcupineWakeWordDetector();
    await expect(porcupine.start()).rejects.toThrow(/not configured/i);
    expect(porcupine.privacyNote).toMatch(/local/i);
  });

  it("factory creates transcript detector", () => {
    const d = createWakeWordDetector({
      engine: "transcript",
      createRecognition: () => ({
        continuous: false,
        interimResults: false,
        lang: "",
        onresult: null,
        onerror: null,
        onend: null,
        start() {},
        stop() {},
      }),
    });
    expect(d.kind).toBe("transcript-webspeech");
  });
});
