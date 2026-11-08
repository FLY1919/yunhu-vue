fn main() {
    // 页面来自 Node sidecar 的 HTTP 地址，自定义命令也必须有显式 ACL 权限。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "restart_sidecar",
            "set_privacy",
            "open_external_url",
            "reset_media_permission",
            "native_notifications_supported",
            "show_message_notification",
            "dismiss_message_notification",
            "clear_message_notifications",
            "secure_read",
            "secure_write",
            "secure_delete",
            "ai_bridge_token",
            "open_ai_panel",
            "close_ai_panel",
            "ai_panel_action",
            "open_community_editor",
            "close_community_editor",
            "open_chat_window",
            "close_chat_windows",
            "close_current_chat_window",
        ])),
    )
    .expect("failed to build Tauri application permissions");
}
