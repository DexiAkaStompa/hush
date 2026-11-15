fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "native_version",
        "native_pending_link",
        "native_copy_text",
        "native_set_material",
        "native_search_music",
        "native_show_notification",
        "native_call_relay",
        "attachment_save_begin",
        "attachment_save_write",
        "attachment_save_finish",
        "attachment_save_abort",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to generate desktop permissions and resources");
}
