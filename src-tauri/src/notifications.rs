//! Windows 10/11 原生 WinRT Toast；只处理运行中客户端的消息通知。
//! 不通过 PowerShell 弹窗，不使用浏览器 Notification 冒充 Windows 通知。
#[cfg(windows)]
#[path = "notification_policy.rs"]
mod policy;
#[cfg(windows)]
mod platform {
    use super::policy;
    use base64::Engine;
    use std::{collections::HashMap, sync::{Mutex, OnceLock}};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::{
        core::{HSTRING, IInspectable, Interface, PROPVARIANT},
        Data::Xml::Dom::XmlDocument,
        Foundation::TypedEventHandler,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
        Win32::{
            Foundation::RPC_E_CHANGED_MODE,
            Storage::EnhancedStorage::PKEY_AppUserModel_ID,
            System::{Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER,
                StructuredStorage::{PropVariantChangeType, PVCHF_DEFAULT}},
                Variant::VT_LPWSTR, WinRT::{RoInitialize, RoUninitialize, RO_INIT_SINGLETHREADED}},
            UI::Shell::{IShellLinkW, ShellLink, SetCurrentProcessExplicitAppUserModelID,
                SHChangeNotify, SHCNE_CREATE, SHCNE_UPDATEITEM, SHCNF_PATHW, SHCNF_FLUSHNOWAIT,
                PropertiesSystem::IPropertyStore},
        },
    };
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    const APP_ID: &str = "com.richkobe.yunhulaoda";
    const GROUP: &str = "messages";
    static TOASTS: OnceLock<Mutex<HashMap<String, ToastNotification>>> = OnceLock::new();
    fn toasts() -> &'static Mutex<HashMap<String, ToastNotification>> {
        TOASTS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    struct ComGuard(bool);
    impl ComGuard {
        fn enter() -> Result<Self, String> {
            match unsafe { RoInitialize(RO_INIT_SINGLETHREADED) } {
                Ok(()) => Ok(Self(true)),
                Err(error) if error.code() == RPC_E_CHANGED_MODE => Ok(Self(false)),
                Err(error) => Err(error.to_string()),
            }
        }
    }
    impl Drop for ComGuard {
        fn drop(&mut self) { if self.0 { unsafe { RoUninitialize(); } } }
    }

    // 安装版与便携版共用同一应用身份。只写当前用户，不需要管理员权限。
    fn register(force: bool) -> Result<(), String> {
        static REGISTERED: Mutex<bool> = Mutex::new(false);
        let mut registered = REGISTERED.lock().map_err(|_| "通知注册状态不可用")?;
        if *registered && !force { return Ok(()); }
        let first_registration = !*registered;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(format!(r"Software\Classes\AppUserModelId\{APP_ID}"))
            .map_err(|e| e.to_string())?;
        key.set_value("DisplayName", &"云湖牢大版").map_err(|e| e.to_string())?;
        let icon_dir = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("APPDATA"))
            .ok_or("无法读取用户应用目录")?;
        let icon_dir = std::path::PathBuf::from(icon_dir).join("YunhuLaoda");
        std::fs::create_dir_all(&icon_dir).map_err(|e| e.to_string())?;
        let icon = icon_dir.join("notification-icon.png");
        std::fs::write(&icon, include_bytes!("../icons/icon.png")).map_err(|e| e.to_string())?;
        key.set_value("IconUri", &icon.to_string_lossy().as_ref()).map_err(|e| e.to_string())?;
        // Win32 Toast 还需要开始菜单快捷方式上的 AUMID。便携版也补齐此身份。
        let programs = std::env::var_os("APPDATA").ok_or("无法读取用户应用目录")?;
        let shortcut = std::path::PathBuf::from(programs)
            .join(r"Microsoft\Windows\Start Menu\Programs\云湖牢大版.lnk");
        let shortcut_existed = shortcut.exists();
        if let Some(parent) = shortcut.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| format!("创建通知快捷方式失败：{e}"))?;
            link.SetPath(&HSTRING::from(exe.as_path())).map_err(|e| format!("设置通知快捷方式路径失败：{e}"))?;
            link.SetDescription(&HSTRING::from("云湖牢大版")).map_err(|e| e.to_string())?;
            link.SetIconLocation(&HSTRING::from(exe.as_path()), 0).map_err(|e| e.to_string())?;
            if let Some(parent) = exe.parent() {
                link.SetWorkingDirectory(&HSTRING::from(parent)).map_err(|e| e.to_string())?;
            }
            let props: IPropertyStore = link.cast().map_err(|e| e.to_string())?;
            // windows-core 0.58 的 From<&str> 生成 VT_BSTR；Shell 的
            // System.AppUserModel.ID 必须是 VT_LPWSTR，否则 SetValue 可返回 E_INVALIDARG。
            let source = PROPVARIANT::from(APP_ID);
            let mut app_id = PROPVARIANT::new();
            PropVariantChangeType(&mut app_id, &source, PVCHF_DEFAULT, VT_LPWSTR)
                .map_err(|e| format!("转换通知应用标识失败：{e}"))?;
            props.SetValue(&PKEY_AppUserModel_ID, &app_id)
                .map_err(|e| format!("写入通知快捷方式标识失败：{e}"))?;
            props.Commit().map_err(|e| format!("提交通知快捷方式属性失败：{e}"))?;
            let file: IPersistFile = link.cast().map_err(|e| e.to_string())?;
            file.Save(&HSTRING::from(shortcut.as_path()), true).map_err(|e| format!("保存通知快捷方式失败：{e}"))?;
            // Save 写入磁盘后通知 Shell；不依赖 Explorer 恰好已扫描到新 AUMID。
            let shortcut_path = HSTRING::from(shortcut.as_path());
            SHChangeNotify(if shortcut_existed { SHCNE_UPDATEITEM } else { SHCNE_CREATE },
                SHCNF_PATHW | SHCNF_FLUSHNOWAIT, Some(shortcut_path.as_ptr().cast()), None);
        }
        // 上次进程退出后已无法点击定位的旧通知不继续留在通知中心。
        if first_registration {
            if let Ok(history) = ToastNotificationManager::History() {
                let _ = history.RemoveGroupWithId(&HSTRING::from(GROUP), &HSTRING::from(APP_ID));
            }
        }
        *registered = true;
        Ok(())
    }

    pub fn set_process_identity() -> Result<(), String> {
        unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(APP_ID)) }
            .map_err(|e| format!("设置进程通知身份失败：{e}"))
    }

    pub fn initialize() -> Result<(), String> {
        let _com = ComGuard::enter()?;
        register(false)
    }

    struct DeliveryError { code: Option<i32>, message: String }
    fn delivery_error(stage: &str, error: windows::core::Error) -> DeliveryError {
        DeliveryError { code: Some(error.code().0), message: format!("{stage}失败：{error}") }
    }

    fn deliver(toast: &ToastNotification) -> Result<(), String> {
        policy::with_identity_repair(|| {
            let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))
                .map_err(|e| delivery_error("创建 Toast 通知器", e))?;
            // 对未打包的 Win32 应用，Setting 可能在首次通知前抛 ERROR_NOT_FOUND。
            // 此时继续执行真正的 Show；其他错误与明确的系统禁用状态仍原样处理。
            let setting = notifier.Setting().map(|v| v.0).map_err(|e| e.code().0);
            match policy::setting_may_send(setting) {
                Ok(true) => {},
                Ok(false) => return Err(DeliveryError { code: None,
                    message: "Windows 已关闭或通过策略禁用系统通知，请检查 Windows 通知设置".into() }),
                Err(code) => return Err(DeliveryError { code: Some(code),
                    message: format!("读取 Windows 通知设置失败（HRESULT 0x{:08X}）", code as u32) }),
            }
            notifier.Show(toast).map_err(|e| delivery_error("发送 Toast", e))
        }, || register(true).map_err(|message| DeliveryError { code: None, message }),
            |error| error.code == Some(policy::IDENTITY_NOT_FOUND))
            .map_err(|error| error.message)
    }

    fn xml_text(text: &str, limit: usize) -> String {
        text.chars().filter(|c| matches!(*c, '\n' | '\r' | '\t') || (*c >= ' ' && !matches!(*c, '\u{fffe}' | '\u{ffff}')))
            .take(limit).collect::<String>()
            .replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }

    pub fn show(app: AppHandle, id: String, title: String, body: String, avatar: Option<String>) -> Result<(), String> {
        if id.is_empty() || id.len() > 16 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return Err("通知标识无效".into());
        }
        let _com = ComGuard::enter()?;
        register(false)?;
        let icon_path = avatar_path(&id);
        let mut icon_uri = None;
        if let Some(encoded) = avatar.as_deref().and_then(|s| s.strip_prefix("data:image/png;base64,")) {
            if encoded.len() <= 180_000 {
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) {
                    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                        if let Some(path) = icon_path.as_ref() {
                            if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
                            if std::fs::write(path, bytes).is_ok() { icon_uri = tauri::Url::from_file_path(path).ok().map(|u| u.to_string()); }
                        }
                    }
                }
            }
        }
        let image = icon_uri.map(|uri| format!("<image placement=\"appLogoOverride\" hint-crop=\"circle\" src=\"{}\"/>",
            xml_text(&uri, 2048).replace('"', "&quot;").replace('\'', "&apos;"))).unwrap_or_default();
        let xml = XmlDocument::new().map_err(|e| format!("创建 Toast XML 文档失败：{e}"))?;
        xml.LoadXml(&HSTRING::from(format!(
            "<toast><visual><binding template=\"ToastGeneric\">{}<text>{}</text><text>{}</text></binding></visual></toast>",
            image, xml_text(&title, 120), xml_text(&body, 500)
        ))).map_err(|e| format!("加载 Toast XML 失败：{e}"))?;
        let toast = ToastNotification::CreateToastNotification(&xml).map_err(|e| format!("创建 Toast 失败：{e}"))?;
        toast.SetTag(&HSTRING::from(&id)).map_err(|e| format!("设置 Toast 标识失败：{e}"))?;
        toast.SetGroup(&HSTRING::from(GROUP)).map_err(|e| format!("设置 Toast 分组失败：{e}"))?;
        let clicked_id = id.clone();
        let clicked_app = app.clone();
        toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
            // 已被静音/退出登录/切换模式清掉的旧通知不能再激活。
            let active = toasts().lock().map(|items| items.contains_key(&clicked_id)).unwrap_or(false);
            if active {
                let handle = clicked_app.clone();
                let id = clicked_id.clone();
                let _ = clicked_app.run_on_main_thread(move || {
                    if !toasts().lock().map(|items| items.contains_key(&id)).unwrap_or(false) { return; }
                    if let Some(win) = handle.get_webview_window("main") {
                        let _ = win.unminimize();
                        let _ = win.show();
                        let _ = win.set_focus();
                        let _ = win.emit("message-notification-activated", id);
                    }
                });
            }
            Ok(())
        })).map_err(|e| e.to_string())?;
        let failed_id = id.clone();
        toast.Failed(&TypedEventHandler::<ToastNotification, windows::UI::Notifications::ToastFailedEventArgs>::new(move |_, args| {
            let error = args.as_ref().and_then(|args| args.ErrorCode().ok())
                .map(|code| format!("Windows 无法显示通知（HRESULT 0x{:08X}）", code.0 as u32))
                .unwrap_or_else(|| "Windows 无法显示通知".into());
            let _ = app.emit_to("main", "message-notification-failed", serde_json::json!({
                "id": failed_id, "error": error
            }));
            Ok(())
        })).map_err(|e| e.to_string())?;
        // 持有 Toast 及其事件回调，保留通知中心中超时横幅的点击能力。
        toasts().lock().map_err(|_| "通知状态不可用")?.insert(id.clone(), toast.clone());
        if let Err(error) = deliver(&toast) {
            let _ = dismiss(&id);
            return Err(error);
        }
        Ok(())
    }

    fn avatar_path(id: &str) -> Option<std::path::PathBuf> {
        // id was validated in show(); dismiss can receive arbitrary frontend input.
        if id.len() > 16 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) { return None; }
        std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from)
            .map(|p| p.join("YunhuLaoda").join("notification-avatars").join(format!("{id}.png")))
    }

    pub fn dismiss(id: &str) -> Result<(), String> {
        let _com = ComGuard::enter()?;
        let toast = toasts().lock().map_err(|_| "通知状态不可用")?.remove(id);
        if let Some(path) = avatar_path(id) { let _ = std::fs::remove_file(path); }
        if let Some(toast) = toast {
            if let Ok(notifier) = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID)) {
                let _ = notifier.Hide(&toast);
            }
            if let Ok(history) = ToastNotificationManager::History() {
                history.RemoveGroupedTagWithId(&HSTRING::from(id), &HSTRING::from(GROUP), &HSTRING::from(APP_ID))
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn clear() {
        let ids = toasts().lock().map(|items| items.keys().cloned().collect::<Vec<_>>()).unwrap_or_default();
        for id in ids { let _ = dismiss(&id); }
    }
}

