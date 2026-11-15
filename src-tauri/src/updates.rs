use std::{io::Read, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tempfile::NamedTempFile;
use tokio::io::AsyncWriteExt;

const MAX_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) fn verification_only() -> bool {
    cfg!(debug_assertions)
        && std::env::var("HUSH_RUST_TEST_UPDATE_VERIFY_ONLY").as_deref() == Ok("1")
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStatus {
    pub status: &'static str,
    current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
}

struct ReadyUpdate {
    update: Update,
    file: NamedTempFile,
}

pub(crate) struct UpdateManager {
    status: Mutex<UpdateStatus>,
    checking: tokio::sync::Mutex<()>,
    ready: Mutex<Option<ReadyUpdate>>,
    enabled: bool,
}

impl UpdateManager {
    pub fn new(version: String, enabled: bool) -> Self {
        Self {
            status: Mutex::new(UpdateStatus {
                status: if enabled { "idle" } else { "disabled" },
                current_version: version,
                version: None,
                percent: None,
                message: (!enabled)
                    .then_some("Gli aggiornamenti sono disponibili nell’app Rust installata."),
            }),
            checking: tokio::sync::Mutex::new(()),
            ready: Mutex::new(None),
            enabled,
        }
    }

    pub fn status(&self) -> Result<UpdateStatus, String> {
        self.status
            .lock()
            .map(|s| s.clone())
            .map_err(|_| "Stato aggiornamenti non disponibile.".into())
    }

    pub fn has_ready(&self) -> bool {
        if cfg!(debug_assertions) {
            return false;
        }
        self.ready
            .lock()
            .map(|ready| ready.is_some())
            .unwrap_or(false)
    }

    fn publish(
        &self,
        app: &AppHandle,
        state: &'static str,
        version: Option<String>,
        percent: Option<f64>,
        message: Option<&'static str>,
    ) {
        if let Ok(mut status) = self.status.lock() {
            status.status = state;
            status.version = version;
            status.percent = percent;
            status.message = message;
            let _ = app.emit_to("main", "native_update_status", status.clone());
        }
    }

    pub async fn check(&self, app: &AppHandle) -> Result<UpdateStatus, String> {
        if !self.enabled {
            return self.status();
        }
        let Ok(_guard) = self.checking.try_lock() else {
            return self.status();
        };
        if self
            .ready
            .lock()
            .map_err(|_| "Aggiornamento non disponibile.")?
            .is_some()
        {
            return self.status();
        }
        self.publish(app, "checking", None, None, None);
        if self.download(app).await.is_err() {
            self.publish(
                app,
                "error",
                None,
                None,
                Some("Verifica o download non riusciti. Puoi riprovare più tardi."),
            );
        }
        self.status()
    }

    async fn download(&self, app: &AppHandle) -> Result<(), String> {
        let exiting_app = app.clone();
        let builder = app
            .updater_builder()
            .timeout(Duration::from_secs(15))
            .on_before_exit(move || {
                // Windows updater exits directly after launching NSIS.
                crate::abort_native_work(&exiting_app);
                exiting_app.cleanup_before_exit();
            });
        // Debug verification may fetch the current signed package. It cannot
        // install anything, and release builds never honor this override.
        let builder = if verification_only() {
            builder.version_comparator(|_, _| true)
        } else {
            builder
        };
        let updater = builder
            .build()
            .map_err(|_| "Configurazione aggiornamenti non valida.")?;
        let update = updater
            .check()
            .await
            .map_err(|_| "Verifica aggiornamenti non riuscita.")?;
        let Some(update) = update else {
            self.publish(app, "current", None, None, None);
            return Ok(());
        };
        if !trusted_package_url(&update.download_url) {
            return Err("Origine aggiornamento non valida.".into());
        }
        let version = update.version.clone();
        self.publish(app, "available", Some(version.clone()), None, None);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 5 && trusted_download_host(attempt.url()) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|_| "Download non disponibile.")?;
        let mut response = client
            .get(update.download_url.clone())
            .send()
            .await
            .map_err(|_| "Download non disponibile.")?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|size| size > MAX_PACKAGE_BYTES)
        {
            return Err("Pacchetto aggiornamento non valido.".into());
        }
        let total = response.content_length();
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|_| "Cache non disponibile.")?
            .join("updates");
        tokio::fs::create_dir_all(&cache)
            .await
            .map_err(|_| "Cache non disponibile.")?;
        let temporary = tempfile::Builder::new()
            .prefix("hush-update-")
            .suffix(".pending")
            .tempfile_in(cache)
            .map_err(|_| "Cache non disponibile.")?;
        let mut file =
            tokio::fs::File::from_std(temporary.reopen().map_err(|_| "Cache non disponibile.")?);
        let mut received = 0_u64;
        self.publish(app, "downloading", Some(version.clone()), Some(0.0), None);
        while let Some(chunk) = response.chunk().await.map_err(|_| "Download interrotto.")? {
            if chunk.len() as u64 > MAX_PACKAGE_BYTES - received {
                return Err("Pacchetto aggiornamento troppo grande.".into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|_| "Salvataggio aggiornamento non riuscito.")?;
            received += chunk.len() as u64;
            let percent = total
                .filter(|size| *size > 0)
                .map(|size| (received as f64 / size as f64 * 100.0).min(100.0));
            self.publish(app, "downloading", Some(version.clone()), percent, None);
        }
        file.sync_all()
            .await
            .map_err(|_| "Salvataggio aggiornamento non riuscito.")?;
        drop(file);
        let bytes = tokio::fs::read(temporary.path())
            .await
            .map_err(|_| "Verifica aggiornamento non riuscita.")?;
        update
            .verify(&bytes)
            .map_err(|_| "Firma aggiornamento non valida.")?;
        drop(bytes);
        *self
            .ready
            .lock()
            .map_err(|_| "Aggiornamento non disponibile.")? = Some(ReadyUpdate {
            update,
            file: temporary,
        });
        self.publish(app, "downloaded", Some(version), Some(100.0), None);
        Ok(())
    }

    pub fn install(&self, app: &AppHandle, restart: bool) -> Result<(), String> {
        if cfg!(debug_assertions) {
            return Err("L’installazione è disattivata nelle build di verifica.".into());
        }
        let result = self.install_ready(restart);
        if result.is_err() {
            // A failed cached update must not leave Restart with no package.
            self.publish(
                app,
                "error",
                None,
                None,
                Some("Installazione non riuscita. Verifica di nuovo gli aggiornamenti."),
            );
        }
        result
    }

    fn install_ready(&self, restart: bool) -> Result<(), String> {
        let ready = self
            .ready
            .lock()
            .map_err(|_| "Aggiornamento non disponibile.")?
            .take()
            .ok_or("Nessun aggiornamento pronto.")?;
        let mut bytes = Vec::new();
        ready
            .file
            .reopen()
            .map_err(|_| "Aggiornamento non disponibile.")?
            .take(MAX_PACKAGE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Aggiornamento non disponibile.")?;
        if bytes.len() as u64 > MAX_PACKAGE_BYTES {
            return Err("Pacchetto aggiornamento troppo grande.".into());
        }
        let _ = ready.file.close();
        // The plugin verifies the signature and signed version again before
        // launching NSIS. A failed or modified cache is never executed.
        ready
            .update
            .restart_after_install(restart)
            .install(bytes)
            .map_err(|_| "Installazione aggiornamento non riuscita.".into())
    }
}

