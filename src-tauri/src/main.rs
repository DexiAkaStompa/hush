#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod downloads;
mod memory;
mod migration;
mod music;
mod updates;

use downloads::DownloadManager;
use std::sync::Mutex;
use tauri::{ipc::InvokeBody, AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

struct AppState {
    downloads: Mutex<DownloadManager>,
    http: reqwest::Client,
    updates: updates::UpdateManager,
    memory: memory::MemoryController,
    migration: migration::MigrationManager,
}

fn trusted(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Richiesta non autorizzata.".into());
    }
    let url = window.url().map_err(|_| "Origine non disponibile.")?;
    if trusted_url(&url) {
        Ok(())
    } else {
        Err("Richiesta non autorizzata.".into())
    }
}

fn trusted_url(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if url.scheme() == "https" && url.host_str() == Some("tauri.localhost") && url.port().is_none()
    {
        return true;
    }
    if url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none() {
        return true;
    }
    cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(5173)
}

#[tauri::command]
fn native_version(window: WebviewWindow) -> Result<String, String> {
    trusted(&window)?;
    Ok(window.app_handle().package_info().version.to_string())
}

#[tauri::command]
fn native_set_call_active(
    window: WebviewWindow,
    state: State<'_, AppState>,
    active: bool,
) -> Result<(), String> {
    trusted(&window)?;
    state.memory.set_call_active(&window, active)
}

