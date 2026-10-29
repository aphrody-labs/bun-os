//! Fair comparison: same input, same output size, same filter (Lanczos3), same CPU, multi-thread
//! where the library offers it (fast_image_resize with its `rayon` feature, lightcraft-raster with
//! `parallel`). `image` is the single-thread reference.
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use fast_image_resize::images::Image as Fir;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use lightcraft_raster::{Image, resample};
use media_core::graph::Filter;
use std::hint::black_box;

fn gradient(w: u32, h: u32) -> image::RgbaImage {
    image::RgbaImage::from_fn(w, h, |x, y| {
        image::Rgba([(x * 255 / w) as u8, (y * 255 / h) as u8, ((x ^ y) & 255) as u8, 255])
    })
}

fn to_f32(img: &image::RgbaImage) -> Image<[f32; 4]> {
    Image {
        width: img.width() as usize,
        height: img.height() as usize,
        data: img
            .pixels()
            .map(|p| [p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0, 1.0])
            .collect(),
    }
}

fn f32_bytes(img: &Image<[f32; 4]>) -> Vec<u8> {
    img.data.iter().flatten().flat_map(|v| v.to_ne_bytes()).collect()
}

fn load() -> String {
    std::fs::read_to_string("/proc/loadavg").unwrap_or_default().trim().to_string()
}

fn bench(c: &mut Criterion) {
    eprintln!("loadavg at start: {}", load());
    let opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    // (source, destination) sizes
    for (sw, sh, dw, dh) in [(1024u32, 768u32, 512u32, 384u32), (4000, 3000, 1280, 960), (6000, 4000, 1500, 1000)] {
        let src = gradient(sw, sh);
        let srcf = to_f32(&src);
        let fir_u8 = Fir::from_vec_u8(sw, sh, src.as_raw().clone(), PixelType::U8x4).unwrap();
        let fir_f32 = Fir::from_vec_u8(sw, sh, f32_bytes(&srcf), PixelType::F32x4).unwrap();
        let mut g = c.benchmark_group(format!("resize_{sw}x{sh}_to_{dw}x{dh}_lanczos3"));
        g.sample_size(20);
        let id = |n: &str| BenchmarkId::from_parameter(n);
        g.bench_function(id("fir_u8x4_rayon"), |b| {
            b.iter(|| {
                let mut d = Fir::new(dw, dh, PixelType::U8x4);
                Resizer::new().resize(black_box(&fir_u8), &mut d, &opts).unwrap();
                d
            })
        });
        g.bench_function(id("fir_f32x4_rayon"), |b| {
            b.iter(|| {
                let mut d = Fir::new(dw, dh, PixelType::F32x4);
                Resizer::new().resize(black_box(&fir_f32), &mut d, &opts).unwrap();
                d
            })
        });
        g.bench_function(id("lightcraft_raster_f32x4"), |b| {
            b.iter(|| resample::resize(black_box(&srcf), dw as usize, dh as usize, resample::Filter::Lanczos3))
        });
        g.bench_function(id("media_core_u8x4_in_out"), |b| {
            b.iter(|| media_core::engine::resize(black_box(&src), dw, dh, Filter::Lanczos3).unwrap())
        });
        g.bench_function(id("image_crate_u8x4_1thread"), |b| {
            b.iter(|| image::imageops::resize(black_box(&src), dw, dh, image::imageops::FilterType::Lanczos3))
        });
        g.finish();
    }

    let small = gradient(1920, 1080);
    let smallf = to_f32(&small);
    for sigma in [2.0f32, 8.0, 24.0] {
        let mut g = c.benchmark_group(format!("gaussian_blur_1920x1080_sigma{sigma}"));
        g.sample_size(10);
        g.bench_function("lightcraft_raster_f32x4", |b| {
            b.iter(|| lightcraft_raster::blur::gaussian(black_box(&smallf), sigma))
        });
        g.bench_function("media_core_u8x4_in_out", |b| {
            b.iter(|| media_core::engine::blur(black_box(&small), sigma).unwrap())
        });
        g.bench_function("image_crate_u8x4_1thread", |b| {
            b.iter(|| image::imageops::blur(black_box(&small), sigma))
        });
        g.finish();
    }
    eprintln!("loadavg at end: {}", load());
}

criterion_group!(benches, bench);
criterion_main!(benches);
