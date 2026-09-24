import type { YoutubeSearchResult } from "./session.js";

export interface YoutubeSearchOptions {
  apiKey: string;
  query: string;
  maxResults: number;
  fetchImpl?: typeof fetch;
}

/**
 * YouTube Data API v3 search.list — videos only.
 * Key stays server-side; never expose to the browser.
 */
export async function searchYoutubeVideos(
  options: YoutubeSearchOptions,
): Promise<YoutubeSearchResult[]> {
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error(
      "YouTube search is not configured. Set YOUTUBE_API_KEY on the server.",
    );
  }

  const query = options.query.trim();
  if (!query) {
    throw new Error("query is required");
  }

  const maxResults = Math.min(5, Math.max(1, Math.floor(options.maxResults)));
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: query,
    maxResults: String(maxResults),
    key,
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `YouTube search failed (${response.status}): ${body.slice(0, 200) || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        publishedAt?: string;
      };
    }>;
  };

  const results: YoutubeSearchResult[] = [];
  for (const item of data.items ?? []) {
    const videoId = item.id?.videoId;
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) continue;
    results.push({
      videoId,
      title: item.snippet?.title ?? "(untitled)",
      channelTitle: item.snippet?.channelTitle ?? "",
      publishedAt: item.snippet?.publishedAt,
    });
  }

  return results;
}
