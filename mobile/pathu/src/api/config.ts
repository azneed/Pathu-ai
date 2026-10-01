/**
 * Mobile API base URL for the Pathu backend.
 * USB Android: adb reverse tcp:3001 → http://127.0.0.1:3001
 */
export function getApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return "http://127.0.0.1:3001";
}
