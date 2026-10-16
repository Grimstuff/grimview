//! Place the window by its visible client area.
//!
//! A frameless window with a shadow keeps invisible resize borders on the left, right and
//! bottom, and tao's set_size pads for a caption that isn't there. Working from
//! GetWindowRect vs GetClientRect makes the visible window land exactly where asked.

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
    };

    fn hwnd(window: &tauri::WebviewWindow) -> Result<HWND, String> {
        let h = window.hwnd().map_err(|e| e.to_string())?;
        Ok(HWND(h.0 as *mut std::ffi::c_void))
    }

    /// (window rect, client origin on screen, client size)
    fn metrics(h: HWND) -> Result<(RECT, POINT, RECT), String> {
        let mut wr = RECT::default();
        let mut cr = RECT::default();
        let mut origin = POINT::default();
        unsafe {
            GetWindowRect(h, &mut wr).map_err(|e| e.to_string())?;
            GetClientRect(h, &mut cr).map_err(|e| e.to_string())?;
            let _ = ClientToScreen(h, &mut origin);
        }
        Ok((wr, origin, cr))
    }

    pub fn client_rect(window: &tauri::WebviewWindow) -> Result<[i32; 4], String> {
        let (_, o, cr) = metrics(hwnd(window)?)?;
        Ok([o.x, o.y, cr.right - cr.left, cr.bottom - cr.top])
    }

    pub fn place(window: &tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
        let hw = hwnd(window)?;
        // Twice: the first move can cross onto a monitor with another DPI and
        // change the frame metrics.
        for _ in 0..2 {
            let (wr, o, cr) = metrics(hw)?;
            let left = o.x - wr.left;
            let top = o.y - wr.top;
            let extra_w = (wr.right - wr.left) - (cr.right - cr.left);
            let extra_h = (wr.bottom - wr.top) - (cr.bottom - cr.top);
            unsafe {
                SetWindowPos(
                    hw,
                    None,
                    x - left,
                    y - top,
                    w + extra_w,
                    h + extra_h,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn client_rect(window: tauri::WebviewWindow) -> Result<[i32; 4], String> {
    #[cfg(windows)]
    return win::client_rect(&window);
    #[cfg(not(windows))]
    {
        let p = window.inner_position().map_err(|e| e.to_string())?;
        let s = window.inner_size().map_err(|e| e.to_string())?;
        Ok([p.x, p.y, s.width as i32, s.height as i32])
    }
}

#[tauri::command]
pub fn place_window(window: tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    #[cfg(windows)]
    return win::place(&window, x, y, w, h);
    #[cfg(not(windows))]
    {
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .and_then(|_| window.set_size(tauri::PhysicalSize::new(w as u32, h as u32)))
            .map_err(|e| e.to_string())
    }
}