#[tauri::command]
fn native_get_memory_status(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<memory::MemoryStatus, String> {
    trusted(&window)?;
    state.memory.status()
}

#[tauri::command]
fn native_migration_has_source(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    trusted(&window)?;
    Ok(state.migration.source_available())
}

#[tauri::command]
fn native_migration_source_status(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<&'static str, String> {
    trusted(&window)?;
    Ok(state.migration.source_status())
}

#[tauri::command]
async fn native_migration_begin(
    window: WebviewWindow,
    state: State<'_, AppState>,
    hello: serde_json::Value,
) -> Result<bool, String> {
    trusted(&window)?;
    state.migration.begin(&window, hello).await
}

#[tauri::command]
async fn native_migration_send(
    window: WebviewWindow,
    state: State<'_, AppState>,
    message: serde_json::Value,
) -> Result<(), String> {
    trusted(&window)?;
    state.migration.send(&window, message).await
}

#[tauri::command]
async fn native_migration_finish(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    trusted(&window)?;
    state.migration.finish(&window).await
}

#[tauri::command]
fn native_pending_link(window: WebviewWindow) -> Result<Option<String>, String> {
    trusted(&window)?;
    // The preview deliberately does not take over the stable app's hush:// links.
    Ok(None)
}

#[tauri::command]
fn native_updates_get_status(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<updates::UpdateStatus, String> {
    trusted(&window)?;
    state.updates.status()
}

#[tauri::command]
async fn native_updates_check(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<updates::UpdateStatus, String> {
    trusted(&window)?;
    state.updates.check(window.app_handle()).await
}

#[tauri::command]
async fn native_updates_install(window: WebviewWindow) -> Result<(), String> {
    trusted(&window)?;
    if window.state::<AppState>().memory.status()?.call_active {
        return Err("Termina la chiamata prima di installare l’aggiornamento.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().updates.install(&app, true)
    })
    .await
    .map_err(|_| "Installazione interrotta.".to_string())?
}

#[tauri::command]
fn native_copy_text(window: WebviewWindow, text: String) -> Result<(), String> {
    trusted(&window)?;
    if text.chars().count() > 16_384 {
        return Err("Testo troppo lungo per gli appunti.".into());
    }
    window
        .clipboard()
        .write_text(text)
        .map_err(|_| "Impossibile copiare il testo.".into())
}

#[tauri::command]
fn native_set_material(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    trusted(&window)?;
    #[cfg(target_os = "windows")]
    {
        use tauri::{utils::WindowEffect, window::EffectsBuilder};
        if enabled {
            return Ok(window
                .set_effects(
                    EffectsBuilder::new()
                        .effect(WindowEffect::Acrylic)
                        .color((20, 22, 24, 180).into())
                        .build(),
                )
                .is_ok());
        }
        window
            .set_effects(None::<tauri::utils::config::WindowEffectsConfig>)
            .map_err(|_| "Materiale finestra non disponibile.")?;
    }
    let _ = enabled;
    Ok(false)
}

#[tauri::command]
async fn native_search_music(
    window: WebviewWindow,
    state: State<'_, AppState>,
    query: String,
    provider: String,
) -> Result<Vec<music::MusicTrack>, String> {
    trusted(&window)?;
    music::search_music(&state.http, &query, &provider).await
}

#[tauri::command]
async fn native_call_relay(
    window: WebviewWindow,
    state: State<'_, AppState>,
    access_token: String,
    conversation_id: String,
) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    if access_token.is_empty()
        || access_token.len() > 8192
        || access_token.contains(['\r', '\n'])
        || uuid::Uuid::parse_str(&conversation_id).is_err()
    {
        return Err("Richiesta relay non valida.".into());
    }
    // The fixed native endpoint bypasses browser CORS, preserving the broker's
    // JWT, membership, connect permission and rate-limit checks. The renderer
    // cannot redirect its token to a different host.
    let mut response = state
        .http
        .post("https://hush-turn-credentials.mattiapalermo317.workers.dev/credentials")
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "conversationId": conversation_id }))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Relay non raggiungibile.")?;
    if !response.status().is_success() {
        return Err("Relay non disponibile per questa chiamata.".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Risposta relay interrotta.")?
    {
        if chunk.len() > 32_768 - body.len() {
            return Err("Risposta relay non valida.".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "Risposta relay non valida.".into())
}

#[derive(serde::Deserialize)]
struct NotificationOptions {
    title: String,
    body: String,
}

#[tauri::command]
fn native_show_notification(
    window: WebviewWindow,
    options: NotificationOptions,
) -> Result<(), String> {
    trusted(&window)?;
    if options.title.chars().count() > 200 || options.body.chars().count() > 2_000 {
        return Err("Notifica troppo lunga.".into());
    }
    window
        .notification()
        .builder()
        .title(options.title)
        .body(options.body)
        .show()
        .map_err(|_| "Impossibile mostrare la notifica.".into())
}

fn safe_name(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let name: String = leaf
        .chars()
        .take(180)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let name = name.trim_matches([' ', '.']);
    if name.is_empty() {
        "allegato".into()
    } else {
        name.into()
    }
}

#[tauri::command]
async fn attachment_save_begin(
    window: WebviewWindow,
    state: State<'_, AppState>,
    name: String,
) -> Result<Option<String>, String> {
    trusted(&window)?;
    let app = window.app_handle().clone();
    let file_name = safe_name(&name);
    let destination = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(file_name)
            .blocking_save_file()
    })
    .await
    .map_err(|_| "Selezione del file interrotta.")?;
    let Some(destination) = destination else {
        return Ok(None);
    };
    let path = destination
        .into_path()
        .map_err(|_| "Destinazione non valida.")?;
    let token = state
        .downloads
        .lock()
        .map_err(|_| "Download non disponibile.")?
        .begin(window.label(), path)
        .map_err(|e| e.to_string())?;
    Ok(Some(token))
}

#[tauri::command]
async fn attachment_save_write(
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    trusted(&window)?;
    let token = request
        .headers()
        .get("x-hush-token")
        .and_then(|s| s.to_str().ok())
        .filter(|s| s.len() <= 64)
        .ok_or("Download non valido.")?
        .to_owned();
    let index = request
        .headers()
        .get("x-hush-index")
        .and_then(|s| s.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or("Blocco download non valido.")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Blocco download non valido.".into());
    };
    if bytes.len() > downloads::MAX_CHUNK_BYTES {
        let _ = window
            .state::<AppState>()
            .downloads
            .lock()
            .map(|mut downloads| downloads.abort(window.label(), &token));
        return Err("Blocco download troppo grande.".into());
    }
    let bytes = bytes.clone();
    let app = window.app_handle().clone();
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .downloads
            .lock()
            .map_err(|_| "Download non disponibile.".to_string())?
            .write(&owner, &token, index, &bytes)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "Scrittura del file interrotta.".to_string())?
}

#[tauri::command]
async fn attachment_save_finish(window: WebviewWindow, token: String) -> Result<(), String> {
    trusted(&window)?;
    let app = window.app_handle().clone();
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .downloads
            .lock()
            .map_err(|_| "Download non disponibile.".to_string())?
            .finish(&owner, &token)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "Salvataggio del file interrotto.".to_string())?
}

#[tauri::command]
fn attachment_save_abort(
    window: WebviewWindow,
    state: State<'_, AppState>,
    token: String,
) -> Result<(), String> {
    trusted(&window)?;
    state
        .downloads
        .lock()
        .map_err(|_| "Download non disponibile.")?
        .abort(window.label(), &token)
        .map_err(|e| e.to_string())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Avvio di Hush Rust non riuscito: {error}");
        std::process::exit(1);
    }
}

