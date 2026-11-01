//! A view of the main window's AI assistant. No account vault or AI bridge permissions.
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
pub async fn open_ai_panel(app: AppHandle, window: WebviewWindow, session_id: String, view_id: String, x: Option<f64>, y: Option<f64>, drag: Option<bool>) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main window can detach the AI panel".into()); }
    if [&session_id, &view_id].iter().any(|id| id.is_empty() || id.len() > 80 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) {
        return Err("Invalid AI panel session".into());
    }
    if *crate::privacy::NOTIFICATION_GATE.lock().map_err(|_| "锁定状态不可用")? { return Err("请先解锁".into()); }
    let url = format!("http://127.0.0.1:{}/?ai-panel={}&ai-view={}", super::app_port(), session_id, view_id).parse::<tauri::Url>().map_err(|e| e.to_string())?;
    if let Some(panel) = app.get_webview_window("ai-reply") {
        if panel.url().ok().as_ref() != Some(&url) {
            panel.navigate(url).map_err(|e| e.to_string())?;
            let handle = app.clone();
            panel.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) { let _ = handle.emit_to("main", "ai-panel-closed", &view_id); }
            });
        }
        panel.show().map_err(|e| e.to_string())?;
        return panel.set_focus().map_err(|e| e.to_string());
    }
    let mut builder = WebviewWindowBuilder::new(&app, "ai-reply", WebviewUrl::External(url))
        .title("YH LaoDa · AI 回复")
        .inner_size(440.0, 610.0).min_inner_size(350.0, 360.0)
        .decorations(false).resizable(true).content_protected(crate::privacy::capture_enabled())
        .on_navigation(|url| url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port_or_known_default() == Some(super::app_port()));
    if let (Some(x), Some(y)) = (x, y) {
        if x.is_finite() && y.is_finite() { builder = builder.position(x, y); }
    }
    let panel = builder.build().map_err(|e| e.to_string())?;
    crate::privacy::reduce_webview_memory(&panel);
    let handle = app.clone();
    panel.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) { let _ = handle.emit_to("main", "ai-panel-closed", &view_id); }
    });
    panel.show().map_err(|e| e.to_string())?;
    panel.set_focus().map_err(|e| e.to_string())?;
    if drag == Some(true) { let _ = panel.start_dragging(); }
    Ok(())
}

#[tauri::command]
pub async fn close_ai_panel(app: AppHandle, window: WebviewWindow, focus: Option<bool>) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main window can dock the AI panel".into()); }
    if let Some(panel) = app.get_webview_window("ai-reply") { panel.close().map_err(|e| e.to_string())?; }
    if focus == Some(true) { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
    Ok(())
}

#[tauri::command]
pub async fn ai_panel_action(window: WebviewWindow, action: String) -> Result<(), String> {
    if window.label() != "ai-reply" { return Err("Invalid AI panel window".into()); }
    let result = match action.as_str() {
        "drag" => window.start_dragging(),
        "minimize" => window.minimize(),
        "close" => window.close(),
        "pin" => window.set_always_on_top(!window.is_always_on_top().unwrap_or(false)),
        _ => return Err("Unsupported AI panel action".into()),
    };
    result.map_err(|e| e.to_string())
}
