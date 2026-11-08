// 云湖牢大版 Tauri 壳：
//   · 启动时拉起 sidecar（resources/node.exe + resources/server-bundle.mjs），
//     环境变量 YH_ROOT 指向资源目录（server 从那里读 dist/config/certs）
//   · 等 127.0.0.1:8902 可连接后创建主窗口加载 http://127.0.0.1:8902
//     （与 Electron 版同模型：前端零改动，全部接口走同源代理）
//   · 托盘图标：左键 show/focus 主窗口，右键弹出菜单（含中文「退出」）
//   · 主窗口销毁 / 托盘「退出」时杀掉 sidecar 子进程
//   · 加固：任何一步失败都不 panic（release 下 panic=abort 会让整个 app 崩），
//     连不上后端时在窗口里显示可读的中文错误页，而不是白屏/闪退。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod notifications;
mod desktop_endpoint;
mod userbot_security;
mod ai_panel;
mod community_editor;
mod chat_window;
mod privacy;

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
static APP_EXITING: AtomicBool = AtomicBool::new(false);
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt as _;

/// CREATE_NO_WINDOW：node.exe 是控制台程序，从 GUI 壳拉起会带一个黑窗口；
/// 隐藏它（日志已落盘 %TEMP%/yunhulaoda-sidecar.log，不靠控制台看输出）
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// sidecar 运行时可执行文件名：Windows 为 node.exe，mac/Linux 为 node
#[cfg(windows)]
const NODE_BIN: &str = "node.exe";
#[cfg(not(windows))]
const NODE_BIN: &str = "node";

// 隐藏 sidecar 控制台窗口：CREATE_NO_WINDOW 是 Windows 专属 API，
// mac/Linux 上无控制台窗口概念，直接原样返回
trait SidecarCmdExt {
    fn hide_console(&mut self) -> &mut Self;
}
impl SidecarCmdExt for Command {
    #[cfg(windows)]
    fn hide_console(&mut self) -> &mut Self {
        self.creation_flags(CREATE_NO_WINDOW)
    }
    #[cfg(not(windows))]
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

fn app_port() -> u16 {
    static VALUE: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
    *VALUE.get_or_init(|| {
        // Keep the same WebView origin on later launches, preserving local preferences.
        #[cfg(windows)]
        let registry = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .create_subkey(r"Software\YunhuLaoda").ok().map(|(key, _)| key);
        #[cfg(windows)]
        let preferred = registry.as_ref().and_then(|key| key.get_value::<u32, _>("DesktopPort").ok())
            .filter(|port| (1024..=65535).contains(port)).unwrap_or(8902) as u16;
        #[cfg(not(windows))]
        let preferred = 8902;
        let selected = desktop_endpoint::select_port(preferred).unwrap_or(preferred);
        #[cfg(windows)]
        if let Some(key) = registry { let _ = key.set_value("DesktopPort", &(selected as u32)); }
        selected
    })
}

/// sidecar 子进程句柄：用全局 static 持有，避开 Tauri State 在
/// on_window_event 闭包里的生命周期问题（E0597）
static SIDECAR: std::sync::OnceLock<Mutex<Option<Child>>> = std::sync::OnceLock::new();
fn sidecar_slot() -> &'static Mutex<Option<Child>> {
    SIDECAR.get_or_init(|| Mutex::new(None))
}