#[tauri::command]
pub async fn native_notifications_supported() -> Result<bool, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| platform::initialize().map(|()| true))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    { Ok(false) }
}

// Assign the process identity before creating windows. Shell and WinRT work can wait on
// Explorer, so perform registration off the window thread.
pub fn initialize() {
    #[cfg(windows)]
    {
        if let Err(error) = platform::set_process_identity() {
            eprintln!("[notifications] {error}");
        }
        tauri::async_runtime::spawn_blocking(|| {
            if let Err(error) = platform::initialize() {
                eprintln!("[notifications] {error}");
            }
        });
    }
}

#[tauri::command]
pub fn show_message_notification(window: tauri::WebviewWindow, id: String, title: String, body: String, avatar: Option<String>) -> Result<(), String> {
    if window.label() != "main" { return Err("通知来源无效".into()); }
    let locked = crate::privacy::NOTIFICATION_GATE.lock().map_err(|_| "通知锁定状态不可用")?;
    if *locked { return Ok(()); }
    #[cfg(windows)]
    { use tauri::Manager; platform::show(window.app_handle().clone(), id, title, body, avatar) }
    #[cfg(not(windows))]
    { let _ = (id, title, body, avatar); Err("仅 Windows 桌面版支持系统通知".into()) }
}

#[tauri::command]
pub fn dismiss_message_notification(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    if window.label() != "main" { return Err("通知来源无效".into()); }
    #[cfg(windows)]
    { platform::dismiss(&id) }
    #[cfg(not(windows))]
    { let _ = id; Ok(()) }
}

#[tauri::command]
pub fn clear_message_notifications(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("通知来源无效".into()); }
    clear();
    Ok(())
}

pub fn clear() {
    #[cfg(windows)]
    platform::clear();
}
