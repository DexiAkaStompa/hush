//! Streaming attachment saves. Paths come only from the native save dialog;
//! renderer requests identify a transfer with an opaque token instead.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

use tempfile::{Builder, NamedTempFile};
use thiserror::Error;
use uuid::Uuid;

pub const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum DownloadError {
    #[error("Un download è già in corso.")]
    AlreadyActive,
    #[error("Download non valido o non autorizzato.")]
    InvalidTransfer,
    #[error("Blocco download non valido. Il download è stato annullato.")]
    InvalidChunk,
    #[error("La destinazione del download non è valida.")]
    InvalidDestination,
    #[error("Impossibile salvare il download.")]
    Io(#[from] std::io::Error),
}

struct Transfer {
    owner: String,
    destination: PathBuf,
    file: NamedTempFile,
    next_index: u64,
}

/// Keep behind a mutex and perform file operations on a blocking worker. A
/// transfer owns only its open file, path and index, never accumulated chunks.
#[derive(Default)]
pub struct DownloadManager {
    transfers: HashMap<String, Transfer>,
}

impl DownloadManager {
    /// `destination` must be the absolute path returned by a native save dialog,
    /// never a renderer-provided path. A sibling temporary file keeps replacement
    /// on the same filesystem and leaves any existing destination untouched until
    /// all ordered chunks have been written and synced successfully.
    pub fn begin(&mut self, owner: &str, destination: PathBuf) -> Result<String, DownloadError> {
        if self
            .transfers
            .values()
            .any(|transfer| transfer.owner == owner)
        {
            return Err(DownloadError::AlreadyActive);
        }
        if !destination.is_absolute() || destination.file_name().is_none() || destination.is_dir() {
            return Err(DownloadError::InvalidDestination);
        }
        let directory = destination
            .parent()
            .ok_or(DownloadError::InvalidDestination)?;
        let file = Builder::new()
            .prefix(".hush-")
            .suffix(".part")
            .tempfile_in(directory)?;
        let token = Uuid::new_v4().to_string();
        self.transfers.insert(
            token.clone(),
            Transfer {
                owner: owner.to_owned(),
                destination,
                file,
                next_index: 0,
            },
        );
        Ok(token)
    }

    pub fn write(
        &mut self,
        owner: &str,
        token: &str,
        index: u64,
        bytes: &[u8],
    ) -> Result<(), DownloadError> {
        self.ensure_owner(owner, token)?;
        let result = self.write_owned(token, index, bytes);
        if result.is_err() {
            // A rejected sequence or a partially written disk block must never
            // be followed by a successful finish of an incomplete attachment.
            self.transfers.remove(token);
        }
        result
    }

    fn write_owned(&mut self, token: &str, index: u64, bytes: &[u8]) -> Result<(), DownloadError> {
        let transfer = self
            .transfers
            .get_mut(token)
            .ok_or(DownloadError::InvalidTransfer)?;
        if bytes.len() > MAX_CHUNK_BYTES || index != transfer.next_index {
            return Err(DownloadError::InvalidChunk);
        }
        let next_index = transfer
            .next_index
            .checked_add(1)
            .ok_or(DownloadError::InvalidChunk)?;
        transfer.file.as_file_mut().write_all(bytes)?;
        transfer.next_index = next_index;
        Ok(())
    }

    pub fn finish(&mut self, owner: &str, token: &str) -> Result<(), DownloadError> {
        self.ensure_owner(owner, token)?;
        let mut transfer = self
            .transfers
            .remove(token)
            .ok_or(DownloadError::InvalidTransfer)?;
        // Remove first: all errors invalidate the token and dropping the
        // NamedTempFile removes the unfinished file.
        transfer.file.as_file_mut().flush()?;
        transfer.file.as_file().sync_all()?;
        transfer
            .file
            .persist(&transfer.destination)
            .map_err(|error| DownloadError::Io(error.error))?;
        Ok(())
    }

    pub fn abort(&mut self, owner: &str, token: &str) -> Result<(), DownloadError> {
        self.ensure_owner(owner, token)?;
        let transfer = self
            .transfers
            .remove(token)
            .ok_or(DownloadError::InvalidTransfer)?;
        transfer.file.close()?;
        Ok(())
    }

    /// Called on window destruction. Dropping the manager also removes every
    /// unfinished temporary file, including during ordinary application exit.
    pub fn abort_owner(&mut self, owner: &str) {
        self.transfers.retain(|_, transfer| transfer.owner != owner);
    }

    fn ensure_owner(&self, owner: &str, token: &str) -> Result<(), DownloadError> {
        match self.transfers.get(token) {
            Some(transfer) if transfer.owner == owner => Ok(()),
            _ => Err(DownloadError::InvalidTransfer),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{DownloadError, DownloadManager, MAX_CHUNK_BYTES};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn saves_ordered_chunks_and_only_replaces_destination_on_finish() {
        let directory = tempdir().expect("temporary directory");
        let destination = directory.path().join("allegato.bin");
        fs::write(&destination, b"original").expect("existing attachment");
        let mut downloads = DownloadManager::default();
        let token = downloads
            .begin("main", destination.clone())
            .expect("begin save");
        downloads
            .write("main", &token, 0, b"first")
            .expect("first chunk");
        downloads
            .write("main", &token, 1, b"second")
            .expect("second chunk");
        assert_eq!(fs::read(&destination).expect("read original"), b"original");
        downloads.finish("main", &token).expect("commit attachment");
        assert_eq!(
            fs::read(&destination).expect("read attachment"),
            b"firstsecond"
        );
        assert_eq!(
            fs::read_dir(directory.path()).expect("list files").count(),
            1
        );
        assert!(matches!(
            downloads.finish("main", &token),
            Err(DownloadError::InvalidTransfer)
        ));
    }

    #[test]
    fn rejects_other_owners_without_disrupting_a_valid_transfer() {
        let directory = tempdir().expect("temporary directory");
        let destination = directory.path().join("private.bin");
        let mut downloads = DownloadManager::default();
        let token = downloads
            .begin("main", destination.clone())
            .expect("begin save");
        assert!(matches!(
            downloads.write("other", &token, 0, b"wrong"),
            Err(DownloadError::InvalidTransfer)
        ));
        assert!(matches!(
            downloads.abort("other", &token),
            Err(DownloadError::InvalidTransfer)
        ));
        assert!(matches!(
            downloads.finish("other", &token),
            Err(DownloadError::InvalidTransfer)
        ));
        downloads
            .write("main", &token, 0, b"right")
            .expect("owned chunk");
        downloads.finish("main", &token).expect("finish own save");
        assert_eq!(fs::read(destination).expect("saved attachment"), b"right");
    }

    #[test]
    fn failed_sequence_invalidates_token_and_preserves_existing_file() {
        let directory = tempdir().expect("temporary directory");
        let destination = directory.path().join("existing.bin");
        fs::write(&destination, b"original").expect("existing attachment");
        let mut downloads = DownloadManager::default();
        let token = downloads
            .begin("main", destination.clone())
            .expect("begin save");
        downloads
            .write("main", &token, 0, b"partial")
            .expect("first chunk");
        assert!(matches!(
            downloads.write("main", &token, 2, b"gap"),
            Err(DownloadError::InvalidChunk)
        ));
        assert!(matches!(
            downloads.finish("main", &token),
            Err(DownloadError::InvalidTransfer)
        ));
        assert_eq!(
            fs::read(destination).expect("original attachment"),
            b"original"
        );
        assert_eq!(
            fs::read_dir(directory.path()).expect("list files").count(),
            1
        );
    }

    #[test]
    fn refuses_oversized_chunks_but_accepts_the_exact_limit() {
        let directory = tempdir().expect("temporary directory");
        let mut downloads = DownloadManager::default();
        let destination = directory.path().join("large.bin");
        let token = downloads
            .begin("main", destination.clone())
            .expect("begin save");
        let bytes = vec![17; MAX_CHUNK_BYTES + 1];
        downloads
            .write("main", &token, 0, &bytes[..MAX_CHUNK_BYTES])
            .expect("maximum chunk");
        assert!(matches!(
            downloads.write("main", &token, 1, &bytes),
            Err(DownloadError::InvalidChunk)
        ));
        assert!(matches!(
            downloads.finish("main", &token),
            Err(DownloadError::InvalidTransfer)
        ));
        assert!(!destination.exists());
        assert_eq!(
            fs::read_dir(directory.path()).expect("list files").count(),
            0
        );
    }

    #[test]
    fn permits_one_active_save_per_owner_and_releases_it_after_abort() {
        let directory = tempdir().expect("temporary directory");
        let mut downloads = DownloadManager::default();
        let token = downloads
            .begin("main", directory.path().join("one.bin"))
            .expect("first save");
        assert!(matches!(
            downloads.begin("main", directory.path().join("two.bin")),
            Err(DownloadError::AlreadyActive)
        ));
        let other = downloads
            .begin("other", directory.path().join("other.bin"))
            .expect("other owner's save");
        downloads.abort("main", &token).expect("abort own save");
        let next = downloads
            .begin("main", directory.path().join("two.bin"))
            .expect("new save after abort");
        assert_ne!(token, next);
        downloads.abort_owner("main");
        assert!(matches!(
            downloads.write("main", &next, 0, b"late"),
            Err(DownloadError::InvalidTransfer)
        ));
        downloads
            .write("other", &other, 0, b"other")
            .expect("other save survives");
        downloads
            .finish("other", &other)
            .expect("finish other save");
        assert_eq!(
            fs::read_dir(directory.path()).expect("list files").count(),
            1
        );
    }

    #[test]
    fn dropping_manager_cleans_partial_files_and_never_changes_destination() {
        let directory = tempdir().expect("temporary directory");
        let destination = directory.path().join("existing.bin");
        fs::write(&destination, b"original").expect("existing attachment");
        {
            let mut downloads = DownloadManager::default();
            let token = downloads
                .begin("main", destination.clone())
                .expect("begin save");
            downloads
                .write("main", &token, 0, b"unfinished")
                .expect("partial chunk");
            assert_eq!(
                fs::read_dir(directory.path()).expect("list files").count(),
                2
            );
        }
        assert_eq!(
            fs::read(destination).expect("original attachment"),
            b"original"
        );
        assert_eq!(
            fs::read_dir(directory.path()).expect("list files").count(),
            1
        );
    }

    #[test]
    fn failed_commit_removes_temporary_file_and_invalidates_the_transfer() {
        let directory = tempdir().expect("temporary directory");
        let destination = directory.path().join("new-directory");
        let mut downloads = DownloadManager::default();
        let token = downloads
            .begin("main", destination.clone())
            .expect("begin save");
        downloads
            .write("main", &token, 0, b"attachment")
            .expect("chunk");
        fs::create_dir(&destination).expect("destination became a directory");
        assert!(matches!(
            downloads.finish("main", &token),
            Err(DownloadError::Io(_))
        ));
        assert!(destination.is_dir());
        assert!(matches!(
            downloads.finish("main", &token),
            Err(DownloadError::InvalidTransfer)
        ));
        assert_eq!(
            fs::read_dir(directory.path()).expect("list files").count(),
            1
        );
    }

    #[test]
    fn disk_write_failure_cannot_be_finished_as_a_partial_attachment() {
        let directory = tempdir().expect("temporary directory");
        let destination = directory.path().join("existing.bin");
        fs::write(&destination, b"original").expect("existing attachment");
        let mut downloads = DownloadManager::default();
        let token = downloads
            .begin("main", destination.clone())
            .expect("begin save");
        downloads
            .write("main", &token, 0, b"partial")
            .expect("first chunk");

        // Inject a genuine I/O failure by replacing the open temporary file
        // handle with a read-only handle to the same file.
        let mut transfer = downloads.transfers.remove(&token).expect("active transfer");
        let (file, temporary_path) = transfer.file.into_parts();
        drop(file);
        let read_only = fs::OpenOptions::new()
            .read(true)
            .open(&temporary_path)
            .expect("read-only temporary file");
        transfer.file = tempfile::NamedTempFile::from_parts(read_only, temporary_path);
        downloads.transfers.insert(token.clone(), transfer);

        assert!(matches!(
            downloads.write("main", &token, 1, b"more"),
            Err(DownloadError::Io(_))
        ));
        assert!(matches!(
            downloads.finish("main", &token),
            Err(DownloadError::InvalidTransfer)
        ));
        assert_eq!(
            fs::read(destination).expect("original attachment"),
            b"original"
        );
        assert_eq!(
            fs::read_dir(directory.path()).expect("list files").count(),
            1
        );
    }

    #[test]
    fn supports_empty_attachments_and_rejects_relative_or_directory_targets() {
        let directory = tempdir().expect("temporary directory");
        let mut downloads = DownloadManager::default();
        assert!(matches!(
            downloads.begin("main", "relative.bin".into()),
            Err(DownloadError::InvalidDestination)
        ));
        assert!(matches!(
            downloads.begin("main", directory.path().to_path_buf()),
            Err(DownloadError::InvalidDestination)
        ));
        let destination = directory.path().join("empty.bin");
        let token = downloads
            .begin("main", destination.clone())
            .expect("begin empty save");
        downloads.finish("main", &token).expect("finish empty save");
        assert_eq!(
            fs::metadata(destination).expect("saved attachment").len(),
            0
        );
    }
}