fn trusted_download_host(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
                    | "github-releases.githubusercontent.com"
            )
        )
}

fn trusted_package_url(url: &tauri::Url) -> bool {
    trusted_download_host(url)
        && url.host_str() == Some("github.com")
        && url
            .path()
            .starts_with("/DexiAkaStompa/hush/releases/download/rust-preview/")
        && url.path().ends_with(".exe")
}

#[cfg(test)]
mod tests {
    use super::*;

    // The optional release check reads only the built installer and public
    // signature. It exercises the plugin's real verification without ever
    // launching an installer or touching an installed Hush profile.
    #[test]
    #[ignore = "Requires a signed installer: HUSH_RUST_VERIFY_PACKAGE"]
    fn signed_installer_rejects_corruption_and_a_substituted_version() {
        let package = std::path::PathBuf::from(
            std::env::var_os("HUSH_RUST_VERIFY_PACKAGE").expect("signed installer path"),
        );
        let bytes = std::fs::read(&package).expect("installer bytes");
        assert!(!bytes.is_empty() && bytes.len() as u64 <= MAX_PACKAGE_BYTES);
        let signature = std::fs::read_to_string(format!("{}.sig", package.display()))
            .expect("public updater signature");
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("native config");
        let updater_config = config["plugins"]["updater"].clone();
        assert_eq!(updater_config["requireSignedVersion"], true);
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context
            .config_mut()
            .plugins
            .0
            .insert("updater".into(), updater_config);
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .expect("verification-only runtime");
        let updater = app
            .updater_builder()
            .version_comparator(|_, _| true)
            .build()
            .expect("updater");
        let update = updater.restore_update(serde_json::json!({
            "version": env!("CARGO_PKG_VERSION"),
            "url": "https://github.com/DexiAkaStompa/hush/releases/download/rust-preview/verification.exe",
            "signature": signature.trim(),
        })).expect("manifest").expect("signed update");
        update.verify(&bytes).expect("genuine signed installer");
        let mut corrupted = bytes.clone();
        corrupted[0] ^= 1;
        assert!(
            update.verify(&corrupted).is_err(),
            "corrupt installer accepted"
        );
        let mut substituted = update.clone();
        substituted.version = "999.0.0".into();
        assert!(
            substituted.verify(&bytes).is_err(),
            "version substitution accepted"
        );
    }

    #[test]
    fn only_the_designated_release_channel_can_supply_installers() {
        assert!(trusted_package_url(
            &"https://github.com/DexiAkaStompa/hush/releases/download/rust-preview/Hush-setup.exe"
                .parse()
                .expect("URL")
        ));
        for url in ["http://github.com/DexiAkaStompa/hush/releases/download/rust-preview/Hush.exe", "https://github.com/other/repo/releases/download/rust-preview/Hush.exe", "https://evil.test/Hush.exe", "https://github.com:8443/DexiAkaStompa/hush/releases/download/rust-preview/Hush.exe", "https://user:secret@github.com/DexiAkaStompa/hush/releases/download/rust-preview/Hush.exe"] {
            assert!(!trusted_package_url(&url.parse().expect("URL")));
        }
    }
}
