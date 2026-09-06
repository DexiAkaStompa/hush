import { config, lavalinkBaseUrl } from "./config.mjs";

function headers() {
  return {
    Accept: "application/json",
    Authorization: config.lavalink.password,
  };
}

async function request(identifier) {
  const url = `${lavalinkBaseUrl()}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`;
  const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Lavalink REST ${response.status}`);
  const payload = await response.json();
  if (payload.loadType === "loadfailed" || payload.loadType === "error") {
    throw new Error(payload.data?.message || "Lavalink non ha risolto la sorgente.");
  }
  return payload;
}

export async function searchYouTubeDirect(query) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const m = html.match(/var ytInitialData = ({.*?});<\/script>/s) || html.match(/ytInitialData = ({.*?});<\/script>/s);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const tracks = [];
    for (const section of contents) {
      const renderers = section.itemSectionRenderer?.contents || [];
      for (const r of renderers) {
        if (r.videoRenderer) {
          const v = r.videoRenderer;
          const lengthStr = v.lengthText?.simpleText || "";
          let lengthMs = 0;
          if (lengthStr) {
            const parts = lengthStr.split(":").map(Number);
            if (parts.length === 2) lengthMs = (parts[0] * 60 + parts[1]) * 1000;
            else if (parts.length === 3) lengthMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
          }
          tracks.push({
            encoded: null,
            title: String(v.title?.runs?.[0]?.text || "Senza titolo").slice(0, 200),
            author: String(v.ownerText?.runs?.[0]?.text || "").slice(0, 120),
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            artworkUrl: v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url || null,
            length: lengthMs,
            sourceName: "youtube",
          });
        }
      }
    }
    return tracks.slice(0, 10);
  } catch {
    return [];
  }
}

export async function searchTracks(query, source = "youtube") {
  const cleanQuery = query.trim().slice(0, 200);
  try {
    const prefix = source === "spotify" ? "spsearch:" : "ytsearch:";
    const payload = await request(`${prefix}${cleanQuery}`);
    const tracks = Array.isArray(payload.data) ? payload.data : [];
    if (tracks.length > 0) {
      return tracks.slice(0, 10).map((track) => ({
        encoded: typeof track.encoded === "string" ? track.encoded : null,
        title: String(track.info?.title || "Senza titolo").slice(0, 200),
        author: String(track.info?.author || "").slice(0, 120),
        url: typeof track.info?.uri === "string" ? track.info.uri : null,
        artworkUrl: typeof track.info?.artworkUrl === "string" ? track.info.artworkUrl : null,
        length: Number.isFinite(track.info?.length) ? track.info.length : 0,
        sourceName: typeof track.info?.sourceName === "string" ? track.info.sourceName : null,
      })).filter((track) => track.url?.startsWith("https://"));
    }
  } catch {
    // Lavalink failed or timed out, fallback to direct search
  }
  const directQuery = source === "spotify" ? `${cleanQuery} audio` : cleanQuery;
  const directResults = await searchYouTubeDirect(directQuery);
  if (directResults.length > 0) return directResults;
  return [];
}

export async function resolveTrack(identifier) {
  const payload = await request(identifier);
  const track = payload.loadType === "track" ? payload.data : payload.data?.[0];
  if (!track?.encoded || !track.info?.uri) throw new Error("Traccia non disponibile.");
  return {
    encoded: track.encoded,
    title: String(track.info.title || "Senza titolo").slice(0, 200),
    author: String(track.info.author || "").slice(0, 120),
    url: track.info.uri,
    length: Number.isFinite(track.info.length) ? track.info.length : 0,
    sourceName: typeof track.info.sourceName === "string" ? track.info.sourceName : null,
  };
}

export async function resolvePlaybackSource(identifier) {
  const track = await resolveTrack(identifier);
  const sourceName = String(track.sourceName || "").toLowerCase();
  const host = (() => {
    try { return new URL(track.url).hostname.toLowerCase(); } catch { return ""; }
  })();
  if (sourceName === "spotify" || host === "open.spotify.com" || host.endsWith(".spotify.com")) {
    const matches = await searchTracks(`${track.title} ${track.author}`, "youtube");
    if (!matches[0]?.url) throw new Error("Spotify non ha una sorgente YouTube corrispondente.");
    return { ...track, url: matches[0].url, sourceName: "youtube" };
  }
  return track;
}
