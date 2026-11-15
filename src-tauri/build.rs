fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "native_version",
        "native_migration_has_source",
        "native_migration_source_status",
        "native_migration_begin",
        "native_migration_send",
        "native_migration_finish",
        "native_set_call_active",
        "native_get_memory_status",
        "native_updates_get_status",
        "native_updates_check",
        "native_updates_install",
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
