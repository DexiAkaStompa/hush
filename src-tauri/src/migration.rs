//! Short-lived local handoff from the original Electron installation. Native
//! code relays public handshakes and opaque encrypted frames; it never reads or
//! persists an account token, private device key, preference or custom sound.

use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, WebviewWindow};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;
use uuid::Uuid;

const MAX_LINE_BYTES: usize = 2 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_MARKER_BYTES: u64 = 16 * 1024;
const LIFETIME: Duration = Duration::from_secs(5 * 60);
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSING_GRACE: Duration = Duration::from_secs(2);
const QUEUE_CAPACITY: usize = 4;
const INTERRUPTED: &str =
    "Trasferimento di Hush interrotto. I dati originali sono stati mantenuti.";
const INVALID: &str = "Messaggio di trasferimento di Hush non valido.";

#[derive(Clone, Copy, Eq, PartialEq)]
enum Stop {
    Running,
    Finished,
    Aborted,
}

struct Outbound {
    message: Value,
    complete: oneshot::Sender<Result<(), String>>,
}

struct Active {
    id: Uuid,
    owner: String,
    transfer_id: String,
    deadline: Instant,
    outgoing: mpsc::Sender<Outbound>,
    stop: watch::Sender<Stop>,
    completed: watch::Receiver<bool>,
}

#[derive(Clone, Default)]
pub struct MigrationManager {
    active: Arc<Mutex<Option<Active>>>,
}

