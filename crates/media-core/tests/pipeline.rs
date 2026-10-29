//! Real files in, edit stack applied, export, hash/PSNR checks, cross-app handoff.

use image::{ImageFormat, Rgba, RgbaImage};
use media_core::ai::{AiBackend, AiKind, NoBackend};
use media_core::asset::{self, ProxyCache};
use media_core::engine::{self, psnr};
use media_core::graph::{EditStack, Filter, Op};
use media_core::project::{Handoff, Item, Project};
use std::io::Cursor;

fn sample(w: u32, h: u32) -> RgbaImage {
    RgbaImage::from_fn(w, h, |x, y| {
        let band = if (x / 16 + y / 16) % 2 == 0 { 40 } else { 0 };
        Rgba([(x * 255 / w) as u8, (y * 255 / h) as u8, 90 + band, 255])
    })
}

fn encode(img: &RgbaImage, fmt: ImageFormat) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    if fmt == ImageFormat::Jpeg {
        image::DynamicImage::ImageRgba8(img.clone()).to_rgb8().write_to(&mut out, fmt).unwrap();
    } else {
        img.write_to(&mut out, fmt).unwrap();
    }
    out.into_inner()
}

#[test]
fn lossless_formats_roundtrip_exactly_and_lossy_stays_close() {
    let src = sample(256, 192);
    for (fmt, min_psnr) in [
        (ImageFormat::Png, f64::INFINITY),
        (ImageFormat::WebP, f64::INFINITY),
        (ImageFormat::Bmp, f64::INFINITY),
        (ImageFormat::Tiff, f64::INFINITY),
        (ImageFormat::Jpeg, 30.0),
    ] {
        let bytes = encode(&src, fmt);
        let meta = asset::probe(&bytes).unwrap();
        assert_eq!((meta.width, meta.height), (256, 192), "{fmt:?}");
        assert_eq!(meta.bytes, bytes.len() as u64);
        let dec = asset::decode(&bytes, meta.orientation).unwrap();
        let p = psnr(&src, &dec).unwrap();
        assert!(p >= min_psnr, "{fmt:?} psnr {p}");
    }
}

#[test]
fn asset_id_is_content_hash() {
    let a = encode(&sample(32, 32), ImageFormat::Png);
    let mut b = a.clone();
    assert_eq!(asset::probe(&a).unwrap().id, asset::probe(&b).unwrap().id);
    assert_eq!(asset::probe(&a).unwrap().id.0, blake3::hash(&a).to_hex().to_string());
    // The tail of a PNG is IEND+CRC; flipping a pixel byte in IDAT changes the id.
    let n = b.len() / 2;
    b[n] ^= 1;
    assert_ne!(blake3::hash(&a), blake3::hash(&b));
}

#[test]
fn edit_stack_is_deterministic_and_matches_manual_ops() {
    let src = sample(200, 100);
    let stack = EditStack::new()
        .push(Op::Crop { x: 10, y: 10, w: 160, h: 80 })
        .push(Op::Resize { w: 80, h: 40, filter: Filter::Lanczos3 })
        .push(Op::Grayscale)
        .push(Op::Invert);
    let a = engine::render(&src, &stack, &NoBackend).unwrap();
    let b = engine::render(&src, &stack, &NoBackend).unwrap();
    assert_eq!(a, b);
    assert_eq!(a.dimensions(), (80, 40));
    assert_eq!(stack.digest(), stack.clone().digest());
    // Grayscale then invert: all channels equal, alpha untouched.
    assert!(a.pixels().all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255));
    // Inverting twice restores the pre-invert image.
    let twice = EditStack::new().push(Op::Invert).push(Op::Invert);
    assert_eq!(engine::render(&src, &twice, &NoBackend).unwrap(), src);
}

#[test]
fn resize_down_then_compare_with_reference_filter() {
    let src = sample(512, 384);
    let fir = engine::resize(&src, 128, 96, Filter::Lanczos3).unwrap();
    let reference = image::imageops::resize(&src, 128, 96, image::imageops::FilterType::Lanczos3);
    let p = psnr(&fir, &reference).unwrap();
    assert!(p > 35.0, "fast_image_resize vs image::Lanczos3 psnr {p}");
}

#[test]
fn invalid_ops_and_missing_ai_backend_fail_loudly() {
    let src = sample(10, 10);
    let bad = EditStack::new().push(Op::Crop { x: 5, y: 5, w: 10, h: 10 });
    assert!(engine::render(&src, &bad, &NoBackend).is_err());
    let ai = EditStack::new().push(Op::Ai { kind: AiKind::Upscale, params: "{\"scale\":2}".into() });
    let err = engine::render(&src, &ai, &NoBackend).unwrap_err();
    assert!(err.to_string().contains("no backend"), "{err}");
}

