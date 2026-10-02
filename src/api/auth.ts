import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * Routes that stay reachable without a token:
 * - /health for the hosting platform's health check
 * - /voice + /voice-core.js are the static browser shell (no data)
 * - /music/stream/:id only redirects to Audius' public CDN; the native player forwards request
 *   headers across that redirect, so requiring the token here would leak it to the CDN.
 */
function isPublicRoute(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return (
    path === "/health" ||
    path === "/voice" ||
    path === "/voice-core.js" ||
    /^\/music\/stream\/[^/]+$/.test(path)
  );
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Requires `Authorization: Bearer <secret>` on every non-public route. Empty secret = disabled. */
export function apiAuth(secret: string): MiddlewareHandler {
  const expected = secret ? digest(secret) : null;
  return async (c, next) => {
    if (!expected || isPublicRoute(c.req.method, c.req.path)) {
      await next();
      return;
    }
    const match = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
    const provided = match ? digest(match[1]!.trim()) : null;
    if (!provided || !timingSafeEqual(provided, expected)) {
      return c.json({ error: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }
    await next();
  };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
  );
}

/** Refuse to serve an unauthenticated API on a non-loopback interface (e.g. HOST=0.0.0.0 in the cloud). */
export function assertAuthForHost(host: string, secret: string): void {
  if (!secret && !isLoopbackHost(host)) {
    throw new Error(
      `PATHU_API_SECRET is required when HOST is not loopback (HOST=${host}). Set it before exposing Pathu.`,
    );
  }
}
