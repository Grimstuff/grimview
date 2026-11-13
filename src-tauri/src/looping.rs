//! Make animated images loop forever.
//!
//! WebView2 honours the loop count stored in the file: a GIF without a NETSCAPE2.0 block
//! plays once, and GIF / APNG / animated WebP with a finite count stop after that many
//! plays. A viewer should keep them going, so the bytes sent to the webview get their
//! loop count set to 0 (infinite). The file on disk is never touched. Anything that does
//! not parse cleanly is passed through unchanged.

/// Returns the bytes with the loop count forced to infinite, or unchanged if not animated.
pub fn force_infinite(bytes: Vec<u8>) -> Vec<u8> {
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        gif(bytes)
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        apng(bytes)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        webp(bytes)
    } else {
        bytes
    }
}

// ---- GIF -------------------------------------------------------------------------------

/// NETSCAPE2.0 application extension with loop count 0.
const NETSCAPE_LOOP: [u8; 19] = [
    0x21, 0xFF, 0x0B, b'N', b'E', b'T', b'S', b'C', b'A', b'P', b'E', b'2', b'.', b'0', 0x03,
    0x01, 0x00, 0x00, 0x00,
];

/// Skips a run of data sub-blocks starting at `i`; returns the index after the terminator.
fn skip_sub_blocks(b: &[u8], mut i: usize) -> Option<usize> {
    loop {
        let n = *b.get(i)? as usize;
        i += 1;
        if n == 0 {
            return Some(i);
        }
        i += n;
    }
}

fn gif(mut b: Vec<u8>) -> Vec<u8> {
    // Header (6) + logical screen descriptor (7) + optional global color table.
    if b.len() < 13 {
        return b;
    }
    let mut i = 13;
    if b[10] & 0x80 != 0 {
        i += 3 << ((b[10] & 0x07) + 1);
    }
    let after_gct = i;
    let mut frames = 0usize;
    // Position of the loop count's two bytes inside an existing loop block.
    let mut loop_at: Option<usize> = None;
    loop {
        match b.get(i) {
            Some(0x21) => {
                let label = match b.get(i + 1) {
                    Some(&l) => l,
                    None => return b,
                };
                if label == 0xFF && b.get(i + 2) == Some(&0x0B) && i + 14 <= b.len() {
                    let id = &b[i + 3..i + 14];
                    if (id == b"NETSCAPE2.0" || id == b"ANIMEXTS1.0")
                        && b.get(i + 14) == Some(&0x03)
                        && b.get(i + 15) == Some(&0x01)
                        && i + 18 <= b.len()
                    {
                        loop_at.get_or_insert(i + 16);
                    }
                }
                i = match skip_sub_blocks(&b, i + 2) {
                    Some(n) => n,
                    None => return b,
                };
            }
            Some(0x2C) => {
                frames += 1;
                let packed = match b.get(i + 9) {
                    Some(&p) => p,
                    None => return b,
                };
                i += 10;
                if packed & 0x80 != 0 {
                    i += 3 << ((packed & 0x07) + 1);
                }
                // LZW minimum code size, then the image data sub-blocks.
                i = match skip_sub_blocks(&b, i + 1) {
                    Some(n) => n,
                    None => return b,
                };
            }
            // Trailer, or a truncated file: whatever was read is enough to decide.
            Some(0x3B) | None => break,
            Some(_) => return b,
        }
    }
    if frames < 2 {
        return b;
    }
    match loop_at {
        Some(at) => {
            b[at] = 0;
            b[at + 1] = 0;
        }
        None => {
            b.splice(after_gct..after_gct, NETSCAPE_LOOP);
        }
    }
    b
}

// ---- APNG ------------------------------------------------------------------------------

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

fn apng(mut b: Vec<u8>) -> Vec<u8> {
    let mut i = 8;
    while i + 12 <= b.len() {
        let len = u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize;
        let kind = [b[i + 4], b[i + 5], b[i + 6], b[i + 7]];
        let end = match (i + 12).checked_add(len) {
            Some(e) if e <= b.len() => e,
            _ => return b,
        };
        match &kind {
            b"acTL" if len == 8 => {
                // num_frames (4), num_plays (4).
                if b[i + 12..i + 16] != [0, 0, 0, 0] {
                    b[i + 12..i + 16].copy_from_slice(&[0, 0, 0, 0]);
                    let crc = crc32(&b[i + 4..i + 16]);
                    b[i + 16..i + 20].copy_from_slice(&crc.to_be_bytes());
                }
                return b;
            }
            // acTL must come before the image data.
            b"IDAT" | b"IEND" => return b,
            _ => {}
        }
        i = end;
    }
    b
}

// ---- WebP ------------------------------------------------------------------------------

