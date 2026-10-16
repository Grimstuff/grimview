# Grimview

A minimal Fluent-style image viewer for Windows. It opens already sized to the picture: 100% when it fits, otherwise as large as the screen's work area allows.

Desktop app built with **Tauri 2 + React**, same family as [Grimpad](https://github.com/Grimstuff/grimpad) and Grimcut.

## Formats

| Decoder | Formats |
| --- | --- |
| WebView2 (animation kept) | PNG/APNG, JPEG, GIF, WebP, BMP, ICO/CUR, SVG, AVIF |
| Rust `image` crate | TIFF, TGA, DDS, HDR, EXR, PNM (PBM/PGM/PPM/PAM), QOI, Farbfeld |
| `jxl-oxide` | JPEG XL |
| Windows Imaging (WIC) | HEIC/HEIF, JPEG XR, camera RAW (DNG, CR2, CR3, NEF, ARW, ORF, RW2, RAF, PEF, SRW…) |

HEIC needs *HEIF Image Extensions* (and *HEVC Video Extensions*); RAW needs *Raw Image Extension*. Both are free in the Microsoft Store.

## Use

```powershell
grimview.exe D:\photos\IMG_0042.heic
```

Or drop a file on the exe, the window, or use **Open with**. The installer adds Grimview to the Open with list; it does not take over default apps.

| Key | Action |
| --- | --- |
| ← / → (PgUp / PgDn, Space, mouse back/forward) | Previous / next image in the folder |
| Home / End | First / last image |
| Wheel, + / − | Zoom (around the cursor) |
| 0 / 1 | Fit / actual size |
| Double-click | Toggle fit and 100% |
| Drag | Pan when zoomed in, otherwise move the window |
| R / L | Rotate right / left (view only) |
| W | Toggle "Size window to image" (on: the window resizes to every image) |
| Click the % | Zoom slider (snaps to 100% in the middle and to fit) |
| Click the file name | Copy the file name |
| F11 or F | Fullscreen |
| Ctrl+C / Ctrl+Shift+C | Copy image / copy path |
| Ctrl+O | Open |
| Esc | Leave fullscreen, or close |

## Develop

```powershell
cd C:\Users\Grimmers\Dev\grimsuite\grimview
npm install
npm run tauri dev      # http://127.0.0.1:1430
npm run tauri build    # exe + NSIS installer
```

Needs Node 20+, stable Rust, Windows 10/11 + WebView2.

Test images: `cargo run --example samples -- <dir>` (from `src-tauri`) writes one file per format it can encode, and `cargo run --release --example decode_check -- <dir>` runs a folder through the Rust decoders.

## License

MIT.
