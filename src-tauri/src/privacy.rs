//! Serialize notification publication with locking, so a pending Toast cannot reappear after lock.
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{AppHandle, Manager, WebviewWindow};
pub static NOTIFICATION_GATE: Mutex<bool> = Mutex::new(false);
static CAPTURE: AtomicBool = AtomicBool::new(false);
pub fn capture_enabled() -> bool { CAPTURE.load(Ordering::SeqCst) }
#[tauri::command]
pub fn set_privacy(app: AppHandle, window: WebviewWindow, locked: bool, capture: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("安全设置来源无效".into()); }
    let mut gate = NOTIFICATION_GATE.lock().map_err(|_| "通知锁定状态不可用")?;
    *gate = locked;
    if locked { crate::notifications::clear(); }
    CAPTURE.store(capture, Ordering::SeqCst);
    for (_, win) in app.webview_windows() {
        win.set_content_protected(capture).map_err(|e| e.to_string())?;
        if locked && win.label() == "ai-reply" { let _ = win.hide(); }
    }
    Ok(())
}

/// A reduced WebView memory target keeps background Bots running. Unsupported runtimes fall back safely.
pub fn reduce_webview_memory(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    let _ = window.with_webview(|webview| unsafe {
        use windows_core::Interface;
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW};
        if let Ok(core) = webview.controller().CoreWebView2() {
            if let Ok(v19) = core.cast::<ICoreWebView2_19>() { let _ = v19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW); }
        }
    });
    #[cfg(not(windows))]
    let _ = window;
}