fn abort_native_work(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut downloads) = state.downloads.lock() {
            downloads.abort_owner("main");
        }
        state.migration.abort_owner("main");
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let builder = tauri::Builder::default();
    let builder = if cfg!(debug_assertions)
        && std::env::var("HUSH_RUST_TEST_ALLOW_MULTI_INSTANCE").as_deref() == Ok("1")
    {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
    };
    let app = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            downloads: Mutex::new(DownloadManager::default()),
            http,
            updates: updates::UpdateManager::new(
                env!("CARGO_PKG_VERSION").into(),
                updates::verification_only()
                    || (!cfg!(debug_assertions)
                        && std::env::var("HUSH_DISABLE_AUTO_UPDATE").as_deref() != Ok("1")),
            ),
            memory: memory::MemoryController::default(),
            migration: migration::MigrationManager::default(),
        })
        .invoke_handler(tauri::generate_handler![
            native_version,
            native_set_call_active,
            native_get_memory_status,
            native_migration_has_source,
            native_migration_source_status,
            native_migration_begin,
            native_migration_send,
            native_migration_finish,
            native_updates_get_status,
            native_updates_check,
            native_updates_install,
            native_pending_link,
            native_copy_text,
            native_set_material,
            native_search_music,
            native_call_relay,
            native_show_notification,
            attachment_save_begin,
            attachment_save_write,
            attachment_save_finish,
            attachment_save_abort
        ])
        .setup(|app| {
            let notification_app = app.handle().clone();
            app.notification().on_action(move |_| {
                if let Some(window) = notification_app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("native_notification_clicked", ());
                }
            })?;
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("Configurazione finestra mancante")?;
            let window_config = config.clone();
            #[cfg(debug_assertions)]
            let window_config = {
                let mut config = window_config;
                if let Ok(value) = std::env::var("HUSH_RUST_TEST_URL") {
                    let url: tauri::Url = value.parse()?;
                    if url.scheme() != "http"
                        || url.host_str() != Some("127.0.0.1")
                        || url.port() != Some(5173)
                        || !url.username().is_empty()
                        || url.password().is_some()
                    {
                        return Err("Origine di verifica non valida.".into());
                    }
                    config.url = tauri::WebviewUrl::External(url);
                }
                config
            };
            let builder = tauri::WebviewWindowBuilder::from_config(app, &window_config)?
                .on_navigation(trusted_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
            #[cfg(debug_assertions)]
            let builder = if let Ok(args) = std::env::var("HUSH_RUST_TEST_BROWSER_ARGS") {
                builder.additional_browser_args(&args)
            } else {
                builder
            };
            #[cfg(debug_assertions)]
            let builder = if let Ok(path) = std::env::var("HUSH_RUST_TEST_DATA_DIR") {
                builder.data_directory(std::path::PathBuf::from(path))
            } else {
                builder
            };
            #[cfg(debug_assertions)]
            let builder = if let Ok(title) = std::env::var("HUSH_RUST_TEST_WINDOW_TITLE") {
                builder.title(title)
            } else {
                builder
            };
            builder.build()?;
            if !cfg!(debug_assertions) {
                let updates_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Leave first paint and sign-in free of updater work.
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    loop {
                        let _ = updates_app
                            .state::<AppState>()
                            .updates
                            .check(&updates_app)
                            .await;
                        tokio::time::sleep(std::time::Duration::from_secs(4 * 60 * 60)).await;
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)
            ) {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    let state = window.state::<AppState>();
                    let _ = state.memory.update_window(
                        &webview,
                        window.is_focused().unwrap_or(true),
                        window.is_minimized().unwrap_or(false),
                    );
                }
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut downloads) = state.downloads.lock() {
                        downloads.abort_owner(window.label());
                    }
                    state.migration.abort_owner(window.label());
                }
            }
        })
        .build(tauri::generate_context!())?;
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            if app.state::<AppState>().updates.has_ready() {
                // As in the Electron client, a verified background download is
                // applied on an ordinary quit. Explicit restart uses the same path.
                api.prevent_exit();
                let update_app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if update_app
                        .state::<AppState>()
                        .updates
                        .install(&update_app, false)
                        .is_err()
                    {
                        update_app.exit(0);
                    }
                });
            }
        }
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            abort_native_work(app);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_is_exact_and_rejects_external_navigation() {
        for input in ["https://tauri.localhost/", "tauri://localhost/index.html"] {
            assert!(trusted_url(&input.parse().expect("URL")));
        }
        for input in [
            "https://tauri.localhost.evil.test/",
            "https://example.com/",
            "file:///tmp/app.html",
            "http://tauri.localhost/",
            "javascript:alert(1)",
        ] {
            assert!(!trusted_url(&input.parse().expect("URL")));
        }
    }

    #[test]
    fn suggested_download_names_never_supply_a_path() {
        assert_eq!(safe_name("../../private/file.wav"), "file.wav");
        assert_eq!(safe_name("C:\\private\\clip.mp4"), "clip.mp4");
        assert_eq!(safe_name(" . "), "allegato");
        assert_eq!(safe_name("track:1?.wav"), "track_1_.wav");
    }
}
