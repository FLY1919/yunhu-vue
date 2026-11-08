//! Detached editor: all authenticated operations stay in the main window.
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
pub async fn open_community_editor(app: AppHandle, window: WebviewWindow, session_id: String) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main window can open the editor".into()); }
    if session_id.is_empty() || session_id.len() > 80 || !session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { return Err("Invalid editor session".into()); }
    if *crate::privacy::NOTIFICATION_GATE.lock().map_err(|_| "锁定状态不可用")? { return Err("请先解锁".into()); }
    let url = format!("http://127.0.0.1:{}/?community-editor={}", super::app_port(), session_id).parse::<tauri::Url>().map_err(|e| e.to_string())?;
    if let Some(old) = app.get_webview_window("community-editor") { old.destroy().map_err(|e| e.to_string())?; }
    let panel = WebviewWindowBuilder::new(&app, "community-editor", WebviewUrl::External(url))
        .title("YH LaoDa · 文章编辑器").inner_size(1100.0, 800.0).min_inner_size(420.0, 500.0)
        .content_protected(crate::privacy::capture_enabled())
        .on_navigation(|url| url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port_or_known_default() == Some(super::app_port()))
        .build().map_err(|e| e.to_string())?;
    crate::privacy::reduce_webview_memory(&panel);
    let handle = app.clone();
    panel.on_window_event(move |event| { if matches!(event, tauri::WindowEvent::Destroyed) { let _ = handle.emit_to("main", "community-editor-closed", ()); } });
    panel.show().map_err(|e| e.to_string())?; panel.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_community_editor(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main window can close the editor".into()); }
    if let Some(panel) = app.get_webview_window("community-editor") { panel.close().map_err(|e| e.to_string())?; }
    Ok(())
}
