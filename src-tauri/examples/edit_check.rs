//! Smoke test for editing and Open with. `cargo run --example edit_check -- <samples dir>`

use std::path::Path;

use grimview_lib::edit::{apply, not_editable_reason, EditOp};

fn main() {
    let dir = std::env::args().nth(1).expect("samples dir");
    let dir = Path::new(&dir);
    for name in ["02-photo.jpg", "01-alpha.png", "15-animated.gif", "20-phone.heic", "04-lossless.webp"] {
        println!("{name}: editable = {:?}", not_editable_reason(&dir.join(name)));
    }
    let jpg = dir.join("02-photo.jpg");
    for op in [
        EditOp::Rotate { turns: 1 },
        EditOp::Crop { x: 100, y: 50, w: 400, h: 300 },
        EditOp::Resize { w: 600, h: 400 },
    ] {
        match apply(&jpg, op, true) {
            Ok(p) => {
                let img = image::open(&p).unwrap();
                println!("saved {p} -> {}x{}", img.width(), img.height());
            }
            Err(e) => println!("FAIL {e}"),
        }
    }
    let png = dir.join("01-alpha.png");
    println!("png crop: {:?}", apply(&png, EditOp::Crop { x: 0, y: 0, w: 64, h: 64 }, true));
    for h in grimview_lib::shell::open_with_handlers(jpg.to_string_lossy().into_owned()) {
        println!("open with: {} [{}]", h.name, h.id);
    }
}
