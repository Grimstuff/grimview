//! Windows shell integration: desktop background and Open with.

use std::path::Path;

use serde::Serialize;

/// Formats Windows' own wallpaper loader takes as-is; anything else is converted first.
const WALLPAPER_DIRECT: &[&str] = &["jpg", "jpeg", "jfif", "jpe", "bmp", "dib", "png", "gif", "tif", "tiff"];

pub fn wallpaper_direct(path: &Path) -> bool {
    WALLPAPER_DIRECT.contains(&crate::formats::ext_of(path).as_str())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handler {
    pub name: String,
    /// Executable or app id; used to pick the same handler again.
    pub id: String,
}

#[cfg(windows)]
mod win {
    use super::Handler;
    use std::path::Path;
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, IDataObject, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        BHID_DataObject, IAssocHandler, IShellItem, SHAssocEnumHandlers,
        SHCreateItemFromParsingName, ASSOC_FILTER_RECOMMENDED,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
    };

    pub fn set_wallpaper(path: &Path) -> Result<(), String> {
        let wide: Vec<u16> = path
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                Some(wide.as_ptr() as *mut std::ffi::c_void),
                SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
            )
        }
        .map_err(|e| format!("Windows refused the background: {e}"))
    }

    unsafe fn take(p: PWSTR) -> String {
        if p.is_null() {
            return String::new();
        }
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as *const std::ffi::c_void));
        s
    }

    /// Shell work wants an STA thread of its own.
    fn on_sta<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        std::thread::spawn(move || unsafe {
            let ok = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let r = f();
            if ok {
                CoUninitialize();
            }
            r
        })
        .join()
        .expect("shell thread")
    }

    fn own_exe() -> String {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()))
            .unwrap_or_else(|| "grimview.exe".into())
    }

    unsafe fn enum_handlers(ext: &str) -> Vec<(Handler, IAssocHandler)> {
        let mut out = Vec::new();
        let Ok(list) = SHAssocEnumHandlers(&HSTRING::from(ext), ASSOC_FILTER_RECOMMENDED) else {
            return out;
        };
        let me = own_exe();
        loop {
            let mut slot = [None];
            let mut fetched = 0u32;
            if list.Next(&mut slot, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }
            let Some(h) = slot[0].take() else { break };
            let name = h.GetUIName().map(|p| take(p)).unwrap_or_default();
            let id = h.GetName().map(|p| take(p)).unwrap_or_default();
            if name.is_empty() || id.to_lowercase().ends_with(&me) {
                continue;
            }
            if out.iter().any(|(o, _): &(Handler, IAssocHandler)| o.name == name) {
                continue;
            }
            out.push((Handler { name, id }, h));
        }
        out
    }

    pub fn handlers(path: &Path) -> Vec<Handler> {
        let ext = format!(".{}", crate::formats::ext_of(path));
        on_sta(move || unsafe { enum_handlers(&ext).into_iter().map(|(h, _)| h).collect() })
    }

    pub fn open_with(path: &Path, id: String) -> Result<(), String> {
        let path = path.to_path_buf();
        on_sta(move || unsafe {
            let ext = format!(".{}", crate::formats::ext_of(&path));
            let (_, handler) = enum_handlers(&ext)
                .into_iter()
                .find(|(h, _)| h.id == id)
                .ok_or_else(|| "That app is no longer available".to_string())?;
            let item: IShellItem =
                SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)
                    .map_err(|e| format!("Could not open the file: {e}"))?;
            let data: IDataObject = item
                .BindToHandler(None, &BHID_DataObject)
                .map_err(|e| format!("Could not open the file: {e}"))?;
            handler.Invoke(&data).map_err(|e| format!("The app did not start: {e}"))
        })
    }
}

#[tauri::command]
pub fn open_with_handlers(path: String) -> Vec<Handler> {
    #[cfg(windows)]
    return win::handlers(Path::new(&path));
    #[cfg(not(windows))]
    Vec::new()
}

#[tauri::command]
pub fn open_with(path: String, id: String) -> Result<(), String> {
    #[cfg(windows)]
    return win::open_with(Path::new(&path), id);
    #[cfg(not(windows))]
    Err("Windows only".into())
}

/// Windows' own "How do you want to open this file?" picker.
#[tauri::command]
pub fn open_with_dialog(path: String) -> Result<(), String> {
    std::process::Command::new("rundll32.exe")
        .arg("shell32.dll,OpenAs_RunDLL")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not show Open with: {e}"))
}

/// Set as desktop background. Formats Windows can't use directly arrive as PNG bytes
/// (rendered by the webview, so SVG and AVIF work too) and are saved in app data.
#[tauri::command]
pub fn set_wallpaper(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    use tauri::Manager;
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(|s| percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned())
        .ok_or("Missing path")?;
    let path = std::path::PathBuf::from(path);
    let target = if wallpaper_direct(&path) {
        path
    } else {
        let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
            return Err("Missing image data".into());
        };
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join("wallpaper.png");
        std::fs::write(&file, bytes).map_err(|e| format!("Could not save the background: {e}"))?;
        file
    };
    #[cfg(windows)]
    return win::set_wallpaper(&target);
    #[cfg(not(windows))]
    {
        let _ = target;
        Err("Windows only".into())
    }
}

/// Drag the file out of the window (to Explorer, the desktop, a chat app…) as a real
/// shell drag, with Windows' own drag image. Copy or link only: allowing Move would let
/// a drop on the same drive take the file away from its folder.
/// Runs on the main thread, which owns the window and is already OLE-initialized;
/// the call returns when the drop finishes.
#[tauri::command]
pub async fn start_file_drag(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        window
            .run_on_main_thread(move || {
                let _ = tx.send(win_drag::drag(hwnd, &path));
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Ok(())))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, path);
        Err("Windows only".into())
    }
}

#[cfg(windows)]
mod win_drag {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::IDataObject;
    use windows::Win32::System::Ole::{DROPEFFECT_COPY, DROPEFFECT_LINK};
    use windows::Win32::UI::Shell::{
        BHID_DataObject, IShellItem, SHCreateItemFromParsingName, SHDoDragDrop,
    };

    pub fn drag(hwnd: isize, path: &str) -> Result<(), String> {
        unsafe {
            let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path), None)
                .map_err(|e| format!("Could not drag the file: {e}"))?;
            let data: IDataObject = item
                .BindToHandler(None, &BHID_DataObject)
                .map_err(|e| format!("Could not drag the file: {e}"))?;
            // A cancelled drag (Esc, dropped nowhere) also lands here; that's not an error.
            let _ = SHDoDragDrop(
                Some(HWND(hwnd as *mut std::ffi::c_void)),
                &data,
                None,
                DROPEFFECT_COPY | DROPEFFECT_LINK,
            );
        }
        Ok(())
    }
}