/// 资源目录全局副本：restart_sidecar 命令（错误页「重试」按钮）要用
static DOWNLOADS_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
static RES_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Revert the selected device permission to WebView2's native prompt behavior.
#[tauri::command]
async fn reset_media_permission(window: tauri::WebviewWindow, device: String) -> Result<(), String> {
    let origin = format!("http://127.0.0.1:{}", app_port());
    if window.label() != "main"
        || window.url().map_err(|e| e.to_string())?.origin().ascii_serialization() != origin
    {
        return Err("设备授权来源无效".into());
    }
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_13, ICoreWebView2Profile4, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
        };
        use webview2_com::SetPermissionStateCompletedHandler;
        use windows_core::{HSTRING, Interface};

        let kind = match device.as_str() {
            "camera" => COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            "microphone" => COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            _ => return Err("设备类型无效".into()),
        };
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        window.with_webview(move |webview| unsafe {
            let completion = sender.clone();
            let handler = SetPermissionStateCompletedHandler::create(Box::new(move |result| {
                let _ = completion.try_send(result.map_err(|e| e.to_string()));
                Ok(())
            }));
            let result = (|| {
                let core = webview.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?;
                let profile = core.Profile()?.cast::<ICoreWebView2Profile4>()?;
                profile.SetPermissionState(kind, &HSTRING::from(origin), COREWEBVIEW2_PERMISSION_STATE_DEFAULT, &handler)
            })();
            if let Err(error) = result { let _ = sender.try_send(Err(error.to_string())); }
        }).map_err(|e| e.to_string())?;
        receiver.recv().await.ok_or_else(|| "无法重置设备授权".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = device;
        Err("当前系统不支持重置设备授权".into())
    }
}

/// 仅允许网页链接，直接传参数给系统打开程序，不经过 shell 解释 URL。
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "链接无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("仅支持 HTTP/HTTPS 链接".into());
    }
    #[cfg(windows)]
    let mut command = {
        let mut cmd = Command::new("rundll32.exe");
        cmd.arg("url.dll,FileProtocolHandler").arg(parsed.as_str());
        cmd.hide_console();
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(parsed.as_str());
        cmd
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(parsed.as_str());
        cmd
    };
    command.spawn().map_err(|e| format!("无法打开浏览器：{e}"))?;
    Ok(())
}

/// 前端 invoke('restart_sidecar')：杀旧 sidecar 重新拉起，返回是否已持有新句柄
#[tauri::command]
async fn restart_sidecar() -> bool {
    tauri::async_runtime::spawn_blocking(restart_sidecar_impl).await.unwrap_or(false)
}

