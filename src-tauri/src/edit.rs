//! Rotate / crop / resize and write the result back.
//!
//! Only formats the `image` crate can write without losing anything the viewer shows
//! (no animated GIF / WebP / APNG). Overwriting sends the original to the Recycle Bin
//! first, so an edit can always be undone from there.

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{AnimationDecoder, DynamicImage, ImageFormat};
use serde::Deserialize;

use crate::{decode, formats};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EditOp {
    /// Quarter turns clockwise (1 = 90° right, 3 = 90° left).
    Rotate { turns: u8 },
    Crop { x: u32, y: u32, w: u32, h: u32 },
    Resize { w: u32, h: u32 },
}

fn format_for(ext: &str) -> Option<ImageFormat> {
    Some(match ext {
        "png" => ImageFormat::Png,
        "jpg" | "jpeg" | "jpe" | "jfif" => ImageFormat::Jpeg,
        "bmp" | "dib" => ImageFormat::Bmp,
        "tif" | "tiff" => ImageFormat::Tiff,
        "webp" => ImageFormat::WebP,
        "tga" => ImageFormat::Tga,
        "qoi" => ImageFormat::Qoi,
        "gif" => ImageFormat::Gif,
        _ => return None,
    })
}

fn is_animated(path: &Path, ext: &str) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let reader = std::io::BufReader::new(file);
    match ext {
        "gif" => image::codecs::gif::GifDecoder::new(reader)
            .map(|d| d.into_frames().take(2).count() > 1)
            .unwrap_or(false),
        "webp" => image::codecs::webp::WebPDecoder::new(reader)
            .map(|d| d.has_animation())
            .unwrap_or(false),
        "png" => image::codecs::png::PngDecoder::new(reader)
            .and_then(|d| d.is_apng())
            .unwrap_or(false),
        _ => false,
    }
}

/// Why this file can't be edited, or None if it can.
pub fn not_editable_reason(path: &Path) -> Option<String> {
    let ext = formats::ext_of(path);
    if format_for(&ext).is_none() {
        return Some(format!("Editing .{ext} files isn't supported"));
    }
    if is_animated(path, &ext) {
        return Some("Editing animated images isn't supported".into());
    }
    None
}

pub fn apply(path: &Path, op: EditOp, as_copy: bool) -> Result<String, String> {
    if let Some(why) = not_editable_reason(path) {
        return Err(why);
    }
    let ext = formats::ext_of(path);
    let fmt = format_for(&ext).unwrap();
    let img = decode::decode(path)?;

    let out = match op {
        EditOp::Rotate { turns } => match turns % 4 {
            1 => img.rotate90(),
            2 => img.rotate180(),
            3 => img.rotate270(),
            _ => img,
        },
        EditOp::Crop { x, y, w, h } => {
            if w == 0 || h == 0 || x >= img.width() || y >= img.height() {
                return Err("The crop area is empty".into());
            }
            let w = w.min(img.width() - x);
            let h = h.min(img.height() - y);
            img.crop_imm(x, y, w, h)
        }
        EditOp::Resize { w, h } => {
            if w == 0 || h == 0 || w > 65_535 || h > 65_535 {
                return Err("That size is out of range".into());
            }
            img.resize_exact(w, h, FilterType::Lanczos3)
        }
    };

    let dir = path.parent().ok_or("No parent folder")?;
    let name = path.file_name().ok_or("Bad file name")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.grimview-tmp"));
    encode(&out, fmt, &tmp).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;

    let dest = if as_copy { unique_copy_path(path) } else { path.to_path_buf() };
    if !as_copy {
        // Recycle Bin first so the original can be restored; if that fails, keep it safe.
        if let Err(e) = trash::delete(path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("Could not move the original to the Recycle Bin: {e}"));
        }
    }
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save: {e}")
    })?;
    Ok(dest.to_string_lossy().into_owned())
}

fn unique_copy_path(path: &Path) -> PathBuf {
    let dir = path.parent().unwrap_or(Path::new("."));
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
    (1..)
        .map(|n| {
            let suffix = if n == 1 { " (edited)".to_string() } else { format!(" (edited {n})") };
            dir.join(format!("{stem}{suffix}.{ext}"))
        })
        .find(|p| !p.exists())
        .unwrap()
}

fn encode(img: &DynamicImage, fmt: ImageFormat, out: &Path) -> Result<(), String> {
    let err = |e: image::ImageError| format!("Could not encode the image: {e}");
    let alpha = img.color().has_alpha();
    match fmt {
        ImageFormat::Jpeg => {
            let file = File::create(out).map_err(|e| format!("Could not write: {e}"))?;
            JpegEncoder::new_with_quality(BufWriter::new(file), 95)
                .encode_image(&img.to_rgb8())
                .map_err(err)
        }
        ImageFormat::Png | ImageFormat::Tiff => {
            let img = match img {
                DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => {
                    DynamicImage::ImageRgba16(img.to_rgba16())
                }
                other => other.clone(),
            };
            img.save_with_format(out, fmt).map_err(err)
        }
        _ => {
            let img = if alpha {
                DynamicImage::ImageRgba8(img.to_rgba8())
            } else {
                DynamicImage::ImageRgb8(img.to_rgb8())
            };
            let img = if fmt == ImageFormat::Gif { DynamicImage::ImageRgba8(img.to_rgba8()) } else { img };
            img.save_with_format(out, fmt).map_err(err)
        }
    }
}
