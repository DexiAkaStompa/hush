use reqwest::{Client, Response, Url};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const YOUTUBE_SEARCH: &str = "https://www.youtube.com/results";
const LAVALINK_SEARCH: &str = "https://lavalink.jirayu.net/v4/loadtracks";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicTrack {
    title: String,
    author: String,
    url: String,
    artwork_url: Option<String>,
    length: u64,
}

/// Keep desktop search independent of browser CORS and retain the existing
/// YouTube-first, Lavalink-fallback behavior. The client must disable redirects
/// or restrict them to these two HTTPS hosts.
pub(crate) async fn search_music(
    client: &Client,
    query: &str,
    provider: &str,
) -> Result<Vec<MusicTrack>, String> {
    let query = validate_query(query, provider)?;
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }

    if let Ok(tracks) = search_youtube(client, query, provider).await {
        if !tracks.is_empty() {
            return Ok(tracks);
        }
    }

    // Search outages should not break the music UI. Its HTTP bridge remains
    // available as the next fallback when this returns an empty result list.
    Ok(search_lavalink(client, query, provider)
        .await
        .unwrap_or_default())
}

fn validate_query<'a>(query: &'a str, provider: &str) -> Result<&'a str, String> {
    if !matches!(provider, "youtube" | "spotify") {
        return Err("Provider musicale non valido.".into());
    }
    let query = query.trim();
    if query.chars().count() > 200 {
        return Err("La ricerca musicale può contenere al massimo 200 caratteri.".into());
    }
    Ok(query)
}

