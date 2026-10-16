// GUI app — no console window in debug or release (drop-on-exe / Open with stay clean).
// `tauri dev` still shows logs in the parent terminal that launched cargo.
#![windows_subsystem = "windows"]

fn main() {
    grimview_lib::run()
}
