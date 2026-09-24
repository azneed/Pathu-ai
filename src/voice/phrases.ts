/** Shared wake-phrase matching and command extraction (no browser APIs). */

export const DEFAULT_WAKE_PHRASES = ["hey andru", "andru"] as const;

export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find the earliest wake phrase match in normalized speech.
 * Prefers longer phrases first ("hey andru" before "andru").
 */
export function findWakeMatch(
  transcript: string,
  phrases: readonly string[] = DEFAULT_WAKE_PHRASES,
): { phrase: string; index: number; endIndex: number } | null {
  const normalized = normalizeSpeech(transcript);
  if (!normalized) return null;

  const sorted = [...phrases]
    .map((p) => normalizeSpeech(p))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let best: { phrase: string; index: number; endIndex: number } | null = null;

  for (const phrase of sorted) {
    // Word-boundary-ish: phrase as whole words inside the transcript
    const re = new RegExp(`(?:^|\\s)${escapeRegExp(phrase)}(?=\\s|$)`, "i");
    const match = re.exec(normalized);
    if (!match) continue;
    const index = match.index + (match[0].startsWith(" ") ? 1 : 0);
    const endIndex = index + phrase.length;
    if (!best || index < best.index || (index === best.index && phrase.length > best.phrase.length)) {
      best = { phrase, index, endIndex };
    }
  }
  return best;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split "Hey Andru, turn the AC to 23" into wake + command.
 * Returns command="" when only the wake phrase was spoken.
 */
export function extractCommandAfterWake(
  transcript: string,
  phrases: readonly string[] = DEFAULT_WAKE_PHRASES,
): { woke: boolean; phrase: string | null; command: string } {
  const match = findWakeMatch(transcript, phrases);
  if (!match) {
    return { woke: false, phrase: null, command: "" };
  }
  const normalized = normalizeSpeech(transcript);
  const after = normalized.slice(match.endIndex).trim();
  // Strip leading fillers like "please" is left to the LLM; just trim punctuation leftovers
  const command = after.replace(/^(please|can you|could you)\s+/i, "").trim();
  return {
    woke: true,
    phrase: match.phrase,
    command,
  };
}

export function matchesWakePhrase(
  transcript: string,
  phrases: readonly string[] = DEFAULT_WAKE_PHRASES,
): boolean {
  return findWakeMatch(transcript, phrases) !== null;
}