struct Doubler;
impl AiBackend for Doubler {
    fn run(&self, k: AiKind, img: &RgbaImage, p: &serde_json::Value) -> media_core::Result<RgbaImage> {
        assert_eq!(k, AiKind::Upscale);
        let s = p["scale"].as_u64().unwrap() as u32;
        engine::resize(img, img.width() * s, img.height() * s, Filter::Mitchell)
    }
}

#[test]
fn ai_hook_runs_through_backend_inside_the_stack() {
    let src = sample(40, 30);
    let stack = EditStack::new()
        .push(Op::Ai { kind: AiKind::Upscale, params: "{\"scale\":2}".into() })
        .push(Op::Blur { sigma_milli: 1000 });
    let out = engine::render(&src, &stack, &Doubler).unwrap();
    assert_eq!(out.dimensions(), (80, 60));
}

#[test]
fn proxy_cache_hits_on_second_call_and_keys_on_stack() {
    let dir = std::env::temp_dir().join(format!("media-core-proxy-{}", std::process::id()));
    let cache = ProxyCache::open(&dir).unwrap();
    let bytes = encode(&sample(640, 480), ImageFormat::Png);
    let s1 = EditStack::new().push(Op::Grayscale);
    let s2 = EditStack::new().push(Op::Invert);
    let (p1, hit1) = cache.get_or_render(&bytes, &s1, 160, &NoBackend).unwrap();
    let (p1b, hit2) = cache.get_or_render(&bytes, &s1, 160, &NoBackend).unwrap();
    let (p2, _) = cache.get_or_render(&bytes, &s2, 160, &NoBackend).unwrap();
    assert!(!hit1 && hit2);
    assert_eq!(p1, p1b);
    assert_ne!(p1, p2);
    assert_eq!(image::open(&p1).unwrap().width(), 160);
    std::fs::remove_dir_all(&dir).ok();
}

/// "Library -> photocraft -> filmcraft frame range -> effectcraft" style handoff: the receiving
/// app gets the asset, the stack and the frame range, and renders the identical pixels.
#[test]
fn handoff_between_two_apps_reproduces_identical_pixels() {
    let root = std::env::temp_dir().join(format!("media-core-handoff-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join("photo.png");
    let bytes = encode(&sample(300, 200), ImageFormat::Png);
    std::fs::write(&file, &bytes).unwrap();

    // App A (photocraft): edit and hand off.
    let meta = asset::probe(&bytes).unwrap();
    let stack = EditStack::new()
        .push(Op::Brightness { delta: 20 })
        .push(Op::Resize { w: 150, h: 100, filter: Filter::Bilinear });
    let rendered_a = engine::render(&asset::decode(&bytes, meta.orientation).unwrap(), &stack, &NoBackend).unwrap();
    let inbox = root.join("inbox");
    Handoff {
        from: "photocraft".into(),
        to: "effectcraft".into(),
        asset: meta.clone(),
        path: file.clone(),
        stack: stack.clone(),
        frames: Some((120, 240)),
    }
    .send(&inbox)
    .unwrap();
    assert!(Handoff::receive(&inbox, "filmcraft").unwrap().is_none());

    // App B (effectcraft): receive, reload from the library path, verify the hash, render.
    let h = Handoff::receive(&inbox, "effectcraft").unwrap().expect("pending handoff");
    assert_eq!(h.from, "photocraft");
    assert_eq!(h.frames, Some((120, 240)));
    let bytes_b = std::fs::read(&h.path).unwrap();
    assert_eq!(asset::probe(&bytes_b).unwrap().id, h.asset.id);
    let rendered_b = engine::render(&asset::decode(&bytes_b, h.asset.orientation).unwrap(), &h.stack, &NoBackend).unwrap();
    assert_eq!(rendered_a, rendered_b);
    assert!(Handoff::receive(&inbox, "effectcraft").unwrap().is_none());

    // Project roundtrip with the item.
    let mut proj = Project::new("demo");
    proj.add_asset(meta.clone(), file);
    proj.items.push(Item { asset: meta.id, stack, frames: h.frames });
    let pf = root.join("demo.mcproj");
    proj.save(&pf).unwrap();
    assert_eq!(Project::load(&pf).unwrap(), proj);
    std::fs::remove_dir_all(&root).ok();
}
