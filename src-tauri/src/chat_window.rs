//! The main window owns the sidecar and authorizes conversation windows.
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub fn close_all(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("chat-window-") {
            let _ = window.destroy();
        }
    }
}

#[tauri::command]
pub async fn open_chat_window(
    app: AppHandle,
    window: WebviewWindow,
    chat_type: u8,
    chat_id: String,
    title: String,
    session_id: String,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("仅主窗口可以分离会话".into());
    }
    if !(1..=3).contains(&chat_type)
        || chat_id.is_empty()
        || chat_id.len() > 64
        || !chat_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || session_id.len() != 36
        || !session_id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err("无效的会话".into());
    }
    if *crate::privacy::NOTIFICATION_GATE.lock().map_err(|_| "锁定状态不可用")? {
        return Err("请先解锁".into());
    }
    let label = format!("chat-window-{chat_type}-{chat_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        existing.unminimize().map_err(|e| e.to_string())?;
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(false);
    }
    let url = format!("http://127.0.0.1:{}/?chat-window#{}", crate::app_port(), session_id)
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let title: String = title.chars().filter(|c| !c.is_control()).take(96).collect();
    let child = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title(format!("{title} · YH LaoDa"))
        .inner_size(750.0, 670.0)
        .min_inner_size(380.0, 380.0)
        .content_protected(crate::privacy::capture_enabled())
        .on_navigation(|url| {
            url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
                && url.port_or_known_default() == Some(crate::app_port())
                && url.path() == "/" && url.query() == Some("chat-window")
        })
        .build()
        .map_err(|e| e.to_string())?;
    crate::privacy::reduce_webview_memory(&child);
    let handle = app.clone();
    child.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = handle.emit_to("main", "chat-window-closed", &session_id);
        }
    });
    // A lock can be requested while the WebView is being created.
    if *crate::privacy::NOTIFICATION_GATE.lock().map_err(|_| "锁定状态不可用")? {
        let _ = child.destroy();
        return Err("请先解锁".into());
    }
    Ok(true)
}

#[tauri::command]
pub fn close_chat_windows(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("无效的窗口".into());
    }
    close_all(&app);
    Ok(())
}

#[tauri::command]
pub fn close_current_chat_window(window: WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("chat-window-") {
        return Err("无效的会话窗口".into());
    }
    window.destroy().map_err(|e| e.to_string())
}
