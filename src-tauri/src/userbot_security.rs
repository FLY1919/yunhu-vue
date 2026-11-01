//! Per-user Windows DPAPI storage and a per-process capability for the local AI bridge.
use std::sync::OnceLock;
use std::io::{Read, Write};
use sha2::{Digest, Sha256};

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use winreg::{enums::*, RegKey, RegValue};

    #[repr(C)]
    struct Blob { size: u32, data: *mut u8 }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(input: *const Blob, desc: *const u16, entropy: *const Blob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, output: *mut Blob) -> i32;
        fn CryptUnprotectData(input: *const Blob, desc: *mut *mut u16, entropy: *const Blob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, output: *mut Blob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" { fn LocalFree(ptr: *mut c_void) -> *mut c_void; }
    #[link(name = "bcrypt")]
    extern "system" { fn BCryptGenRandom(alg: *mut c_void, bytes: *mut u8, len: u32, flags: u32) -> i32; }

    fn valid(name: &str) -> Result<(), String> {
        if matches!(name, "accounts" | "session" | "botkeys" | "userbots") { Ok(()) } else { Err("无效的安全存储名称".into()) }
    }
    fn transform(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        if data.len() > 2 * 1024 * 1024 { return Err("安全存储数据过大".into()); }
        let input = Blob { size: data.len() as u32, data: data.as_ptr() as *mut u8 };
        let mut output = Blob { size: 0, data: std::ptr::null_mut() };
        let ok = unsafe {
            if encrypt { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), 1, &mut output) }
            else { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), 1, &mut output) }
        };
        if ok == 0 { return Err("Windows 安全存储操作失败".into()); }
        let result = unsafe { std::slice::from_raw_parts(output.data, output.size as usize).to_vec() };
        unsafe { LocalFree(output.data.cast()); }
        Ok(result)
    }
    fn key() -> Result<RegKey, String> {
        RegKey::predef(HKEY_CURRENT_USER).create_subkey(r"Software\YunhuLaoda\SecureData")
            .map(|(k, _)| k).map_err(|_| "无法打开 Windows 安全存储".into())
    }
    pub fn read(name: &str) -> Result<Option<String>, String> {
        valid(name)?;
        let raw = match key()?.get_raw_value(name) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("无法读取安全存储".into()),
        };
        let bytes = transform(&raw.bytes, false)?;
        String::from_utf8(bytes).map(Some).map_err(|_| "安全存储数据损坏".into())
    }
    pub fn write(name: &str, data: &str) -> Result<(), String> {
        valid(name)?;
        let encrypted = transform(data.as_bytes(), true)?;
        key()?.set_raw_value(name, &RegValue { vtype: REG_BINARY, bytes: encrypted }).map_err(|_| "无法写入安全存储".into())
    }
    pub fn delete(name: &str) -> Result<(), String> {
        valid(name)?;
        match key()?.delete_value(name) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(_) => Err("无法删除安全数据".into()) }
    }
    pub fn random() -> String {
        let mut bytes = [0u8; 32];
        if unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), bytes.len() as u32, 2) } != 0 { return String::new(); }
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

pub fn bridge_secret() -> &'static str {
    static VALUE: OnceLock<String> = OnceLock::new();
    VALUE.get_or_init(|| {
        #[cfg(windows)] { win::random() }
        #[cfg(not(windows))] { String::new() }
    })
}
// A different process occupying port 8902 must not gain access to the vault via
// the WebView's remote-page permissions. Prove the sidecar knows our secret
// without revealing it to the process serving the page.
pub(crate) fn verify_sidecar() -> Result<(), String> {
    #[cfg(not(windows))] { return Err("本平台暂不支持安全存储".into()); }
    #[cfg(windows)] {
        let secret = bridge_secret();
        let nonce = win::random();
        if secret.is_empty() || nonce.is_empty() { return Err("无法建立安全连接".into()); }
        let mut stream = std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], crate::app_port())), std::time::Duration::from_secs(2))
            .map_err(|_| "本地安全服务不可用")?;
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(2)));
        let request = crate::desktop_endpoint::proof_request(crate::app_port(), &nonce);
        stream.write_all(request.as_bytes()).map_err(|_| "本地安全连接失败")?;
        let mut response = String::new();
        stream.take(4096).read_to_string(&mut response).map_err(|_| "本地安全连接失败")?;
        let expected = Sha256::digest(format!("{nonce}{secret}").as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>();
        if !crate::desktop_endpoint::proof_matches(&response, &expected) {
            return Err("本地服务身份校验失败，请重启客户端后重试".into());
        }
        Ok(())
    }
}
#[tauri::command]
pub async fn ai_bridge_token() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        verify_sidecar()?;
        let token = bridge_secret();
        if token.is_empty() { Err("安全网络桥接不可用".into()) } else { Ok(token.to_owned()) }
    }).await.map_err(|_| "安全服务任务未完成".to_string())?
}
#[tauri::command]
pub async fn secure_read(name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        verify_sidecar()?;
        #[cfg(windows)] { win::read(&name) }
        #[cfg(not(windows))] { let _ = name; Err("本平台暂不支持系统安全存储".into()) }
    }).await.map_err(|_| "安全存储任务未完成".to_string())?
}
#[tauri::command]
pub async fn secure_write(name: String, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        verify_sidecar()?;
        #[cfg(windows)] { win::write(&name, &data) }
        #[cfg(not(windows))] { let _ = (name, data); Err("本平台暂不支持系统安全存储".into()) }
    }).await.map_err(|_| "安全存储任务未完成".to_string())?
}
#[tauri::command]
pub async fn secure_delete(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        verify_sidecar()?;
        #[cfg(windows)] { win::delete(&name) }
        #[cfg(not(windows))] { let _ = name; Err("本平台暂不支持系统安全存储".into()) }
    }).await.map_err(|_| "安全存储任务未完成".to_string())?
}