fn webp(mut b: Vec<u8>) -> Vec<u8> {
    let mut i = 12;
    while i + 8 <= b.len() {
        let kind = [b[i], b[i + 1], b[i + 2], b[i + 3]];
        let len = u32::from_le_bytes([b[i + 4], b[i + 5], b[i + 6], b[i + 7]]) as usize;
        if &kind == b"ANIM" {
            // Background color (4), loop count (2, little-endian).
            if len >= 6 && i + 14 <= b.len() {
                b[i + 12] = 0;
                b[i + 13] = 0;
            }
            return b;
        }
        if &kind == b"ANMF" || &kind == b"VP8 " || &kind == b"VP8L" {
            return b;
        }
        i = match (i + 8).checked_add(len + (len & 1)) {
            Some(n) => n,
            None => return b,
        };
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal GIF: 1x1, 2-color global table, `frames` frames, optional loop block.
    fn make_gif(frames: usize, loop_count: Option<u16>) -> Vec<u8> {
        let mut b = b"GIF89a".to_vec();
        b.extend_from_slice(&[1, 0, 1, 0, 0x80, 0, 0]);
        b.extend_from_slice(&[0, 0, 0, 255, 255, 255]);
        if let Some(n) = loop_count {
            let mut ext = NETSCAPE_LOOP;
            ext[16..18].copy_from_slice(&n.to_le_bytes());
            b.extend_from_slice(&ext);
        }
        for _ in 0..frames {
            b.extend_from_slice(&[0x21, 0xF9, 4, 0, 10, 0, 0, 0]);
            b.extend_from_slice(&[0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0]);
            b.extend_from_slice(&[2, 2, 0x44, 0x01, 0]);
        }
        b.push(0x3B);
        b
    }

    fn loop_count_of(b: &[u8]) -> Option<u16> {
        let pos = b.windows(11).position(|w| w == b"NETSCAPE2.0")?;
        Some(u16::from_le_bytes([b[pos + 13], b[pos + 14]]))
    }

    #[test]
    fn gif_without_loop_block_gets_one() {
        let out = force_infinite(make_gif(3, None));
        assert_eq!(loop_count_of(&out), Some(0));
        assert_eq!(out.len(), make_gif(3, None).len() + NETSCAPE_LOOP.len());
        assert_eq!(&out[19..22], &[0x21, 0xFF, 0x0B]);
    }

    #[test]
    fn gif_finite_loop_becomes_infinite() {
        let input = make_gif(2, Some(3));
        let out = force_infinite(input.clone());
        assert_eq!(out.len(), input.len());
        assert_eq!(loop_count_of(&out), Some(0));
    }

    #[test]
    fn still_gif_untouched() {
        let input = make_gif(1, None);
        assert_eq!(force_infinite(input.clone()), input);
    }

    #[test]
    fn gif_decodes_after_patch() {
        use image::AnimationDecoder;
        let out = force_infinite(make_gif(3, None));
        let dec = image::codecs::gif::GifDecoder::new(std::io::Cursor::new(out)).unwrap();
        assert_eq!(dec.into_frames().count(), 3);
    }

    #[test]
    fn apng_plays_forever_with_valid_crc() {
        let mut b = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut chunk = |kind: &[u8], data: &[u8]| {
            b.extend_from_slice(&(data.len() as u32).to_be_bytes());
            let mut body = kind.to_vec();
            body.extend_from_slice(data);
            b.extend_from_slice(&body);
            b.extend_from_slice(&crc32(&body).to_be_bytes());
        };
        chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
        chunk(b"acTL", &[0, 0, 0, 2, 0, 0, 0, 1]);
        chunk(b"IEND", &[]);
        let out = force_infinite(b);
        let at = out.windows(4).position(|w| w == b"acTL").unwrap();
        assert_eq!(&out[at + 8..at + 12], &[0, 0, 0, 0]);
        let crc = u32::from_be_bytes(out[at + 12..at + 16].try_into().unwrap());
        assert_eq!(crc, crc32(&out[at..at + 12]));
    }

    #[test]
    fn crc_matches_reference() {
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
    }

    #[test]
    fn webp_anim_loop_cleared() {
        let mut b = b"RIFF\0\0\0\0WEBP".to_vec();
        b.extend_from_slice(b"VP8X");
        b.extend_from_slice(&10u32.to_le_bytes());
        b.extend_from_slice(&[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        b.extend_from_slice(b"ANIM");
        b.extend_from_slice(&6u32.to_le_bytes());
        b.extend_from_slice(&[0, 0, 0, 0, 5, 0]);
        let out = force_infinite(b);
        let at = out.windows(4).position(|w| w == b"ANIM").unwrap();
        assert_eq!(&out[at + 12..at + 14], &[0, 0]);
    }
}
