// Grimview Tauri backend — image protocol, folder listing, launch paths
mod accent;
mod decode;
mod formats;
mod placement;
#[cfg(windows)]
mod wic;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::http::{header, Request, Response, StatusCode};

/// Last few Rust-decoded images, so prev/next back onto a RAW or HEIC is instant.
static DECODED: Mutex<VecDeque<(String, Arc<Vec<u8>>)>> = Mutex::new(VecDeque::new());
const DECODED_KEEP: usize = 4;

fn cache_key(path: &Path) -> String {
    let mtime = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{}|{mtime}", path.display())
}

fn decoded_png(path: &Path) -> Result<Arc<Vec<u8>>, String> {
    let key = cache_key(path);
    if let Ok(cache) = DECODED.lock() {
        if let Some((_, png)) = cache.iter().find(|(k, _)| *k == key) {
            return Ok(png.clone());
        }
    }
    let png = Arc::new(decode::to_png(path)?);
    if let Ok(mut cache) = DECODED.lock() {
        cache.retain(|(k, _)| *k != key);
        cache.push_back((key, png.clone()));
        while cache.len() > DECODED_KEEP {
            cache.pop_front();
        }
    }
    Ok(png)
}

/// `http://gv.localhost/<encoded path>[?decode=1]`
/// Native formats are served as-is; the rest are decoded to PNG.
/// `decode=1` forces the Rust path (the frontend retries with it when WebView2 fails).
fn serve_image(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let raw = uri.path().trim_start_matches('/');
    let path = match percent_encoding::percent_decode_str(raw).decode_utf8() {
        Ok(p) => PathBuf::from(p.into_owned()),
        Err(_) => return text_response(StatusCode::BAD_REQUEST, "Bad path".into()),
    };
    let force = uri.query().is_some_and(|q| q.split('&').any(|kv| kv == "decode=1"));

    if !path.is_file() {
        return text_response(StatusCode::NOT_FOUND, "The file no longer exists.".into());
    }

    let ext = formats::ext_of(&path);
    let result: Result<(Vec<u8>, &str), String> = match formats::native_mime(&ext) {
        Some(mime) if !force => std::fs::read(&path)
            .map(|b| (b, mime))
            .map_err(|e| format!("Could not read the file: {e}")),
        _ => decoded_png(&path).map(|png| ((*png).clone(), "image/png")),
    };

    match result {
        Ok((body, mime)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(body)
            .unwrap(),
        Err(msg) => text_response(StatusCode::UNPROCESSABLE_ENTITY, msg),
    }
}

fn text_response(status: StatusCode, msg: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(msg.into_bytes())
        .unwrap()
}

/// `canonicalize` on Windows returns `\?\C:\...`; keep that out of the UI.
fn normalize_path_display(path: &Path) -> String {
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let s = resolved.to_string_lossy();
    let s = if let Some(rest) = s.strip_prefix(r"\?\UNC\") {
        format!(r"\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\?\") {
        rest.to_string()
    } else {
        s.into_owned()
    };
    s.replace('/', "\\")
}

/// First file passed on the command line (Open with, drop on exe, `grimview.exe photo.jpg`).
#[tauri::command]
fn get_launch_path() -> Option<String> {
    std::env::args().skip(1).find_map(|arg| {
        if arg.starts_with('-') || arg.contains("://") {
            return None;
        }
        let path = PathBuf::from(&arg);
        path.is_file().then(|| normalize_path_display(&path))
    })
}

#[tauri::command]
fn get_formats() -> Vec<&'static str> {
    formats::all()
}

/// Every supported image next to `path` (unsorted; the UI sorts like Explorer).
#[tauri::command]
fn list_folder_images(path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(path);
    let dir = path
        .parent()
        .ok_or_else(|| "No parent folder".to_string())?;
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Could not list folder: {e}"))?;
    Ok(entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| formats::is_supported(&formats::ext_of(p)))
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    size: u64,
    mtime_ms: Option<u64>,
}

#[tauri::command]
fn get_file_info(path: String) -> Result<FileInfo, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("stat {path}: {e}"))?;
    Ok(FileInfo {
        size: meta.len(),
        mtime_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("gv", |_ctx, request, responder| {
            // Decoding a RAW can take a second; keep it off the main thread.
            std::thread::spawn(move || responder.respond(serve_image(&request)));
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::window::Color;
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_background_color(Some(Color(0x1e, 0x1e, 0x1e, 0xff)));
                    // The frontend shows the window once it is sized to the image. If the
                    // webview never gets there, don't leave an invisible process behind.
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(6));
                        if !win.is_visible().unwrap_or(true) {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_launch_path,
            get_formats,
            list_folder_images,
            get_file_info,
            accent::get_system_accent,
            placement::client_rect,
            placement::place_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Decode through the same path the `gv` protocol uses for non-native formats.
/// Used by `examples/decode_check.rs`.
pub fn decode_to_png(path: &Path) -> Result<Vec<u8>, String> {
    decode::to_png(path)
}
