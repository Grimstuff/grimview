//! Windows personalization accent, same reading as Grimpad and Grimcut.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccentColors {
    /// CSS hex background, e.g. "#c45c1a"
    background: String,
    /// Contrasting text color for the accent background
    foreground: String,
}

/// Read the Windows personalization accent color (not CSS AccentColor, which WebView often mishandles).
#[tauri::command]
pub fn get_system_accent() -> Result<AccentColors, String> {
    #[cfg(windows)]
    {
        return read_windows_accent();
    }
    #[cfg(not(windows))]
    {
        Err("System accent is only implemented on Windows".into())
    }
}

#[cfg(windows)]
fn read_windows_accent() -> Result<AccentColors, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // Preferred: DWM AccentColor (matches Settings → Colors accent for most users)
    // Stored as 0xAABBGGRR (Windows COLORREF-style)
    let from_dwm = (|| -> Option<(u8, u8, u8)> {
        let dwm = hkcu.open_subkey("Software\\Microsoft\\Windows\\DWM").ok()?;
        let color: u32 = dwm.get_value("AccentColor").ok()?;
        Some(abgr_to_rgb(color))
    })();

    // Fallback: Explorer AccentColorMenu
    let from_explorer = (|| -> Option<(u8, u8, u8)> {
        let accent = hkcu
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent")
            .ok()?;
        let color: u32 = accent.get_value("AccentColorMenu").ok()?;
        Some(abgr_to_rgb(color))
    })();

    // Fallback: DWM ColorizationColor
    let from_colorization = (|| -> Option<(u8, u8, u8)> {
        let dwm = hkcu.open_subkey("Software\\Microsoft\\Windows\\DWM").ok()?;
        let color: u32 = dwm.get_value("ColorizationColor").ok()?;
        Some(abgr_to_rgb(color))
    })();

    let (r, g, b) = from_dwm
        .or(from_explorer)
        .or(from_colorization)
        .ok_or_else(|| "Could not read Windows accent color from registry".to_string())?;

    let background = format!("#{r:02x}{g:02x}{b:02x}");
    let foreground = if relative_luminance(r, g, b) > 0.55 {
        "#1a1a1a".to_string()
    } else {
        "#ffffff".to_string()
    };

    Ok(AccentColors {
        background,
        foreground,
    })
}

#[cfg(windows)]
fn abgr_to_rgb(color: u32) -> (u8, u8, u8) {
    // Windows registry accent is typically 0xAABBGGRR
    let r = (color & 0xFF) as u8;
    let g = ((color >> 8) & 0xFF) as u8;
    let b = ((color >> 16) & 0xFF) as u8;
    (r, g, b)
}

#[cfg(windows)]
fn relative_luminance(r: u8, g: u8, b: u8) -> f64 {
    fn lin(c: u8) -> f64 {
        let s = c as f64 / 255.0;
        if s <= 0.03928 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    }
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