impl MigrationManager {
    pub fn source_status(&self) -> &'static str {
        #[cfg(windows)]
        {
            windows::source_status()
        }
        #[cfg(not(windows))]
        {
            "none"
        }
    }

    pub fn source_available(&self) -> bool {
        #[cfg(windows)]
        {
            windows::source().is_some()
        }
        #[cfg(not(windows))]
        {
            false
        }
    }

    pub async fn begin(&self, window: &WebviewWindow, hello: Value) -> Result<bool, String> {
        let (hello, duration) = valid_hello(&hello, now_ms())?;
        #[cfg(not(windows))]
        {
            let _ = (window, hello, duration);
            Ok(false)
        }
        #[cfg(windows)]
        {
            use base64::Engine;
            let Some(source) = windows::source() else {
                return Ok(false);
            };
            let id = Uuid::new_v4();
            let pipe = format!("HushMigration-{id}");
            // UUID v4 uses the OS random source. Two independent UUIDs provide
            // ample authentication entropy without introducing another RNG.
            let mut random = [0_u8; 32];
            random[..16].copy_from_slice(Uuid::new_v4().as_bytes());
            random[16..].copy_from_slice(Uuid::new_v4().as_bytes());
            let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random);
            let server = windows::create_pipe(&pipe)?;
            let (outgoing, incoming) = mpsc::channel(QUEUE_CAPACITY);
            let (stop, stopped) = watch::channel(Stop::Running);
            let (completed, completion) = watch::channel(false);
            let deadline = Instant::now() + duration;
            let transfer_id = hello["id"].as_str().ok_or(INVALID)?.to_owned();
            {
                let mut active = self.active.lock().map_err(|_| INTERRUPTED)?;
                if active.is_some() {
                    return Err("Un trasferimento di Hush è già in corso.".into());
                }
                *active = Some(Active {
                    id,
                    owner: window.label().to_owned(),
                    transfer_id,
                    deadline,
                    outgoing,
                    stop,
                    completed: completion,
                });
            }
            // Arguments are passed separately, never through a shell. A
            // validated profile selects the same Electron single-instance lock
            // as an already running original client.
            let mut profile_argument = std::ffi::OsString::from("--user-data-dir=");
            profile_argument.push(windows::launch_path(&source.profile));
            let launched = std::process::Command::new(windows::launch_path(&source.executable))
                .arg(profile_argument)
                .arg(format!("--hush-migration-pipe={pipe}"))
                .arg(format!("--hush-migration-token={token}"))
                .spawn();
            if launched.is_err() {
                self.remove(id);
                return Err("Impossibile aprire il client Hush originale.".into());
            }
            // The original client may own an existing call or window. Never
            // kill it on timeout/failure; its own authenticated handoff decides
            // when it is safe to finish and close.
            let shared = Arc::clone(&self.active);
            let destination = window.clone();
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout_at(
                    deadline,
                    windows::relay(
                        server,
                        source.executable,
                        token,
                        hello,
                        incoming,
                        stopped,
                        |message| {
                            destination
                                .emit("native_migration_message", message)
                                .map_err(|_| INTERRUPTED.to_owned())
                        },
                    ),
                )
                .await;
                let notify = !matches!(result, Ok(Ok(())));
                let owned = match shared.lock() {
                    Ok(mut active) if active.as_ref().is_some_and(|item| item.id == id) => {
                        *active = None;
                        true
                    }
                    _ => false,
                };
                if owned && notify {
                    let _ =
                        destination.emit("native_migration_message", json!({ "kind": "cancel" }));
                }
                let _ = completed.send(true);
            });
            Ok(true)
        }
    }

    pub async fn send(&self, window: &WebviewWindow, message: Value) -> Result<(), String> {
        if message.get("kind").and_then(Value::as_str) == Some("cancel") {
            self.abort_owner(window.label());
            return Ok(());
        }
        let (outgoing, deadline, transfer_id) = {
            let active = self.active.lock().map_err(|_| INTERRUPTED)?;
            let transfer = active
                .as_ref()
                .filter(|transfer| transfer.owner == window.label())
                .ok_or(INTERRUPTED)?;
            (
                transfer.outgoing.clone(),
                transfer.deadline,
                transfer.transfer_id.clone(),
            )
        };
        valid_frame_message(&message, &transfer_id, None)?;
        let (complete, received) = oneshot::channel();
        // Reject overflow rather than creating arbitrarily many tasks waiting
        // for a queue slot while retaining multi-megabyte IPC messages.
        outgoing
            .try_send(Outbound { message, complete })
            .map_err(|_| "Trasferimento occupato o interrotto.".to_owned())?;
        tokio::time::timeout_at(deadline, received)
            .await
            .map_err(|_| INTERRUPTED.to_owned())?
            .map_err(|_| INTERRUPTED.to_owned())?
    }

    pub async fn finish(&self, window: &WebviewWindow) -> Result<(), String> {
        let mut completed = {
            let active = self.active.lock().map_err(|_| INTERRUPTED)?;
            let Some(transfer) = active.as_ref() else {
                // Cleanup is idempotent if an already completed source closed
                // immediately before the final renderer acknowledgement.
                return Ok(());
            };
            if transfer.owner != window.label() {
                return Err(INTERRUPTED.into());
            }
            transfer.stop.send_replace(Stop::Finished);
            transfer.completed.clone()
        };
        tokio::time::timeout(Duration::from_secs(4), async {
            while !*completed.borrow_and_update() {
                completed.changed().await.map_err(|_| INTERRUPTED)?;
            }
            Ok::<(), &str>(())
        })
        .await
        .map_err(|_| INTERRUPTED.to_owned())?
        .map_err(str::to_owned)
    }

    pub fn abort_owner(&self, owner: &str) {
        if let Ok(mut active) = self.active.lock() {
            if active
                .as_ref()
                .is_some_and(|transfer| transfer.owner == owner)
            {
                if let Some(transfer) = active.take() {
                    transfer.stop.send_replace(Stop::Aborted);
                }
            }
        }
    }

    #[cfg(windows)]
    fn remove(&self, id: Uuid) {
        if let Ok(mut active) = self.active.lock() {
            if active.as_ref().is_some_and(|transfer| transfer.id == id) {
                *active = None;
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn url_base64_32(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn public_key(value: &Value) -> Result<Value, String> {
    let object = value.as_object().ok_or(INVALID)?;
    let x = value["x"]
        .as_str()
        .filter(|value| url_base64_32(value))
        .ok_or(INVALID)?;
    let y = value["y"]
        .as_str()
        .filter(|value| url_base64_32(value))
        .ok_or(INVALID)?;
    if value["kty"] != "EC" || value["crv"] != "P-256" || object.contains_key("d") {
        return Err(INVALID.into());
    }
    Ok(json!({ "kty": "EC", "crv": "P-256", "x": x, "y": y, "ext": true, "key_ops": [] }))
}

fn valid_hello(value: &Value, now: u64) -> Result<(Value, Duration), String> {
    let id = value["id"]
        .as_str()
        .filter(|value| uuid(value))
        .ok_or(INVALID)?;
    let challenge = value["challenge"]
        .as_str()
        .filter(|value| url_base64_32(value))
        .ok_or(INVALID)?;
    let expires = value["expiresAt"].as_u64().ok_or(INVALID)?;
    let lifetime = LIFETIME.as_millis() as u64;
    if value["version"] != 1 || expires <= now || expires - now > lifetime + 1000 {
        return Err("Richiesta di trasferimento scaduta o non valida.".into());
    }
    let public = public_key(&value["publicKey"])?;
    Ok((
        json!({ "version": 1, "id": id, "challenge": challenge, "expiresAt": expires, "publicKey": public }),
        Duration::from_millis((expires - now).min(lifetime)),
    ))
}

fn valid_frame_message(value: &Value, id: &str, sequence: Option<u64>) -> Result<(), String> {
    let outer = value.as_object().ok_or(INVALID)?;
    let frame = value["frame"].as_object().ok_or(INVALID)?;
    let nonce = frame.get("nonce").and_then(Value::as_str).ok_or(INVALID)?;
    let ciphertext = frame
        .get("ciphertext")
        .and_then(Value::as_str)
        .ok_or(INVALID)?;
    let number = frame
        .get("sequence")
        .and_then(Value::as_u64)
        .ok_or(INVALID)?;
    let content = ciphertext.trim_end_matches('=');
    if outer.len() != 2
        || value["kind"] != "frame"
        || frame.len() != 5
        || frame.get("version") != Some(&json!(1))
        || frame.get("transferId").and_then(Value::as_str) != Some(id)
        || sequence.is_some_and(|expected| number != expected)
        || number > 9_007_199_254_740_991
        || nonce.len() != 16
        || !nonce
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
        || ciphertext.len() < 24
        || ciphertext.len() > ((MAX_FRAME_BYTES + 16).div_ceil(3)) * 4
        || !ciphertext.len().is_multiple_of(4)
        || ciphertext.len() - content.len() > 2
        || !content
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
    {
        return Err(INVALID.into());
    }
    Ok(())
}

fn bounded_line(value: &Value) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| INVALID)?;
    if bytes.len() > MAX_LINE_BYTES {
        return Err("Blocco di trasferimento troppo grande.".into());
    }
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::ffi::c_void;
    use std::io::Read;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::{Component, Path, PathBuf, Prefix};
    use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    pub(super) struct Source {
        pub executable: PathBuf,
        pub profile: PathBuf,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Marker {
        protocol_version: u8,
        executable_path: PathBuf,
        profile_path: PathBuf,
        version: String,
    }

    fn local_absolute(path: &Path) -> bool {
        path.is_absolute()
            && matches!(
                path.components().next(),
                Some(Component::Prefix(prefix))
                    if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
            )
    }

    fn same_path(left: &Path, right: &Path) -> bool {
        left.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
    }

    /// Rust canonical paths use a verbatim prefix; Chromium may treat that as a
    /// different user-data directory when deriving its single-instance lock.
    /// Only launch arguments lose the prefix. Validation and peer executable
    /// comparisons keep their canonical paths, and UNC/device paths are never
    /// rewritten. Work in UTF-16 so Windows filenames remain lossless.
    pub(super) fn launch_path(path: &Path) -> PathBuf {
        use std::ffi::OsString;
        use std::os::windows::ffi::{OsStrExt, OsStringExt};

        let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        let disk = wide.len() >= 7
            && wide[..4] == [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16]
            && ((b'A' as u16..=b'Z' as u16).contains(&wide[4])
                || (b'a' as u16..=b'z' as u16).contains(&wide[4]))
            && wide[5] == b':' as u16
            && wide[6] == b'\\' as u16;
        if disk {
            PathBuf::from(OsString::from_wide(&wide[4..]))
        } else {
            path.to_owned()
        }
    }

    fn marker(path: &Path, expected_profile: &Path) -> Option<Source> {
        let file = std::fs::File::open(path).ok()?;
        if file.metadata().ok()?.len() > MAX_MARKER_BYTES {
            return None;
        }
        let mut bytes = Vec::new();
        file.take(MAX_MARKER_BYTES + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.len() as u64 > MAX_MARKER_BYTES {
            return None;
        }
        let marker: Marker = serde_json::from_slice(&bytes).ok()?;
        if marker.protocol_version != 1
            || marker.version.is_empty()
            || marker.version.len() > 128
            || !local_absolute(&marker.executable_path)
            || !marker.profile_path.is_absolute()
            || !marker
                .executable_path
                .file_name()?
                .to_string_lossy()
                .eq_ignore_ascii_case("Hush.exe")
        {
            return None;
        }
        let executable = std::fs::canonicalize(marker.executable_path).ok()?;
        let profile = std::fs::canonicalize(marker.profile_path).ok()?;
        let expected_profile = std::fs::canonicalize(expected_profile).ok()?;
        if !local_absolute(&executable)
            || !executable.is_file()
            || !executable
                .file_name()?
                .to_string_lossy()
                .eq_ignore_ascii_case("Hush.exe")
            || !profile.is_dir()
            || !same_path(&profile, &expected_profile)
        {
            return None;
        }
        Some(Source {
            executable,
            profile,
        })
    }

    pub(super) fn source() -> Option<Source> {
        #[cfg(debug_assertions)]
        if let Some(path) = std::env::var_os("HUSH_RUST_TEST_MIGRATION_MARKER") {
            let path = std::fs::canonicalize(path).ok()?;
            let directory = path.parent()?;
            let temporary = std::fs::canonicalize(std::env::temp_dir()).ok()?;
            let name = directory.file_name()?.to_string_lossy();
            if directory
                .parent()
                .is_some_and(|parent| same_path(parent, &temporary))
                && name.starts_with("hush-migration-test-")
                && path.file_name()? == "migration-ready.json"
            {
                return marker(&path, &directory.join("profile"));
            }
            return None;
        }
        let roaming = PathBuf::from(std::env::var_os("APPDATA")?);
        for name in ["Hush", "hush-private-space"] {
            let profile = roaming.join(name);
            if let Some(source) = marker(&profile.join("migration-ready.json"), &profile) {
                return Some(source);
            }
        }
        None
    }

    pub(super) fn source_status() -> &'static str {
        #[cfg(debug_assertions)]
        if std::env::var_os("HUSH_RUST_TEST_MIGRATION_MARKER").is_some() {
            // An explicit fixture override is exclusive, including when it is
            // missing/invalid. Never inspect the developer's actual profile as
            // a fallback from an isolated test.
            return source_status_in(Path::new(""), Some(source().is_some()));
        }
        let Some(roaming) = std::env::var_os("APPDATA") else {
            return "none";
        };
        source_status_in(&PathBuf::from(roaming), None)
    }

    fn source_status_in(roaming: &Path, fixture_ready: Option<bool>) -> &'static str {
        if let Some(ready) = fixture_ready {
            return if ready { "ready" } else { "none" };
        }
        let profiles = [roaming.join("Hush"), roaming.join("hush-private-space")];
        if profiles
            .iter()
            .any(|profile| marker(&profile.join("migration-ready.json"), profile).is_some())
        {
            return "ready";
        }
        // Only check directory metadata in the two known locations for the
        // current OS user. No LevelDB, IndexedDB, session or key file is opened,
        // enumerated or copied to determine whether the old client needs its
        // migration bridge update.
        if profiles.iter().any(|profile| {
            profile.join("IndexedDB").is_dir()
                && profile.join("Local Storage").join("leveldb").is_dir()
        }) {
            "update-required"
        } else {
            "none"
        }
    }

    struct LocalAllocation(*mut c_void);

    impl Drop for LocalAllocation {
        fn drop(&mut self) {
            // SAFETY: This owns exactly one allocation returned by a documented
            // LocalAlloc-family Windows security API; it is freed once.
            unsafe {
                if !self.0.is_null() {
                    LocalFree(self.0);
                }
            }
        }
    }

    fn user_sid() -> Result<String, String> {
        let mut raw = std::ptr::null_mut();
        // SAFETY: A valid process pseudo-handle and initialized output pointer
        // are passed; the returned real token handle gets one RAII owner.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
            return Err("Impossibile proteggere il trasferimento locale.".into());
        }
        let token = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
        let mut length = 0;
        // SAFETY: The first call only asks for the required buffer size.
        unsafe {
            GetTokenInformation(
                token.as_raw_handle().cast(),
                TokenUser,
                std::ptr::null_mut(),
                0,
                &mut length,
            )
        };
        if length < std::mem::size_of::<TOKEN_USER>() as u32 || length > 65_536 {
            return Err(INTERRUPTED.into());
        }
        // usize storage satisfies TOKEN_USER's alignment, unlike a Vec<u8>.
        let mut storage = vec![0_usize; (length as usize).div_ceil(std::mem::size_of::<usize>())];
        // SAFETY: The aligned buffer covers the API's requested size and all
        // SID pointers are used before that buffer leaves scope.
        let success = unsafe {
            GetTokenInformation(
                token.as_raw_handle().cast(),
                TokenUser,
                storage.as_mut_ptr().cast(),
                length,
                &mut length,
            )
        };
        if success == 0 {
            return Err(INTERRUPTED.into());
        }
        let user = unsafe { &*(storage.as_ptr().cast::<TOKEN_USER>()) };
        let mut sid = std::ptr::null_mut();
        // SAFETY: TOKEN_USER returned a valid SID; output is LocalAlloc-owned.
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut sid) } == 0 {
            return Err(INTERRUPTED.into());
        }
        let allocation = LocalAllocation(sid.cast());
        let mut count = 0;
        // SAFETY: ConvertSidToStringSidW returns a NUL-terminated UTF-16 SID.
        while count < 256 && unsafe { *sid.add(count) } != 0 {
            count += 1;
        }
        if count == 256 {
            return Err(INTERRUPTED.into());
        }
        let result = String::from_utf16(unsafe { std::slice::from_raw_parts(sid, count) })
            .map_err(|_| INTERRUPTED.to_owned());
        drop(allocation);
        result
    }

    pub(super) fn create_pipe(name: &str) -> Result<NamedPipeServer, String> {
        let sid = user_sid()?;
        // Protected DACL: only the exact current OS user receives access. No
        // Everyone, Authenticated Users, administrator or remote-client ACE.
        let sddl: Vec<u16> = format!("O:{sid}D:P(A;;GA;;;{sid})\0")
            .encode_utf16()
            .collect();
        let mut descriptor = std::ptr::null_mut();
        // SAFETY: Input is NUL terminated; descriptor is a checked output and
        // remains alive until synchronous pipe creation has copied its ACL.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err("Impossibile proteggere il trasferimento locale.".into());
        }
        let allocation = LocalAllocation(descriptor);
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let mut options = ServerOptions::new();
        options
            .first_pipe_instance(true)
            .reject_remote_clients(true)
            .max_instances(1)
            .in_buffer_size(64 * 1024)
            .out_buffer_size(64 * 1024);
        // SAFETY: attributes points to a live SECURITY_ATTRIBUTES and its live
        // self-relative descriptor. The handle is non-inheritable and uniquely
        // owned by Tokio after creation.
        let server = unsafe {
            options.create_with_security_attributes_raw(
                format!(r"\\.\pipe\{name}"),
                (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
            )
        }
        .map_err(|_| "Impossibile aprire il trasferimento locale protetto.".to_owned());
        drop(allocation);
        server
    }

    fn verify_client(server: &NamedPipeServer, expected: &Path) -> Result<(), String> {
        let mut pid = 0;
        // SAFETY: This is a connected server pipe whose handle stays live.
        if unsafe { GetNamedPipeClientProcessId(server.as_raw_handle().cast(), &mut pid) } == 0
            || pid == 0
        {
            return Err("Client del trasferimento non verificabile.".into());
        }
        // SAFETY: Only query access is requested; the returned handle is checked
        // before being given exactly one RAII owner.
        let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if raw.is_null() {
            return Err("Client del trasferimento non verificabile.".into());
        }
        let process = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
        let mut path = vec![0_u16; 32_768];
        let mut length = path.len() as u32;
        // SAFETY: The writable buffer and length describe the same allocation.
        if unsafe {
            QueryFullProcessImageNameW(
                process.as_raw_handle().cast(),
                0,
                path.as_mut_ptr(),
                &mut length,
            )
        } == 0
        {
            return Err("Client del trasferimento non verificabile.".into());
        }
        let queried = String::from_utf16(&path[..length as usize]).map_err(|_| INTERRUPTED)?;
        let actual = std::fs::canonicalize(queried).map_err(|_| INTERRUPTED)?;
        if !same_path(&actual, expected) {
            return Err("Il client collegato non è l’installazione Hush originale.".into());
        }
        Ok(())
    }

    async fn read_message<R: AsyncBufRead + Unpin>(
        reader: &mut R,
    ) -> Result<Option<Value>, String> {
        let mut bytes = Vec::new();
        loop {
            let available = reader.fill_buf().await.map_err(|_| INTERRUPTED)?;
            if available.is_empty() {
                return if bytes.is_empty() {
                    Ok(None)
                } else {
                    Err(INVALID.into())
                };
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let take = newline.map_or(available.len(), |index| index + 1);
            if bytes.len() + take > MAX_LINE_BYTES + usize::from(newline.is_some()) {
                return Err("Blocco di trasferimento troppo grande.".into());
            }
            bytes.extend_from_slice(&available[..take]);
            reader.consume(take);
            if newline.is_some() {
                bytes.pop();
                return serde_json::from_slice(&bytes)
                    .map(Some)
                    .map_err(|_| INVALID.into());
            }
        }
    }

    fn authenticated(value: &Value, expected: &str) -> bool {
        let Some(token) = value["token"].as_str() else {
            return false;
        };
        if value["kind"] != "authenticate" || !url_base64_32(token) || token.len() != expected.len()
        {
            return false;
        }
        token
            .bytes()
            .zip(expected.bytes())
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
    }

    pub(super) async fn relay<F>(
        server: NamedPipeServer,
        expected: PathBuf,
        token: String,
        hello: Value,
        mut outgoing: mpsc::Receiver<Outbound>,
        mut stopped: watch::Receiver<Stop>,
        emit: F,
    ) -> Result<(), String>
    where
        F: Fn(Value) -> Result<(), String>,
    {
        if *stopped.borrow() != Stop::Running {
            return Ok(());
        }
        tokio::select! {
            connected = server.connect() => connected.map_err(|_| INTERRUPTED)?,
            _ = stopped.changed() => return Ok(()),
        }
        verify_client(&server, &expected)?;
        let (read, mut write) = tokio::io::split(server);
        let mut read = BufReader::new(read);
        let authentication = tokio::select! {
            result = tokio::time::timeout(AUTH_TIMEOUT, read_message(&mut read)) => result.map_err(|_| INTERRUPTED)??,
            _ = stopped.changed() => return Ok(()),
        }.ok_or(INTERRUPTED)?;
        if !authenticated(&authentication, &token) {
            return Err("Autenticazione del trasferimento non riuscita.".into());
        }
        drop(authentication);
        drop(token);
        write
            .write_all(&bounded_line(&json!({"kind":"request", "hello":hello}))?)
            .await
            .map_err(|_| INTERRUPTED)?;
        let id = hello["id"].as_str().ok_or(INVALID)?.to_owned();
        let mut sender_key = false;
        let mut inbound = 0_u64;
        let mut outbound = 0_u64;
        let mut source_complete = false;
        let mut source_closed = false;
        let mut target_finished = false;
        let mut closing = None;
        loop {
            let closing_deadline = closing.unwrap_or_else(|| Instant::now() + LIFETIME);
            tokio::select! {
                changed = stopped.changed() => {
                    if changed.is_err() { return Err(INTERRUPTED.into()); }
                    let stop = *stopped.borrow_and_update();
                    match stop {
                        Stop::Running => {},
                        Stop::Aborted => return Err(INTERRUPTED.into()),
                        Stop::Finished => {
                            if source_complete || source_closed { return Ok(()); }
                            target_finished = true;
                            closing = Some(Instant::now() + CLOSING_GRACE);
                        }
                    }
                }
                incoming = read_message(&mut read), if !source_complete && !source_closed => {
                    let Some(mut message) = incoming? else {
                        if target_finished { return Ok(()); }
                        source_closed = true;
                        closing = Some(Instant::now() + CLOSING_GRACE);
                        continue;
                    };
                    match message["kind"].as_str() {
                        Some("sender-key") if !sender_key => {
                            let key = public_key(&message["publicKey"])?;
                            sender_key = true;
                            emit(json!({"kind":"sender-key", "publicKey":key}))?;
                        }
                        Some("frame") if sender_key => {
                            valid_frame_message(&message, &id, Some(inbound))?;
                            inbound += 1;
                            // The validated encrypted frame is moved into the
                            // event, with no extra account-shaped fields.
                            emit(message.take())?;
                        }
                        Some("complete") if sender_key && inbound > 0 => {
                            source_complete = true;
                            if target_finished { return Ok(()); }
                        }
                        Some("cancel") => return Err(INTERRUPTED.into()),
                        _ => return Err(INVALID.into()),
                    }
                }
                message = outgoing.recv() => {
                    let Some(message) = message else { return Err(INTERRUPTED.into()); };
                    let result = async {
                        if source_complete || source_closed { return Err(INTERRUPTED.into()); }
                        valid_frame_message(&message.message, &id, Some(outbound))?;
                        let line = bounded_line(&message.message)?;
                        write.write_all(&line).await.map_err(|_| INTERRUPTED)?;
                        outbound += 1;
                        Ok(())
                    }.await;
                    let failed = result.is_err();
                    let _ = message.complete.send(result);
                    if failed { return Err(INTERRUPTED.into()); }
                }
                _ = tokio::time::sleep_until(closing_deadline), if closing.is_some() => {
                    return if target_finished { Ok(()) } else { Err(INTERRUPTED.into()) };
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use tokio::net::windows::named_pipe::ClientOptions;

        fn legacy_profile(roaming: &Path, name: &str) -> PathBuf {
            let profile = roaming.join(name);
            std::fs::create_dir_all(profile.join("IndexedDB"))
                .expect("original IndexedDB directory");
            std::fs::create_dir_all(profile.join("Local Storage").join("leveldb"))
                .expect("original local storage directory");
            profile
        }

        #[test]
        fn source_status_requires_both_original_storage_directories_in_known_locations() {
            let directory = tempfile::tempdir().expect("isolated roaming directory");
            let roaming = directory.path();
            assert_eq!(source_status_in(roaming, None), "none");
            let hush = roaming.join("Hush");
            std::fs::create_dir_all(hush.join("IndexedDB")).expect("IndexedDB only");
            assert_eq!(source_status_in(roaming, None), "none");
            std::fs::create_dir_all(hush.join("Local Storage")).expect("storage without LevelDB");
            assert_eq!(source_status_in(roaming, None), "none");
            std::fs::create_dir_all(
                roaming
                    .join("hush-private-space")
                    .join("Local Storage")
                    .join("leveldb"),
            )
            .expect("another profile's local storage");
            assert_eq!(source_status_in(roaming, None), "none");
            std::fs::create_dir_all(hush.join("Local Storage").join("leveldb")).expect("LevelDB");
            assert_eq!(source_status_in(roaming, None), "update-required");

            let unrelated = tempfile::tempdir().expect("fresh unrelated profile");
            legacy_profile(unrelated.path(), "Another application");
            assert_eq!(source_status_in(unrelated.path(), None), "none");
        }

        #[test]
        fn valid_bridge_marker_takes_precedence_over_older_known_profile_data() {
            let directory = tempfile::tempdir().expect("isolated roaming directory");
            legacy_profile(directory.path(), "Hush");
            let profile = legacy_profile(directory.path(), "hush-private-space");
            let executable = directory.path().join("Hush.exe");
            std::fs::write(&executable, b"test executable metadata").expect("source executable");
            let marker_path = profile.join("migration-ready.json");
            let mut value = json!({"protocolVersion":0,"version":"0.5.65","executablePath":executable,"profilePath":profile});
            std::fs::write(&marker_path, value.to_string()).expect("unsupported marker");
            assert_eq!(source_status_in(directory.path(), None), "update-required");
            value["protocolVersion"] = json!(1);
            std::fs::write(&marker_path, value.to_string()).expect("valid bridge marker");
            assert_eq!(source_status_in(directory.path(), None), "ready");
            std::fs::remove_file(executable).expect("source no longer installed");
            assert_eq!(source_status_in(directory.path(), None), "update-required");
        }

        #[test]
        fn fixture_override_never_falls_back_to_real_legacy_profile_detection() {
            let directory = tempfile::tempdir().expect("isolated roaming directory");
            legacy_profile(directory.path(), "Hush");
            assert_eq!(source_status_in(directory.path(), None), "update-required");
            // Missing, malformed or outside-scope explicit debug markers all
            // resolve to this exclusive false override, rather than probing
            // APPDATA after the fixture source was rejected.
            assert_eq!(source_status_in(directory.path(), Some(false)), "none");
            assert_eq!(source_status_in(directory.path(), Some(true)), "ready");
        }

        #[test]
        fn legacy_detection_does_not_open_original_storage_files() {
            use std::os::windows::fs::OpenOptionsExt;
            let directory = tempfile::tempdir().expect("isolated roaming directory");
            let profile = legacy_profile(directory.path(), "Hush");
            let locked_database = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .share_mode(0)
                .open(profile.join("IndexedDB").join("private-key-store.locked"))
                .expect("exclusively locked original IndexedDB file");
            let locked_session = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .share_mode(0)
                .open(
                    profile
                        .join("Local Storage")
                        .join("leveldb")
                        .join("private-session.locked"),
                )
                .expect("exclusively locked original session file");
            assert_eq!(source_status_in(directory.path(), None), "update-required");
            drop((locked_database, locked_session));
        }

        #[test]
        fn launch_arguments_normalize_only_verbatim_local_disks_without_losing_unicode() {
            assert_eq!(
                launch_path(Path::new(r"\\?\C:\Utenti\Màtti ユーザー\Hush.exe")),
                PathBuf::from(r"C:\Utenti\Màtti ユーザー\Hush.exe")
            );
            for value in [
                r"C:\Utenti\Màtti ユーザー\Hush.exe",
                r"\\?\UNC\server\share\Hush.exe",
                r"\\server\share\Hush.exe",
                r"\\.\pipe\HushMigration-example",
            ] {
                assert_eq!(launch_path(Path::new(value)), PathBuf::from(value));
            }
            // Even an unpaired Windows UTF-16 code unit is preserved exactly.
            use std::ffi::OsString;
            use std::os::windows::ffi::{OsStrExt, OsStringExt};
            let raw = [92_u16, 92, 63, 92, 67, 58, 92, 0xd800, 92, 72];
            let input = PathBuf::from(OsString::from_wide(&raw));
            assert_eq!(
                launch_path(&input)
                    .as_os_str()
                    .encode_wide()
                    .collect::<Vec<_>>(),
                raw[4..]
            );
        }

        #[test]
        fn protected_pipe_accepts_current_user_and_checks_real_peer_executable() {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime");
            runtime.block_on(async {
                let name = format!("HushMigration-{}", Uuid::new_v4());
                let server = create_pipe(&name).expect("current-user protected pipe");
                assert!(
                    create_pipe(&name).is_err(),
                    "a second first-instance pipe must fail"
                );
                let client = ClientOptions::new()
                    .open(format!(r"\\.\pipe\{name}"))
                    .expect("current user client");
                server.connect().await.expect("connect current user");
                let expected =
                    std::fs::canonicalize(std::env::current_exe().expect("test executable"))
                        .expect("canonical executable");
                verify_client(&server, &expected).expect("actual client executable matches");
                assert!(verify_client(&server, Path::new(r"C:\unrelated\Hush.exe")).is_err());
                drop(client);
            });
        }

        #[test]
        fn pipe_decoder_limits_unterminated_and_truncated_lines() {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime");
            runtime.block_on(async {
                let large = vec![b'x'; MAX_LINE_BYTES + 1];
                assert!(read_message(&mut BufReader::new(&large[..])).await.is_err());
                assert!(
                    read_message(&mut BufReader::new(&b"{\"kind\":\"cancel\"}"[..]))
                        .await
                        .is_err()
                );
                let lines = b"{\"kind\":\"cancel\"}\n{\"kind\":\"complete\"}\n";
                let mut reader = BufReader::new(&lines[..]);
                assert_eq!(
                    read_message(&mut reader).await.expect("first line"),
                    Some(json!({"kind":"cancel"}))
                );
                assert_eq!(
                    read_message(&mut reader).await.expect("second line"),
                    Some(json!({"kind":"complete"}))
                );
                assert!(read_message(&mut reader).await.expect("EOF").is_none());
            });
        }

        #[test]
        fn marker_requires_fixed_profile_existing_local_hush_and_bounded_metadata() {
            let directory = tempfile::tempdir().expect("test directory");
            let profile = directory.path().join("profile");
            std::fs::create_dir(&profile).expect("profile");
            let executable = directory.path().join("Hush.exe");
            std::fs::write(&executable, b"fixture executable metadata").expect("executable");
            let path = directory.path().join("migration-ready.json");
            let mut value = json!({"protocolVersion":1,"version":"0.5.66","executablePath":executable,"profilePath":profile});
            std::fs::write(&path, value.to_string()).expect("marker");
            assert!(marker(&path, &profile).is_some());
            assert!(marker(&path, directory.path()).is_none());
            value["executablePath"] = json!(r"\\server\share\Hush.exe");
            std::fs::write(&path, value.to_string()).expect("UNC marker");
            assert!(marker(&path, &profile).is_none());
            value["executablePath"] = json!(r"C:relative\Hush.exe");
            std::fs::write(&path, value.to_string()).expect("relative marker");
            assert!(marker(&path, &profile).is_none());
            std::fs::write(&path, vec![b' '; MAX_MARKER_BYTES as usize + 1])
                .expect("oversized marker");
            assert!(marker(&path, &profile).is_none());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello(now: u64) -> Value {
        json!({"version":1,"id":Uuid::new_v4().to_string(),"challenge":"a".repeat(43),"expiresAt":now+1000,
            "publicKey":{"kty":"EC","crv":"P-256","x":"a".repeat(43),"y":"b".repeat(43)}})
    }

    fn frame(id: &str, sequence: u64) -> Value {
        json!({"kind":"frame","frame":{"version":1,"transferId":id,"sequence":sequence,
            "nonce":"a".repeat(16),"ciphertext":"a".repeat(24)}})
    }

    #[test]
    fn handshakes_are_short_lived_public_and_bound_to_one_transfer() {
        let now = 1_800_000_000_000;
        let mut value = hello(now);
        assert!(valid_hello(&value, now).is_ok());
        value["expiresAt"] = json!(now);
        assert!(valid_hello(&value, now).is_err());
        value["expiresAt"] = json!(now + 302_000);
        assert!(valid_hello(&value, now).is_err());
        value = hello(now);
        value["publicKey"]["d"] = json!("private-key-must-not-cross-native");
        assert!(valid_hello(&value, now).is_err());
    }

    #[test]
    fn opaque_frames_reject_replay_wrong_transfer_plaintext_and_oversized_data() {
        let id = Uuid::new_v4().to_string();
        let mut value = frame(&id, 0);
        assert!(valid_frame_message(&value, &id, Some(0)).is_ok());
        assert!(valid_frame_message(&value, &id, Some(1)).is_err());
        assert!(valid_frame_message(&value, "another-transfer", None).is_err());
        value["session"] = json!("plaintext-must-not-be-forwarded");
        assert!(valid_frame_message(&value, &id, Some(0)).is_err());
        value = frame(&id, 0);
        value["frame"]["ciphertext"] = json!("a".repeat(MAX_LINE_BYTES));
        assert!(valid_frame_message(&value, &id, Some(0)).is_err());
        assert!(bounded_line(&json!({"oversized":"a".repeat(MAX_LINE_BYTES)})).is_err());
    }
}
