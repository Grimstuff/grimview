//! Writes one test image per format Grimview can produce locally.
//! `cargo run --example samples -- <out dir>`

use std::path::{Path, PathBuf};

use image::codecs::gif::{GifEncoder, Repeat};
use image::{Delay, DynamicImage, Frame, ImageFormat, Rgba, RgbaImage};

fn gradient(w: u32, h: u32, alpha: bool) -> RgbaImage {
    RgbaImage::from_fn(w, h, |x, y| {
        let r = (x * 255 / w.max(1)) as u8;
        let g = (y * 255 / h.max(1)) as u8;
        let b = 160u8;
        let a = if alpha && (x / 64 + y / 64) % 2 == 0 { 96 } else { 255 };
        // A marker in the top-left corner shows orientation at a glance.
        if x < w / 6 && y < h / 6 {
            Rgba([255, 255, 255, 255])
        } else {
            Rgba([r, g, b, a])
        }
    })
}

fn save(img: &DynamicImage, dir: &Path, name: &str, fmt: ImageFormat) {
    let p = dir.join(name);
    match img.save_with_format(&p, fmt) {
        Ok(()) => println!("wrote {}", p.display()),
        Err(e) => println!("skip {name}: {e}"),
    }
}

fn main() {
    let dir = PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| "samples".into()));
    std::fs::create_dir_all(&dir).unwrap();

    let wide = DynamicImage::ImageRgba8(gradient(1600, 900, true));
    let opaque = DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(gradient(1200, 800, false)).to_rgb8());
    let huge = DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(gradient(6000, 4000, false)).to_rgb8());

    save(&wide, &dir, "01-alpha.png", ImageFormat::Png);
    save(&opaque, &dir, "02-photo.jpg", ImageFormat::Jpeg);
    save(&opaque, &dir, "03-bitmap.bmp", ImageFormat::Bmp);
    save(&wide, &dir, "04-lossless.webp", ImageFormat::WebP);
    save(&DynamicImage::ImageRgba8(gradient(256, 256, true)), &dir, "05-icon.ico", ImageFormat::Ico);
    save(&wide, &dir, "06-scan.tiff", ImageFormat::Tiff);
    save(&wide, &dir, "07-targa.tga", ImageFormat::Tga);
    save(&opaque, &dir, "08-netpbm.ppm", ImageFormat::Pnm);
    save(&wide, &dir, "09-quite-ok.qoi", ImageFormat::Qoi);
    save(&DynamicImage::ImageRgba16(wide.to_rgba16()), &dir, "10-farbfeld.ff", ImageFormat::Farbfeld);
    save(&DynamicImage::ImageRgb32F(opaque.to_rgb32f()), &dir, "11-radiance.hdr", ImageFormat::Hdr);
    save(&DynamicImage::ImageRgba32F(wide.to_rgba32f()), &dir, "12-openexr.exr", ImageFormat::OpenExr);
    save(&huge, &dir, "13-huge-6000x4000.tif", ImageFormat::Tiff);
    save(&DynamicImage::ImageRgba8(gradient(48, 32, true)), &dir, "14-tiny.png", ImageFormat::Png);

    // Animated GIF: a bar sweeping across.
    let gif_path = dir.join("15-animated.gif");
    let file = std::fs::File::create(&gif_path).unwrap();
    let mut enc = GifEncoder::new_with_speed(file, 10);
    enc.set_repeat(Repeat::Infinite).unwrap();
    for i in 0..12u32 {
        let f = RgbaImage::from_fn(320, 200, |x, y| {
            if x / 27 == i {
                Rgba([240, 180, 40, 255])
            } else {
                Rgba([30 + (y / 4) as u8, 40, 70, 255])
            }
        });
        enc.encode_frame(Frame::from_parts(f, 0, 0, Delay::from_numer_denom_ms(80, 1)))
            .unwrap();
    }
    drop(enc);
    println!("wrote {}", gif_path.display());

    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
<rect width="640" height="400" rx="32" fill="#2d2d2d"/>
<circle cx="480" cy="120" r="56" fill="#a8a8a8"/>
<path d="M40 360 L240 110 L460 360 Z" fill="#767676"/>
<text x="40" y="70" font-family="Segoe UI" font-size="36" fill="#e6e6e6">SVG sample</text>
</svg>"##;
    std::fs::write(dir.join("16-vector.svg"), svg).unwrap();
    let svg_nosize = svg.replace(r#"width="640" height="400" "#, "");
    std::fs::write(dir.join("17-viewbox-only.svg"), svg_nosize).unwrap();

    // Misnamed: a PNG wearing a .jpg extension.
    save(&wide, &dir, "18-actually-png.jpg", ImageFormat::Png);
    std::fs::write(dir.join("19-broken.png"), b"not an image").unwrap();

    #[cfg(windows)]
    wic_samples(&dir, &opaque);
}

/// HEIC (needs HEVC Video Extensions) and JPEG XR through the WIC encoders.
#[cfg(windows)]
fn wic_samples(dir: &Path, img: &DynamicImage) {
    use windows::core::{GUID, HSTRING};
    use windows::Win32::Foundation::GENERIC_WRITE;
    use windows::Win32::Graphics::Imaging::*;
    use windows::Win32::System::Com::*;

    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let targets: [(&str, GUID); 2] = [
        ("20-phone.heic", GUID_ContainerFormatHeif),
        ("21-hdphoto.jxr", GUID_ContainerFormatWmp),
    ];
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).unwrap();
        for (name, container) in targets {
            let path = dir.join(name);
            let r = (|| -> windows::core::Result<()> {
                let stream = factory.CreateStream()?;
                stream.InitializeFromFilename(&HSTRING::from(path.as_os_str()), GENERIC_WRITE.0)?;
                let encoder = factory.CreateEncoder(&container, std::ptr::null())?;
                encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
                let mut frame = None;
                encoder.CreateNewFrame(&mut frame, std::ptr::null_mut())?;
                let frame = frame.unwrap();
                frame.Initialize(None)?;
                frame.SetSize(w, h)?;
                let mut fmt = GUID_WICPixelFormat32bppRGBA;
                frame.SetPixelFormat(&mut fmt)?;
                let bitmap = factory.CreateBitmapFromMemory(
                    w,
                    h,
                    &GUID_WICPixelFormat32bppRGBA,
                    w * 4,
                    rgba.as_raw(),
                )?;
                frame.WriteSource(&bitmap, std::ptr::null())?;
                frame.Commit()?;
                encoder.Commit()?;
                Ok(())
            })();
            match r {
                Ok(()) => println!("wrote {}", path.display()),
                Err(e) => {
                    let _ = std::fs::remove_file(&path);
                    println!("skip {name}: {e}")
                }
            }
        }
    }
}