async fn bounded_body(mut response: Response) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err("Il servizio di ricerca musicale non è disponibile.".into());
    }
    if response.url().scheme() != "https"
        || !matches!(
            response.url().host_str(),
            Some("www.youtube.com" | "lavalink.jirayu.net")
        )
    {
        return Err("Destinazione della ricerca musicale non valida.".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("La risposta della ricerca musicale è troppo grande.".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Impossibile leggere i risultati musicali.".to_string())?
    {
        if chunk.len() > MAX_RESPONSE_BYTES - body.len() {
            return Err("La risposta della ricerca musicale è troppo grande.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn search_youtube(
    client: &Client,
    query: &str,
    provider: &str,
) -> Result<Vec<MusicTrack>, String> {
    let query = if provider == "spotify" {
        format!("{query} audio")
    } else {
        query.to_owned()
    };
    let response = client
        .get(YOUTUBE_SEARCH)
        .query(&[("search_query", query.as_str())])
        .timeout(Duration::from_secs(20))
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept-Language", "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
        .map_err(|_| "Ricerca YouTube non disponibile.".to_string())?;
    let body = bounded_body(response).await?;
    let html = String::from_utf8_lossy(&body);
    Ok(parse_youtube(&html))
}

async fn search_lavalink(
    client: &Client,
    query: &str,
    provider: &str,
) -> Result<Vec<MusicTrack>, String> {
    let prefix = if provider == "spotify" {
        "spsearch:"
    } else {
        "ytsearch:"
    };
    let identifier = format!("{prefix}{query}");
    let response = client
        .get(LAVALINK_SEARCH)
        .query(&[("identifier", identifier.as_str())])
        .timeout(Duration::from_secs(20))
        .header("Authorization", "youshallnotpass")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "Ricerca musicale alternativa non disponibile.".to_string())?;
    let body = bounded_body(response).await?;
    let payload: Value =
        serde_json::from_slice(&body).map_err(|_| "Risultati musicali non validi.".to_string())?;
    Ok(parse_lavalink(&payload))
}

fn initial_data(html: &str) -> Option<Value> {
    let mut remaining = html;
    while let Some(index) = remaining.find("ytInitialData") {
        remaining = &remaining[index + "ytInitialData".len()..];
        let suffix = remaining.trim_start();
        let suffix = suffix
            .strip_prefix("\"]")
            .or_else(|| suffix.strip_prefix("']"))
            .unwrap_or(suffix)
            .trim_start();
        let Some(json) = suffix.strip_prefix('=').map(str::trim_start) else {
            continue;
        };
        if !json.starts_with('{') {
            continue;
        }
        // A streaming deserializer consumes exactly one JSON value, so braces
        // inside strings and JavaScript following the assignment remain safe.
        if let Some(Ok(value)) = serde_json::Deserializer::from_str(json)
            .into_iter::<Value>()
            .next()
        {
            return Some(value);
        }
    }
    None
}

fn parse_youtube(html: &str) -> Vec<MusicTrack> {
    let Some(data) = initial_data(html) else {
        return Vec::new();
    };
    let Some(sections) = data
        .pointer(
            "/contents/twoColumnSearchResultsRenderer/primaryContents/sectionListRenderer/contents",
        )
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    sections
        .iter()
        .filter_map(|section| {
            section
                .pointer("/itemSectionRenderer/contents")
                .and_then(Value::as_array)
        })
        .flatten()
        .filter_map(|item| item.get("videoRenderer"))
        .filter_map(youtube_track)
        .take(10)
        .collect()
}

fn youtube_track(video: &Value) -> Option<MusicTrack> {
    let id = video.get("videoId")?.as_str()?;
    if id.len() != 11
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return None;
    }
    let title = text_value(video.get("title"));
    let author = text_value(video.get("ownerText"));
    let artwork_url = video
        .pointer("/thumbnail/thumbnails")
        .and_then(Value::as_array)
        .and_then(|images| images.last())
        .and_then(|image| image.get("url"))
        .and_then(Value::as_str)
        .and_then(https_url);
    Some(MusicTrack {
        title: limited(
            if title.is_empty() {
                "Senza titolo"
            } else {
                &title
            },
            200,
        ),
        author: limited(&author, 120),
        url: format!("https://www.youtube.com/watch?v={id}"),
        artwork_url,
        length: duration_ms(&text_value(video.get("lengthText"))),
    })
}

fn parse_lavalink(payload: &Value) -> Vec<MusicTrack> {
    let Some(data) = payload.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    data.iter()
        .take(8)
        .filter_map(|track| {
            let info = track.get("info")?;
            let url = info.get("uri")?.as_str().and_then(https_url)?;
            let title = info.get("title").and_then(Value::as_str).unwrap_or("");
            let author = info.get("author").and_then(Value::as_str).unwrap_or("");
            Some(MusicTrack {
                title: limited(
                    if title.is_empty() {
                        "Senza titolo"
                    } else {
                        title
                    },
                    200,
                ),
                author: limited(author, 120),
                url,
                artwork_url: info
                    .get("artworkUrl")
                    .and_then(Value::as_str)
                    .and_then(https_url),
                length: info.get("length").and_then(Value::as_u64).unwrap_or(0),
            })
        })
        .collect()
}

fn text_value(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    if let Some(text) = value.get("simpleText").and_then(Value::as_str) {
        return text.to_owned();
    }
    value
        .get("runs")
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .filter_map(|run| run.get("text").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default()
}

fn limited(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn https_url(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(value.to_owned())
}

fn duration_ms(text: &str) -> u64 {
    let parts: Vec<_> = text.split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return 0;
    }
    let mut seconds = 0u64;
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return 0;
        }
        let Ok(value) = part.parse::<u64>() else {
            return 0;
        };
        if index > 0 && value >= 60 {
            return 0;
        }
        let Some(next) = seconds.checked_mul(60).and_then(|n| n.checked_add(value)) else {
            return 0;
        };
        seconds = next;
    }
    seconds.checked_mul(1000).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn youtube_html(videos: Vec<Value>) -> String {
        let data = json!({"contents":{"twoColumnSearchResultsRenderer":{
            "primaryContents":{"sectionListRenderer":{"contents":[
                {"itemSectionRenderer":{"contents":videos}}
            ]}}
        }}});
        format!("<script>var ytInitialData = {data}; window.following = {{}};</script>")
    }

    fn video(title: &str) -> Value {
        json!({"videoRenderer":{
            "videoId":"abcDEF_12-3",
            "title":{"runs":[{"text":title}]},
            "ownerText":{"runs":[{"text":"Artista"}]},
            "thumbnail":{"thumbnails":[
                {"url":"https://i.ytimg.com/small.jpg"},
                {"url":"https://i.ytimg.com/large.jpg"}
            ]},
            "lengthText":{"simpleText":"1:02:03"}
        }})
    }

    #[test]
    fn parses_youtube_json_without_confusing_braces_or_following_scripts() {
        let tracks = parse_youtube(&youtube_html(vec![video("Braces } ; { and \"quotes\"")]));
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].title, "Braces } ; { and \"quotes\"");
        assert_eq!(tracks[0].author, "Artista");
        assert_eq!(tracks[0].url, "https://www.youtube.com/watch?v=abcDEF_12-3");
        assert_eq!(
            tracks[0].artwork_url.as_deref(),
            Some("https://i.ytimg.com/large.jpg")
        );
        assert_eq!(tracks[0].length, 3_723_000);
        let serialized = serde_json::to_value(&tracks[0]).expect("serializable track");
        assert_eq!(serialized["artworkUrl"], "https://i.ytimg.com/large.jpg");
        assert!(serialized.get("artwork_url").is_none());
    }

    #[test]
    fn accepts_window_assignments_and_skips_unrelated_mentions() {
        let html = youtube_html(vec![video("Titolo")]);
        let html = html.replace("var ytInitialData", "window[\"ytInitialData\"]");
        let html = format!("<p>ytInitialData is not an assignment</p>{html}");
        assert_eq!(parse_youtube(&html)[0].title, "Titolo");
        let single_quotes = html.replace("window[\"ytInitialData\"]", "window['ytInitialData']");
        assert_eq!(parse_youtube(&single_quotes).len(), 1);
    }

    #[test]
    fn limits_results_and_rejects_non_video_or_invalid_ids() {
        let mut videos = vec![
            json!({"adSlotRenderer":{}}),
            json!({"videoRenderer":{"videoId":"https://evil.invalid"}}),
        ];
        videos.extend((0..15).map(|index| video(&format!("Titolo {index}"))));
        let tracks = parse_youtube(&youtube_html(videos));
        assert_eq!(tracks.len(), 10);
        assert_eq!(tracks[9].title, "Titolo 9");
        assert!(parse_youtube("<script>ytInitialData = {broken</script>").is_empty());
        assert!(parse_youtube("<html>consent required</html>").is_empty());
    }

    #[test]
    fn handles_missing_fields_and_limits_unicode_without_splitting_characters() {
        let tracks = parse_youtube(&youtube_html(vec![
            json!({"videoRenderer":{"videoId":"abcDEF_12-3"}}),
        ]));
        assert_eq!(tracks[0].title, "Senza titolo");
        assert_eq!(tracks[0].author, "");
        assert_eq!(tracks[0].length, 0);
        assert_eq!(tracks[0].artwork_url, None);
        assert_eq!(limited(&"🎵".repeat(201), 200).chars().count(), 200);
    }

    #[test]
    fn durations_validate_fields_and_avoid_overflow() {
        assert_eq!(duration_ms("03:20"), 200_000);
        assert_eq!(duration_ms("1:02:03"), 3_723_000);
        for invalid in [
            "LIVE",
            "3",
            "3:60",
            "1:-2",
            "1: 2",
            ":20",
            "1:2:3:4",
            "99999999999999999999:00",
        ] {
            assert_eq!(duration_ms(invalid), 0, "{invalid}");
        }
    }

    #[test]
    fn parses_lavalink_fallback_with_the_same_output_contract() {
        let data = json!({"data":[
            {"info":{"title":"Canzone","author":"Autore","uri":"https://open.spotify.com/track/123","artworkUrl":"https://images.example.com/123.jpg","length":123456}},
            {"info":{"uri":"javascript:alert(1)"}},
            {"info":{"uri":"https://user:password@example.com/track"}},
            {"info":{"uri":"https://www.youtube.com/watch?v=abcDEF_12-3","length":-2,"artworkUrl":"http://images.example.com/unsafe.jpg"}}
        ]});
        let tracks = parse_lavalink(&data);
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].title, "Canzone");
        assert_eq!(tracks[0].length, 123456);
        assert_eq!(tracks[1].title, "Senza titolo");
        assert_eq!(tracks[1].length, 0);
        assert_eq!(tracks[1].artwork_url, None);
        assert!(parse_lavalink(&json!({"loadType":"error"})).is_empty());
        let many = json!({"data":(0..20).map(|_| json!({"info":{"uri":"https://www.youtube.com/watch?v=abcDEF_12-3"}})).collect::<Vec<_>>()});
        assert_eq!(parse_lavalink(&many).len(), 8);
    }

    #[test]
    fn validates_provider_and_query_before_requests() {
        assert_eq!(
            validate_query("  hello  ", "youtube").expect("valid query"),
            "hello"
        );
        assert!(validate_query("hello", "untrusted").is_err());
        assert!(validate_query(&"🎵".repeat(201), "spotify").is_err());
        assert!(validate_query(&"🎵".repeat(200), "spotify").is_ok());
        assert_eq!(validate_query("  ", "youtube").expect("empty query"), "");
    }
}
