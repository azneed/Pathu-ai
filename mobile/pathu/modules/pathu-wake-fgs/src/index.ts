import { requireNativeModule, type EventSubscription } from "expo-modules-core";
import { PermissionsAndroid, Platform } from "react-native";

export type WakeFgsStateName =
  | "stopped"
  | "starting"
  | "listening"
  | "stopping"
  | "error";

export type WakeFgsSnapshot = {
  state: WakeFgsStateName | string;
  active: boolean;
  lastScreenEvent: string;
  lastError: string | null;
  oemHint: string;
  sdkInt: number;
};

type PathuWakeFgsNativeModule = {
  getState(): Promise<WakeFgsSnapshot>;
  isSupported(): Promise<boolean>;
  hasRequiredPermissions(): Promise<boolean>;
  start(): Promise<WakeFgsSnapshot>;
  stop(): Promise<WakeFgsSnapshot>;
  addListener(
    eventName: "onWakeFgsState",
    listener: (event: WakeFgsSnapshot) => void,
  ): EventSubscription;
};

const FALLBACK: WakeFgsSnapshot = {
  state: "stopped",
  active: false,
  lastScreenEvent: "unknown",
  lastError: null,
  oemHint: "unsupported",
  sdkInt: 0,
};

function getNative(): PathuWakeFgsNativeModule | null {
  if (Platform.OS !== "android") return null;
  try {
    return requireNativeModule("PathuWakeFgs") as PathuWakeFgsNativeModule;
  } catch {
    return null;
  }
}

/**
 * JS bridge for Pathu microphone foreground service (Phase 7B.1).
 * Keeps the process eligible for mic capture while locked — does not own KWS.
 */
class WakeForegroundServiceController {
  private listeners = new Set<(s: WakeFgsSnapshot) => void>();
  private snapshot: WakeFgsSnapshot = FALLBACK;
  private sub: EventSubscription | null = null;

  getStatus(): WakeFgsSnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: (s: WakeFgsSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    this.ensureNativeSubscription();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureNativeSubscription(): void {
    if (this.sub) return;
    const native = getNative();
    if (!native?.addListener) return;
    this.sub = native.addListener("onWakeFgsState", (event) => {
      this.snapshot = normalize(event);
      this.emit();
    });
  }

  private emit(): void {
    const snap = this.getStatus();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  private diag(message: string): void {
    if (__DEV__) {
      console.log(`[PathuWakeFgs] ${message}`);
    }
  }

  async refresh(): Promise<WakeFgsSnapshot> {
    const native = getNative();
    if (!native) {
      this.snapshot = FALLBACK;
      this.emit();
      return this.getStatus();
    }
    this.snapshot = normalize(await native.getState());
    this.emit();
    return this.getStatus();
  }

  async isSupported(): Promise<boolean> {
    const native = getNative();
    if (!native) return false;
    return native.isSupported();
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    const wanted: string[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    // API 33+
    const postNotifications = "android.permission.POST_NOTIFICATIONS";
    if (Platform.Version >= 33) {
      wanted.push(postNotifications);
    }
    const results = await PermissionsAndroid.requestMultiple(
      wanted as (typeof PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)[],
    );
    const mic =
      results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
      PermissionsAndroid.RESULTS.GRANTED;
    const notif =
      Platform.Version < 33 ||
      results[postNotifications as keyof typeof results] ===
        PermissionsAndroid.RESULTS.GRANTED;
    this.diag(`permissions mic=${mic} notif=${notif}`);
    return mic && notif;
  }

  async start(): Promise<WakeFgsSnapshot> {
    const native = getNative();
    if (!native) {
      this.diag("native module unavailable");
      return this.getStatus();
    }
    const ok = await this.requestPermissions();
    if (!ok) {
      this.snapshot = {
        ...this.snapshot,
        state: "error",
        active: false,
        lastError: "Wake FGS permissions denied",
      };
      this.emit();
      throw new Error("Wake FGS permissions denied");
    }
    this.diag("start");
    this.snapshot = normalize(await native.start());
    this.emit();
    setTimeout(() => {
      void this.refresh();
    }, 400);
    return this.getStatus();
  }

  async stop(): Promise<WakeFgsSnapshot> {
    const native = getNative();
    if (!native) return this.getStatus();
    this.diag("stop");
    this.snapshot = normalize(await native.stop());
    this.emit();
    setTimeout(() => {
      void this.refresh();
    }, 300);
    return this.getStatus();
  }

  async isActive(): Promise<boolean> {
    const snap = await this.refresh();
    return snap.active;
  }
}

function normalize(
  raw: Partial<WakeFgsSnapshot> | null | undefined,
): WakeFgsSnapshot {
  return {
    state: raw?.state ?? "stopped",
    active: Boolean(raw?.active),
    lastScreenEvent: raw?.lastScreenEvent ?? "unknown",
    lastError: raw?.lastError ?? null,
    oemHint: raw?.oemHint ?? "unknown",
    sdkInt: raw?.sdkInt ?? 0,
  };
}

export const wakeForegroundService = new WakeForegroundServiceController();
