//! Turn anything WebView2 can't show into a PNG it can.

use std::io::Cursor;
use std::path::Path;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageReader};

use crate::formats;

pub fn to_png(path: &Path) -> Result<Vec<u8>, String> {
    let img = decode(path)?;
    encode_png(img)
}

fn decode(path: &Path) -> Result<DynamicImage, String> {
    let ext = formats::ext_of(path);
    if ext == "jxl" {
        return decode_jxl(path);
    }
    if formats::WIC.contains(&ext.as_str()) {
        // A mislabeled TIFF/JPEG still opens through the image crate.
        return wic_decode(path).or_else(|wic_err| decode_image_crate(path).map_err(|_| wic_err));
    }
    decode_image_crate(path).or_else(|err| wic_decode(path).map_err(|_| err))
}

fn decode_image_crate(path: &Path) -> Result<DynamicImage, String> {
    let mut reader = ImageReader::open(path)
        .map_err(|e| format!("Could not open the file: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Could not read the file: {e}"))?;
    reader.no_limits();
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("Unsupported or damaged image: {e}"))?;
    let orientation = decoder.orientation().ok();
    let mut img =
        DynamicImage::from_decoder(decoder).map_err(|e| format!("Could not decode image: {e}"))?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img)
}

fn decode_jxl(path: &Path) -> Result<DynamicImage, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Could not open the file: {e}"))?;
    let decoder = jxl_oxide::integration::JxlDecoder::new(file)
        .map_err(|e| format!("Could not read JPEG XL: {e}"))?;
    DynamicImage::from_decoder(decoder).map_err(|e| format!("Could not decode JPEG XL: {e}"))
}

#[cfg(windows)]
fn wic_decode(path: &Path) -> Result<DynamicImage, String> {
    crate::wic::decode(path).map(DynamicImage::ImageRgba8)
}

#[cfg(not(windows))]
fn wic_decode(_path: &Path) -> Result<DynamicImage, String> {
    Err("This format needs Windows codecs".into())
}

/// Fast deflate, no filter: a 24 MP RAW should not sit in the encoder for seconds.
fn encode_png(img: DynamicImage) -> Result<Vec<u8>, String> {
    let img = match img {
        DynamicImage::ImageLuma8(_)
        | DynamicImage::ImageLumaA8(_)
        | DynamicImage::ImageRgb8(_)
        | DynamicImage::ImageRgba8(_) => img,
        other if other.color().has_alpha() => DynamicImage::ImageRgba8(other.to_rgba8()),
        other => DynamicImage::ImageRgb8(other.to_rgb8()),
    };
    let mut out = Vec::with_capacity(img.as_bytes().len() / 2);
    PngEncoder::new_with_quality(Cursor::new(&mut out), CompressionType::Fast, FilterType::NoFilter)
        .write_image(img.as_bytes(), img.width(), img.height(), img.color().into())
        .map_err(|e| format!("Could not prepare the image for display: {e}"))?;
    Ok(out)
}
