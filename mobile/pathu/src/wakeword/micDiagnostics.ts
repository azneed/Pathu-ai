/**
 * DEV-only microphone capture analysis. Produces summary statistics only —
 * never logs or transmits raw samples.
 */

export type MicDiagnosticResult = {
  durationMs: number;
  chunks: number;
  chunkBytesMin: number;
  chunkBytesMax: number;
  oddByteChunks: number;
  samples: number;
  expectedSamples: number;
  sampleRate: number;
  channels: number;
  format: string;
  rms: number;
  peak: number;
  min: number;
  max: number;
  dcMean: number;
  zeroCrossingRate: number;
  nearZeroPct: number;
  clippedPct: number;
  frameRmsMin: number;
  frameRmsMedian: number;
  frameRmsP90: number;
  frameRmsMax: number;
  speechToSilenceRatio: number;
  loudFrames: number;
  chunkIntervalMsMin: number;
  chunkIntervalMsMedian: number;
  chunkIntervalMsMax: number;
  repeatedChunks: number;
  kwsOffline: { detected: boolean; keyword: string; frames: number } | null;
  wavPath: string | null;
};

const SAMPLE_RATE = 16_000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/** Decode base64 LE int16 chunks exactly as SherpaWakeWord does. */
export function decodeChunks(chunks: string[]): {
  int16: Int16Array;
  chunkBytes: number[];
  oddByteChunks: number;
  repeatedChunks: number;
} {
  const binaries = chunks.map((c) => globalThis.atob(c));
  const chunkBytes = binaries.map((b) => b.length);
  const oddByteChunks = chunkBytes.filter((n) => n % 2 !== 0).length;
  let repeatedChunks = 0;
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i] === chunks[i - 1]) repeatedChunks += 1;
  }
  const total = binaries.reduce((acc, b) => acc + Math.floor(b.length / 2), 0);
  const int16 = new Int16Array(total);
  let k = 0;
  for (const bin of binaries) {
    const n = Math.floor(bin.length / 2);
    for (let i = 0; i < n; i++) {
      let s = (bin.charCodeAt(i * 2 + 1) << 8) | bin.charCodeAt(i * 2);
      if (s & 0x8000) s -= 0x10000;
      int16[k++] = s;
    }
  }
  return { int16, chunkBytes, oddByteChunks, repeatedChunks };
}

export function analyzeMicCapture(args: {
  chunks: string[];
  arrivals: number[];
  durationMs: number;
  sampleRate?: number;
  channels?: number;
}): { result: MicDiagnosticResult; int16: Int16Array } {
  const { int16, chunkBytes, oddByteChunks, repeatedChunks } = decodeChunks(args.chunks);
  const sampleRate = args.sampleRate ?? SAMPLE_RATE;
  const channels = args.channels ?? 1;
  const FRAME = (sampleRate / 10) * channels;
  const n = int16.length;
  let sumSq = 0;
  let sum = 0;
  let peak = 0;
  let min = 0;
  let max = 0;
  let zc = 0;
  let near = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const v = int16[i] / 32768;
    sum += v;
    sumSq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (v < min) min = v;
    if (v > max) max = v;
    if (a < 0.002) near += 1;
    if (a > 0.98) clipped += 1;
    if (i > 0 && (int16[i - 1] >= 0) !== (int16[i] >= 0)) zc += 1;
  }
  const frameRms: number[] = [];
  for (let f = 0; f + FRAME <= n; f += FRAME) {
    let s2 = 0;
    for (let i = f; i < f + FRAME; i++) {
      const v = int16[i] / 32768;
      s2 += v * v;
    }
    frameRms.push(Math.sqrt(s2 / FRAME));
  }
  const sortedRms = [...frameRms].sort((a, b) => a - b);
  const median = percentile(sortedRms, 0.5);
  const intervals: number[] = [];
  for (let i = 1; i < args.arrivals.length; i++) {
    intervals.push(args.arrivals[i] - args.arrivals[i - 1]);
  }
  const sortedIv = intervals.sort((a, b) => a - b);
  const round = (x: number, d = 4) => Number(x.toFixed(d));

  const result: MicDiagnosticResult = {
    durationMs: args.durationMs,
    chunks: args.chunks.length,
    chunkBytesMin: chunkBytes.length ? Math.min(...chunkBytes) : 0,
    chunkBytesMax: chunkBytes.length ? Math.max(...chunkBytes) : 0,
    oddByteChunks,
    samples: n,
    expectedSamples: Math.round((sampleRate * channels * args.durationMs) / 1000),
    sampleRate,
    channels,
    format: "PCM16LE -> float32 /32768",
    rms: round(n ? Math.sqrt(sumSq / n) : 0),
    peak: round(peak),
    min: round(min),
    max: round(max),
    dcMean: round(n ? sum / n : 0, 5),
    zeroCrossingRate: round(n > 1 ? zc / (n - 1) : 0),
    nearZeroPct: round(n ? (near / n) * 100 : 0, 2),
    clippedPct: round(n ? (clipped / n) * 100 : 0, 3),
    frameRmsMin: round(sortedRms[0] ?? 0),
    frameRmsMedian: round(median),
    frameRmsP90: round(percentile(sortedRms, 0.9)),
    frameRmsMax: round(sortedRms[sortedRms.length - 1] ?? 0),
    speechToSilenceRatio: round(median > 0 ? (sortedRms[sortedRms.length - 1] ?? 0) / median : 0, 2),
    loudFrames: frameRms.filter((r) => r > Math.max(0.02, median * 3)).length,
    chunkIntervalMsMin: sortedIv[0] ?? 0,
    chunkIntervalMsMedian: percentile(sortedIv, 0.5),
    chunkIntervalMsMax: sortedIv[sortedIv.length - 1] ?? 0,
    repeatedChunks,
    kwsOffline: null,
    wavPath: null,
  };
  return { result, int16 };
}

/** Canonical 44-byte header + interleaved PCM16LE data, base64 (for local-only DEV file). */
export function buildWavBase64(int16: Int16Array, sampleRate = SAMPLE_RATE, channels = 1): string {
  const dataBytes = int16.length * 2;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[off + i] = s.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2 * channels, true);
  view.setUint16(32, 2 * channels, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  const bytes = new Uint8Array(44 + dataBytes);
  bytes.set(header, 0);
  bytes.set(new Uint8Array(int16.buffer, int16.byteOffset, dataBytes), 44);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return globalThis.btoa(binary);
}