fn restart_sidecar_impl() -> bool {
    kill_sidecar();
    let res = RES_DIR.get().cloned().unwrap_or_else(|| PathBuf::from("."));
    // 端口可能还被旧进程占着：先等它释放（最多 3s）
    for _ in 0..15 {
        if TcpStream::connect(("127.0.0.1", app_port())).is_err() {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    spawn_sidecar(&res)
}

/// 杀掉 sidecar 子进程（take 出句柄后 kill+wait）。
/// 幂等：句柄已被 take 走则本次为空操作，供托盘「退出」与窗口 Destroyed 两处复用。
fn kill_sidecar() {
    if let Ok(mut guard) = sidecar_slot().lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 尝试拉起 sidecar（若端口已通或已有句柄则跳过）。返回是否持有句柄。
/// ⚠️ windows_subsystem="windows" 下子进程 stdout/stderr 无处可去，
///    全部重定向到 %TEMP%/yunhulaoda-sidecar.log（追加），崩溃时能看死因。
///    首行额外写一条壳侧启动记录（node/bundle/YH_ROOT 实际路径），路径类崩溃可直接对账。
fn spawn_sidecar(res: &std::path::Path) -> bool {
    let Ok(mut slot) = sidecar_slot().lock() else { return false };
    if APP_EXITING.load(Ordering::SeqCst) { return false; }
    if let Some(child) = slot.as_mut() {
        if matches!(child.try_wait(), Ok(None)) { return true; }
    }
    *slot = None;
    let node = res.join(NODE_BIN);
    let bundle = res.join("server-bundle.mjs");
    if !node.exists() || !bundle.exists() {
        return false;
    }
    let log = std::env::temp_dir().join("yunhulaoda-sidecar.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
        use std::io::Write;
        let _ = writeln!(
            f,
            "[shell] spawn sidecar: node={} bundle={} exists={}{}",
            node.display(),
            bundle.display(),
            node.exists() && bundle.exists(),
            ""
        );
    }
    // stdout/stderr 各开一个追加句柄（File 不能 move 两次）
    let out = std::fs::OpenOptions::new().create(true).append(true).open(&log);
    let err = std::fs::OpenOptions::new().create(true).append(true).open(&log);
    match (out, err) {
        (Ok(f), Ok(f2)) => match Command::new(&node)
            .arg("--optimize-for-size").arg("--max-semi-space-size=4")
            .arg(&bundle)
            .env("YH_ROOT", res)
            .env("YH_DOWNLOADS_DIR", DOWNLOADS_DIR.get().map(|path| path.as_os_str()).unwrap_or_default())
            .env("PORT", app_port().to_string())
            .env("HOST", "127.0.0.1")
            .env("HTTPS_PORT", "0")
            .env("YH_BOT_BRIDGE_SECRET", userbot_security::bridge_secret())
            .stdout(f)
            .stderr(f2)
            .hide_console()
            .spawn()
        {
            Ok(child) => {
                *slot = Some(child);
                true
            }
            Err(e) => {
                eprintln!("[tauri] sidecar 启动失败: {e}");
                false
            }
        },
        _ => match Command::new(&node)
            .arg("--optimize-for-size").arg("--max-semi-space-size=4")
            .arg(&bundle)
            .env("YH_ROOT", res)
            .env("YH_DOWNLOADS_DIR", DOWNLOADS_DIR.get().map(|path| path.as_os_str()).unwrap_or_default())
            .env("PORT", app_port().to_string())
            .env("HOST", "127.0.0.1")
            .env("HTTPS_PORT", "0")
            .env("YH_BOT_BRIDGE_SECRET", userbot_security::bridge_secret())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .hide_console()
            .spawn()
        {
            Ok(child) => {
                *slot = Some(child);
                true
            }
            Err(e) => {
                eprintln!("[tauri] sidecar 启动失败: {e}");
                false
            }
        },
    }
}

fn wait_port(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

/// 极简 HTML 转义，防止把文件路径里的 & < > 直接塞进页面破坏结构。
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// 生成一张自带样式、可读的中文错误页（含"重试"按钮，点了跳回 sidecar 地址）。
fn error_html(msg: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>云湖牢大版</title>
<style>
  html,body{{height:100%;margin:0}}
  body{{display:flex;align-items:center;justify-content:center;
       font-family:"Microsoft YaHei",system-ui,sans-serif;
       background:#0f1115;color:#e6e6e6}}
  .card{{max-width:520px;padding:32px 28px;text-align:center;
        background:#171a21;border:1px solid #262b36;border-radius:14px}}
  h1{{font-size:20px;margin:0 0 12px}}
  p{{font-size:14px;line-height:1.7;color:#b9c0cc;margin:0 0 20px;word-break:break-all}}
  button{{font-size:14px;padding:10px 22px;border:0;border-radius:8px;
         background:#3b82f6;color:#fff;cursor:pointer}}
  button:hover{{background:#2f6fe0}}
</style>
</head>
<body>
  <div class="card">
    <h1>无法连接到后端服务</h1>
    <p>{msg}</p>
    <button onclick="(window.__TAURI__&&window.__TAURI__.core?window.__TAURI__.core.invoke('restart_sidecar').then(function(ok){{setTimeout(function(){{location.href='http://127.0.0.1:{port}'}},ok?1500:300)}}).catch(function(){{location.href='http://127.0.0.1:{port}'}})):location.href='http://127.0.0.1:{port}'">重试连接</button>
  </div>
</body>
</html>"#,
        msg = html_escape(msg),
        port = app_port()
    )
}

/// 在已存在的主窗口里写入错误页。窗口不存在（如已关闭）时静默跳过。
fn show_error_page(app: &AppHandle, msg: &str) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let html = error_html(msg);
    // 用 serde_json 把整段 HTML 序列化成合法的 JS 字符串字面量，规避所有转义问题。
    let js = format!(
        "document.open();document.write({});document.close();",
        serde_json::to_string(&html).unwrap_or_else(|_| String::from("\"\""))
    );
    let _ = win.eval(js);
    let _ = win.set_title("云湖牢大版（后端未启动）");
}

/// 后台监控 sidecar：每 2s 一次，**死了就自动补拉起**（用户误关黑窗口/进程崩溃都自愈），
///  只有连续补拉失败才显示错误页。三种死法都覆盖：
///   · 有子进程且已退出（try_wait 返回 Some）→ 补拉；
///   · 无子进程（启动时复用了外部实例、外部实例后来死了）且端口不通 → 补拉。
fn spawn_sidecar_monitor(app: AppHandle, res: PathBuf) {
    std::thread::spawn(move || {
        let mut respawn_fail = 0u32;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            if APP_EXITING.load(Ordering::SeqCst) { return; }
            let need_respawn = match sidecar_slot().lock() {
                Ok(mut guard) => {
                    let st = guard.as_mut().map(|c| c.try_wait()); // 借用在此结束
                    match st {
                        Some(Ok(Some(_status))) => {
                            *guard = None; // 子进程已退出（含用户误关黑窗口）
                            true
                        }
                        Some(Ok(None)) => false, // 仍在运行
                        Some(Err(_)) => {
                            *guard = None;
                            true
                        }
                        // 无子进程：复用外部实例的场景——端口还通就继续观察，不通则补拉起
                        None => true,
                    }
                }
                Err(_) => return, // 锁中毒：panic=abort 下几乎不会发生，保守停止
            };
            if !need_respawn {
                respawn_fail = 0;
                continue;
            }
            eprintln!("[tauri] 监控发现后端不在，自动补拉起 sidecar");
            if spawn_sidecar(&res) && wait_port(app_port(), Duration::from_secs(20))
                && userbot_security::verify_sidecar().is_ok() {
                respawn_fail = 0;
            } else { respawn_fail += 1; }
            if respawn_fail >= 3 {
                let app2 = app.clone();
                let _ = app.run_on_main_thread(move || {
                    show_error_page(&app2, "后端服务多次拉起失败（详见 %TEMP%\\yunhulaoda-sidecar.log），请点击重试或重启应用。")
                });
                return;
            }
        }
    });
}

fn main() {
    let result = tauri::Builder::default()
        // 外链（消息/文章里的 http(s) 链接）交系统默认浏览器：
        // WebView2 对 target=_blank 的新窗口导航默认拦截，表现为「点网址没反应」
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![restart_sidecar, open_external_url, reset_media_permission, privacy::set_privacy,
            community_editor::open_community_editor, community_editor::close_community_editor,
            chat_window::open_chat_window, chat_window::close_chat_windows, chat_window::close_current_chat_window,
            ai_panel::open_ai_panel, ai_panel::close_ai_panel, ai_panel::ai_panel_action,
            userbot_security::secure_read, userbot_security::secure_write, userbot_security::secure_delete,
            userbot_security::ai_bridge_token,
            notifications::native_notifications_supported, notifications::show_message_notification,
            notifications::dismiss_message_notification, notifications::clear_message_notifications])
        .setup(|app| {
            notifications::initialize();
            // 先 clone handle 再进闭包/线程，避免借用冲突
            let handle = app.handle().clone();

            // 资源目录锚点（用户机实测 EISDIR 'D:' 崩溃后加固）：
            //   首选 **current_exe() 所在目录**（安装目录，node.exe/bundle 经 ls 证实就在里面，
            //   不依赖 Tauri resource_dir 的解析行为）；resource_dir 仅作回退；再回退当前目录。
            let res: PathBuf = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .filter(|d| d.join(NODE_BIN).exists() && d.join("server-bundle.mjs").exists())
                .or_else(|| {
                    handle
                        .path()
                        .resource_dir()
                        .ok()
                        .filter(|d| d.join(NODE_BIN).exists() && d.join("server-bundle.mjs").exists())
                })
                .unwrap_or_else(|| {
                    handle
                        .path()
                        .resource_dir()
                        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
                });
            let _ = RES_DIR.set(res.clone());
            if let Ok(downloads) = handle.path().download_dir() { let _ = DOWNLOADS_DIR.set(downloads); }
            let node = res.join(NODE_BIN);
            let bundle = res.join("server-bundle.mjs");
            let resources_ok = node.exists() && bundle.exists();

            // Allocate our own free loopback port; an older sidecar is never reused.
            let _ = app_port();
            if resources_ok { spawn_sidecar(&res); }
            // 监控无条件启动：既管「自己拉的子进程中途退出」，也管「复用了外部实例、
            // 外部实例后来死了」——后者端口不通时自动补拉起自己的 sidecar
            spawn_sidecar_monitor(handle.clone(), res.clone());

            // 等服务就绪（最多 20s）后在主线程建窗口。
            // 未就绪时加载 about:blank 再注入错误页，避免连接失败白屏。
            // 等待策略：45s（高负载机器首启 node 可能很慢）→ 仍不就绪且文件齐全则
            // 重试拉起一次 sidecar 再等 20s → 仍失败才显示错误页（带真实原因）。
            let win_handle = handle.clone();
            std::thread::spawn(move || {
                let mut ready = wait_port(app_port(), Duration::from_secs(45)) && userbot_security::verify_sidecar().is_ok();
                if !ready && resources_ok {
                    eprintln!("[tauri] sidecar 45s 未就绪，重试拉起一次");
                    spawn_sidecar(&res);
                    ready = wait_port(app_port(), Duration::from_secs(20)) && userbot_security::verify_sidecar().is_ok();
                }
                let inner = win_handle.clone();
                let _ = win_handle.run_on_main_thread(move || {
                    // 就绪→加载 sidecar；未就绪→about:blank（都是必然可解析的字面量）。
                    let target = if ready {
                        format!("http://127.0.0.1:{}", app_port()).parse::<Url>().ok()
                    } else {
                        "about:blank".parse::<Url>().ok()
                    };
                    let Some(target) = target else {
                        eprintln!("[tauri] 无法构造窗口 URL，跳过建窗");
                        return;
                    };

                    let title = if ready {
                        "云湖牢大版"
                    } else {
                        "云湖牢大版（服务启动中…）"
                    };
                    let popup_owner = inner.clone();
                    let builder = WebviewWindowBuilder::new(
                        &inner,
                        "main",
                        WebviewUrl::External(target),
                    )
                    .on_navigation(|url| {
                        url.as_str() == "about:blank" || (url.scheme() == "http"
                            && url.host_str() == Some("127.0.0.1") && url.port_or_known_default() == Some(app_port()))
                    })
                    .on_new_window(move |url, features| {
                        use tauri::webview::NewWindowResponse;
                        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1")
                            || url.port_or_known_default() != Some(app_port()) || url.path() != "/call-window.html" {
                            return NewWindowResponse::Allow;
                        }
                        if APP_EXITING.load(Ordering::SeqCst) || popup_owner.get_webview_window("call-float").is_some()
                            || privacy::NOTIFICATION_GATE.lock().map_or(true, |locked| *locked) {
                            return NewWindowResponse::Deny;
                        }
                        let Ok(blank) = "about:blank".parse::<Url>() else { return NewWindowResponse::Deny; };
                        match WebviewWindowBuilder::new(&popup_owner, "call-float", WebviewUrl::External(blank))
                            .window_features(features)
                            .title("云湖牢大版 · 通话")
                            .min_inner_size(340.0, 260.0)
                            .always_on_top(true)
                            .content_protected(privacy::capture_enabled())
                            .on_navigation(|next| next.as_str() == "about:blank" || (next.scheme() == "http"
                                && next.host_str() == Some("127.0.0.1") && next.port_or_known_default() == Some(app_port())
                                && next.path() == "/call-window.html"))
                            .build() {
                            Ok(window) => NewWindowResponse::Create { window },
                            Err(error) => {
                                eprintln!("[tauri] 无法打开通话浮窗: {error}");
                                NewWindowResponse::Deny
                            }
                        }
                    })
                    .title(title)
                    .zoom_hotkeys_enabled(true)
                    .inner_size(1280.0, 820.0)
                    .min_inner_size(900.0, 600.0);

                    match builder.build() {
                        Ok(win) => {
                            privacy::reduce_webview_memory(&win);
                            let _ = win.show();
                            let _ = win.set_focus();
                            if !ready {
                                let msg = if resources_ok {
                                    format!(
                                        "后端服务未能在 65 秒内启动（端口 {}，已自动重试一次）。\
                                         可能是首次启动较慢、端口被占用或被安全软件拦截，请点击重试。", app_port()
                                    )
                                } else {
                                    format!(
                                        "缺少运行所需文件（{} 或 server-bundle.mjs），\
                                         安装可能不完整。资源目录：{}。请重新安装应用。",
                                        NODE_BIN, res.display()
                                    )
                                };
                                show_error_page(&inner, &msg);
                            }
                        }
                        Err(e) => eprintln!("[tauri] 窗口创建失败: {e}"),
                    }
                });
            });

            // 托盘右键菜单：中文「退出」项（id = "quit"）
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            // 托盘：复用 bundle 的窗口图标 + 右键菜单；无图标时用空 Image 兜底
            //（TrayIconBuilder::icon 内部 try_into().ok()，空图不会 panic）。
            let icon = handle
                .default_window_icon()
                .cloned()
                .unwrap_or_else(|| Image::new(&[], 0, 0));
            // 托盘构建失败不再中断整个 app（原来是 .build(app)? 会让 setup 返回 Err）。
            if let Err(e) = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("云湖牢大版")
                .menu(&menu)
                // 关键：左键不弹菜单，保持 show/focus 主窗口的行为；右键由系统弹出上面的菜单
                .show_menu_on_left_click(false)
                // 菜单项点击：「退出」先杀 sidecar，再退出应用
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => {
                        APP_EXITING.store(true, Ordering::SeqCst);
                        notifications::clear();
                        kill_sidecar();
                        app.exit(0);
                    }
                    _ => {}
                })
                // 托盘图标事件：仅左键单击时唤出/聚焦主窗口
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)
            {
                eprintln!("[tauri] 托盘创建失败（不影响主程序）: {e}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Floating assistant windows must never stop the sidecar or change main-window visibility.
            if window.label() != "main" { return; }
            if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_)) {
                if let Some(webview) = window.get_webview_window("main") {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        let _ = webview.eval(if *focused { "window.dispatchEvent(new CustomEvent('yh-window-focused',{detail:true}))" } else { "window.dispatchEvent(new CustomEvent('yh-window-focused',{detail:false}))" });
                    }
                    let script = if window.is_minimized().unwrap_or(false) {
                        "window.dispatchEvent(new CustomEvent('yh-window-minimized',{detail:true}))"
                    } else {
                        "window.dispatchEvent(new CustomEvent('yh-window-minimized',{detail:false}))"
                    };
                    let _ = webview.eval(script);
                }
            }
            if let tauri::WindowEvent::Destroyed = event {
                APP_EXITING.store(true, Ordering::SeqCst);
                if let Some(panel) = window.get_webview_window("community-editor") { let _ = panel.close(); }
                if let Some(panel) = window.get_webview_window("ai-reply") { let _ = panel.close(); }
                if let Some(panel) = window.get_webview_window("call-float") { let _ = panel.close(); }
                chat_window::close_all(window.app_handle());
                notifications::clear();
                // 主窗口关闭 = 清理 sidecar（kill_sidecar 幂等，托盘退出路径已 take 过则为空操作）
                kill_sidecar();
            }
        })
        .run(tauri::generate_context!());

    APP_EXITING.store(true, Ordering::SeqCst);
    kill_sidecar();

    // 原来这里是 .expect("error while running tauri application")，
    // panic=abort 下会直接 abort。改成打印后以非零码干净退出。
    if let Err(e) = result {
        eprintln!("[tauri] 应用运行出错: {e}");
        std::process::exit(1);
    }
}
