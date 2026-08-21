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

export async function searchTracks(query, source = "youtube") {
  const prefix = source === "spotify" ? "spsearch:" : "ytsearch:";
  const payload = await request(`${prefix}${query.trim().slice(0, 200)}`);
  const tracks = Array.isArray(payload.data) ? payload.data : [];
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
