//! Renders an [`EditStack`] on an RGBA8 image.

use crate::ai::AiBackend;
use crate::graph::{EditStack, Filter, Op};
use crate::{Error, Result};
use image::RgbaImage;
use rayon::prelude::*;

use lightcraft_raster::{Image, resample};

fn filter(f: Filter) -> resample::Filter {
    match f {
        Filter::Box => resample::Filter::Box,
        Filter::Bilinear => resample::Filter::Bilinear,
        Filter::Mitchell => resample::Filter::Mitchell,
        Filter::Lanczos3 => resample::Filter::Lanczos3,
    }
}

/// RGBA8 -> premultiplied f32 planes of the canonical `lightcraft-raster` image type.
fn to_f32(img: &RgbaImage) -> Image<[f32; 4]> {
    Image {
        width: img.width() as usize,
        height: img.height() as usize,
        data: img
            .pixels()
            .map(|p| {
                let a = f32::from(p[3]) / 255.0;
                [f32::from(p[0]) / 255.0 * a, f32::from(p[1]) / 255.0 * a, f32::from(p[2]) / 255.0 * a, a]
            })
            .collect(),
    }
}

fn from_f32(img: &Image<[f32; 4]>) -> Result<RgbaImage> {
    let mut raw = Vec::with_capacity(img.data.len() * 4);
    for p in &img.data {
        let a = p[3].clamp(0.0, 1.0);
        let inv = if a > 0.0 { 1.0 / a } else { 0.0 };
        for c in 0..3 {
            raw.push(((p[c] * inv).clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
        }
        raw.push((a * 255.0 + 0.5) as u8);
    }
    RgbaImage::from_raw(img.width as u32, img.height as u32, raw)
        .ok_or_else(|| Error::Resize("buffer size".into()))
}

/// Resize with the canonical `lightcraft-raster` separable resampler (rayon rows, premultiplied
/// alpha). Measured faster than fast_image_resize 6.1 (single thread) and `image`; see docs/MEDIA.md.
pub fn resize(img: &RgbaImage, w: u32, h: u32, f: Filter) -> Result<RgbaImage> {
    if w == 0 || h == 0 {
        return Err(Error::Invalid("resize to zero size".into()));
    }
    from_f32(&resample::resize(&to_f32(img), w as usize, h as usize, filter(f)))
}

/// Gaussian blur with the canonical `lightcraft-raster` O(1)-per-pixel box-cascade blur.
pub fn blur(img: &RgbaImage, sigma: f32) -> Result<RgbaImage> {
    from_f32(&lightcraft_raster::blur::gaussian(&to_f32(img), sigma))
}

fn map_rgb(img: &mut RgbaImage, f: impl Fn(u8) -> u8 + Sync) {
    img.par_chunks_mut(4096 * 4).for_each(|chunk| {
        for px in chunk.chunks_exact_mut(4) {
            px[0] = f(px[0]);
            px[1] = f(px[1]);
            px[2] = f(px[2]);
        }
    });
}

/// Apply a single operation.
pub fn apply(img: RgbaImage, op: &Op, ai: &dyn AiBackend) -> Result<RgbaImage> {
    match op {
        Op::Crop { x, y, w, h } => {
            if *w == 0
                || *h == 0
                || x.saturating_add(*w) > img.width()
                || y.saturating_add(*h) > img.height()
            {
                return Err(Error::Invalid(format!(
                    "crop {x},{y} {w}x{h} outside {}x{}",
                    img.width(),
                    img.height()
                )));
            }
            Ok(image::imageops::crop_imm(&img, *x, *y, *w, *h).to_image())
        }
        Op::Resize { w, h, filter } => resize(&img, *w, *h, *filter),
        Op::Blur { sigma_milli } => blur(&img, *sigma_milli as f32 / 1000.0),
        Op::Brightness { delta } => {
            let mut img = img;
            let d = *delta;
            map_rgb(&mut img, |v| (v as i32 + d).clamp(0, 255) as u8);
            Ok(img)
        }
        Op::Contrast { factor_milli } => {
            let mut img = img;
            let f = *factor_milli as f32 / 1000.0;
            map_rgb(&mut img, |v| ((v as f32 - 127.5) * f + 127.5).round().clamp(0.0, 255.0) as u8);
            Ok(img)
        }
        Op::Grayscale => {
            let mut img = img;
            img.par_chunks_mut(4096 * 4).for_each(|chunk| {
                for px in chunk.chunks_exact_mut(4) {
                    // Rec. 709 luma on the stored (display-encoded) values.
                    let y = (0.2126 * px[0] as f32 + 0.7152 * px[1] as f32 + 0.0722 * px[2] as f32)
                        .round() as u8;
                    px[0] = y;
                    px[1] = y;
                    px[2] = y;
                }
            });
            Ok(img)
        }
        Op::Invert => {
            let mut img = img;
            map_rgb(&mut img, |v| 255 - v);
            Ok(img)
        }
        Op::FlipH => Ok(image::imageops::flip_horizontal(&img)),
        Op::FlipV => Ok(image::imageops::flip_vertical(&img)),
        Op::Rotate90 => Ok(image::imageops::rotate90(&img)),
        Op::Ai { kind, params } => {
            let p: serde_json::Value = if params.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::from_str(params)?
            };
            ai.run(*kind, &img, &p)
        }
    }
}

/// Render a whole stack.
pub fn render(src: &RgbaImage, stack: &EditStack, ai: &dyn AiBackend) -> Result<RgbaImage> {
    let mut img = src.clone();
    for op in &stack.ops {
        img = apply(img, op, ai)?;
    }
    Ok(img)
}

/// Peak signal-to-noise ratio over RGBA8 samples in dB (`INFINITY` when identical, `None` when
/// the sizes differ).
pub fn psnr(a: &RgbaImage, b: &RgbaImage) -> Option<f64> {
    if a.dimensions() != b.dimensions() {
        return None;
    }
    let se: f64 = a
        .as_raw()
        .par_iter()
        .zip(b.as_raw().par_iter())
        .map(|(x, y)| {
            let d = f64::from(*x) - f64::from(*y);
            d * d
        })
        .sum();
    if se == 0.0 {
        return Some(f64::INFINITY);
    }
    let mse = se / a.as_raw().len() as f64;
    Some(10.0 * (255.0f64 * 255.0 / mse).log10())
}
