//! Runs every file in a folder through the Rust decoder and prints the result.
//! `cargo run --release --example decode_check -- <dir>`

use std::time::Instant;

fn main() {
    let dir = std::env::args().nth(1).expect("folder");
    let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        let t = Instant::now();
        match grimview_lib::decode_to_png(&p) {
            Ok(png) => {
                let img = image::load_from_memory(&png).unwrap();
                println!(
                    "ok   {:<28} {}x{} {:>5} ms",
                    p.file_name().unwrap().to_string_lossy(),
                    img.width(),
                    img.height(),
                    t.elapsed().as_millis()
                );
            }
            Err(e) => println!("FAIL {:<28} {e}", p.file_name().unwrap().to_string_lossy()),
        }
    }
}
