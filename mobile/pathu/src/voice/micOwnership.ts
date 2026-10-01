export type MicOwner = "NONE" | "KWS" | "STT" | "DIAG";

type Listener = (owner: MicOwner) => void;

type MicOwnershipState = {
  owner: MicOwner;
  conflicts: number;
  listeners: Set<Listener>;
};

const state: MicOwnershipState = (() => {
  const g = globalThis as typeof globalThis & { __pathuMicOwnership?: MicOwnershipState };
  if (!g.__pathuMicOwnership) {
    g.__pathuMicOwnership = { owner: "NONE", conflicts: 0, listeners: new Set() };
  }
  return g.__pathuMicOwnership;
})();

function log(message: string): void {
  if (__DEV__) console.log(`[PathuMic] ${message}`);
}

function notify(): void {
  for (const listener of state.listeners) listener(state.owner);
}

/** Single authoritative record of which engine holds the microphone. */
export const micOwnership = {
  get owner(): MicOwner {
    return state.owner;
  },
  get conflicts(): number {
    return state.conflicts;
  },
  acquire(next: Exclude<MicOwner, "NONE">, reason: string): void {
    if (state.owner === next) return;
    if (state.owner !== "NONE") {
      state.conflicts += 1;
      log(`CONFLICT ${state.owner} still owns mic while ${next} acquires (${reason})`);
    }
    log(`${state.owner} -> ${next} (${reason})`);
    state.owner = next;
    notify();
  },
  release(who: Exclude<MicOwner, "NONE">, reason: string): void {
    if (state.owner !== who) return;
    log(`${who} -> NONE (${reason})`);
    state.owner = "NONE";
    notify();
  },
  subscribe(listener: Listener): () => void {
    state.listeners.add(listener);
    listener(state.owner);
    return () => {
      state.listeners.delete(listener);
    };
  },
};
