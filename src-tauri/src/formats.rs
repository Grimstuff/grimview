//! Which extensions Grimview opens, and who decodes them.

/// WebView2 (Chromium) decodes these itself, animation included. Bytes go through untouched.
const NATIVE: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("apng", "image/apng"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("jpe", "image/jpeg"),
    ("jfif", "image/jpeg"),
    ("pjpeg", "image/jpeg"),
    ("pjp", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("bmp", "image/bmp"),
    ("dib", "image/bmp"),
    ("ico", "image/x-icon"),
    ("cur", "image/x-icon"),
    ("svg", "image/svg+xml"),
    ("avif", "image/avif"),
];

/// Pure-Rust `image` crate.
pub const IMAGE_CRATE: &[&str] = &[
    "tif", "tiff", "tga", "dds", "hdr", "exr", "pnm", "pbm", "pgm", "ppm", "pam", "qoi", "ff",
];

/// Windows Imaging Component, using whatever codecs are installed
/// (HEIF Image Extensions, Raw Image Extension, built-in JPEG XR).
pub const WIC: &[&str] = &[
    "heic", "heif", "hif", "avci", "heics", "jxr", "wdp", "hdp", "dng", "cr2", "cr3", "crw",
    "nef", "nrw", "arw", "srf", "sr2", "orf", "rw2", "raf", "pef", "srw", "x3f", "3fr", "erf",
    "kdc", "dcr", "mrw", "mos", "iiq", "rwl",
];

pub fn ext_of(path: &std::path::Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn native_mime(ext: &str) -> Option<&'static str> {
    NATIVE.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m)
}

pub fn is_supported(ext: &str) -> bool {
    native_mime(ext).is_some() || ext == "jxl" || IMAGE_CRATE.contains(&ext) || WIC.contains(&ext)
}

pub fn all() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = NATIVE.iter().map(|(e, _)| *e).collect();
    v.push("jxl");
    v.extend_from_slice(IMAGE_CRATE);
    v.extend_from_slice(WIC);
    v
}
