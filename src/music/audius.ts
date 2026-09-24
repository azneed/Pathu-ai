import type { AudiusTrackResult } from "./session.js";
import { audiusTrackIdSchema } from "./clientActions.js";

const AUDIUS_BASE = "https://api.audius.co/v1";

export interface AudiusClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  appName?: string;
}

function requireKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) {
    throw new Error(
      "Audius music is not configured. Set AUDIUS_API_KEY on the server.",
    );
  }
  return key;
}

function headers(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    "x-api-key": apiKey,
  };
}

/**
 * Search Audius tracks. API key stays server-side.
 */
export async function searchAudiusTracks(options: {
  apiKey: string;
  query: string;
  maxResults: number;
  fetchImpl?: typeof fetch;
}): Promise<AudiusTrackResult[]> {
  const apiKey = requireKey(options.apiKey);
  const query = options.query.trim();
  if (!query) throw new Error("query is required");

  const limit = Math.min(5, Math.max(1, Math.floor(options.maxResults)));
  const params = new URLSearchParams({
    query,
    limit: String(limit),
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${AUDIUS_BASE}/tracks/search?${params.toString()}`,
    { headers: headers(apiKey) },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Audius search failed (${response.status}): ${body.slice(0, 200) || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    data?: Array<{
      id?: string;
      title?: string;
      user?: { name?: string; handle?: string };
      duration?: number;
      artwork?: { ["150x150"]?: string; ["480x480"]?: string };
      is_streamable?: boolean;
    }>;
  };

  const results: AudiusTrackResult[] = [];
  for (const item of data.data ?? []) {
    const id = item.id?.trim();
    if (!id || !audiusTrackIdSchema.safeParse(id).success) continue;
    results.push({
      trackId: id,
      title: item.title ?? "(untitled)",
      artist: item.user?.name || item.user?.handle || "Unknown artist",
      duration: typeof item.duration === "number" ? item.duration : undefined,
      artworkUrl:
        item.artwork?.["480x480"] || item.artwork?.["150x150"] || undefined,
      playable: item.is_streamable !== false,
    });
  }
  return results;
}

/**
 * Resolve a track id to a temporary CDN stream URL (server-side only).
 * Uses no_redirect so we can 302 the browser without exposing the API key.
 */
export async function resolveAudiusStreamUrl(options: {
  apiKey: string;
  trackId: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const apiKey = requireKey(options.apiKey);
  const trackId = audiusTrackIdSchema.parse(options.trackId);
  const fetchImpl = options.fetchImpl ?? fetch;

  const params = new URLSearchParams({ no_redirect: "true" });
  const response = await fetchImpl(
    `${AUDIUS_BASE}/tracks/${encodeURIComponent(trackId)}/stream?${params}`,
    { headers: headers(apiKey), redirect: "manual" },
  );

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location && /^https:\/\//i.test(location)) {
      return location;
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Audius stream resolve failed (${response.status}): ${body.slice(0, 200) || response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = (await response.json()) as {
      data?: string | { url?: string; stream_url?: string };
    };
    const raw =
      typeof json.data === "string"
        ? json.data
        : json.data?.url || json.data?.stream_url;
    if (raw && /^https:\/\//i.test(raw)) {
      return raw;
    }
  }

  throw new Error("Audius did not return a usable HTTPS stream URL");
}

export function musicStreamPathFor(trackId: string): string {
  const id = audiusTrackIdSchema.parse(trackId);
  return `/music/stream/${id}`;
}
