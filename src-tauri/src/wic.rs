//! Windows Imaging Component decode: HEIC/HEIF, camera RAW, JPEG XR, plus any
//! third-party WIC codec the user has installed.

use std::path::Path;

use image::RgbaImage;
use windows::core::{w, HSTRING};
use windows::Win32::Foundation::GENERIC_READ;
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppRGBA, IWICBitmapFrameDecode,
    IWICImagingFactory, WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom,
    WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};

pub fn decode(path: &Path) -> Result<RgbaImage, String> {
    unsafe {
        let inited = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = decode_inner(path);
        if inited {
            CoUninitialize();
        }
        result
    }
}

unsafe fn decode_inner(path: &Path) -> Result<RgbaImage, String> {
    let factory: IWICImagingFactory =
        CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| format!("Windows Imaging is unavailable: {e}"))?;
    let decoder = factory
        .CreateDecoderFromFilename(
            &HSTRING::from(path.as_os_str()),
            None,
            GENERIC_READ,
            WICDecodeMetadataCacheOnDemand,
        )
        .map_err(|e| missing_codec_hint(path, &e))?;
    let frame = decoder
        .GetFrame(0)
        .map_err(|e| format!("Could not read the first frame: {e}"))?;
    let orientation = read_orientation(&frame).unwrap_or(1);

    let converter = factory
        .CreateFormatConverter()
        .map_err(|e| format!("Format converter: {e}"))?;
    converter
        .Initialize(
            &frame,
            &GUID_WICPixelFormat32bppRGBA,
            WICBitmapDitherTypeNone,
            None,
            0.0,
            WICBitmapPaletteTypeCustom,
        )
        .map_err(|e| format!("Could not convert pixels: {e}"))?;

    let (mut w, mut h) = (0u32, 0u32);
    converter
        .GetSize(&mut w, &mut h)
        .map_err(|e| format!("Image size: {e}"))?;
    let stride = w
        .checked_mul(4)
        .ok_or_else(|| "Image is too wide".to_string())?;
    let len = (stride as usize)
        .checked_mul(h as usize)
        .ok_or_else(|| "Image is too large".to_string())?;
    let mut buf = vec![0u8; len];
    converter
        .CopyPixels(std::ptr::null(), stride, &mut buf)
        .map_err(|e| format!("Could not decode pixels: {e}"))?;

    let img = RgbaImage::from_raw(w, h, buf).ok_or_else(|| "Bad pixel buffer".to_string())?;
    Ok(apply_exif_orientation(img, orientation))
}

/// EXIF orientation 1–8. WIC hands back sensor-order pixels for RAW and HEIF.
unsafe fn read_orientation(frame: &IWICBitmapFrameDecode) -> Option<u16> {
    let reader = frame.GetMetadataQueryReader().ok()?;
    let mut value = PROPVARIANT::default();
    reader
        .GetMetadataByName(w!("System.Photo.Orientation"), &mut value)
        .ok()?;
    let v = u16::try_from(&value).ok()?;
    (1..=8).contains(&v).then_some(v)
}

fn apply_exif_orientation(img: RgbaImage, o: u16) -> RgbaImage {
    use image::imageops::{flip_horizontal, flip_vertical, rotate180, rotate270, rotate90};
    match o {
        2 => flip_horizontal(&img),
        3 => rotate180(&img),
        4 => flip_vertical(&img),
        5 => flip_horizontal(&rotate90(&img)),
        6 => rotate90(&img),
        7 => flip_horizontal(&rotate270(&img)),
        8 => rotate270(&img),
        _ => img,
    }
}

fn missing_codec_hint(path: &Path, e: &windows::core::Error) -> String {
    // WINCODEC_ERR_COMPONENTNOTFOUND
    if e.code().0 as u32 == 0x88982F50 {
        let ext = crate::formats::ext_of(path);
        let store = match ext.as_str() {
            "heic" | "heif" | "hif" | "avci" | "heics" => {
                " Install \"HEIF Image Extensions\" (and \"HEVC Video Extensions\") from the Microsoft Store."
            }
            "jxr" | "wdp" | "hdp" => "",
            _ => " Install \"Raw Image Extension\" from the Microsoft Store.",
        };
        return format!("Windows has no codec for .{ext} files.{store}");
    }
    format!("Windows could not open this image: {e}")
}
