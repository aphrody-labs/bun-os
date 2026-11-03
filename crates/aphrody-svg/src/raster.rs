// SPDX-License-Identifier: Apache-2.0

//! Rasterization with `resvg`: SVG to straight-alpha RGBA, PNG and multi-size ICO.

use std::sync::{Arc, OnceLock};

use resvg::{tiny_skia, usvg};

use crate::{Error, Result};

/// Output size and rendering switches.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct RenderOptions {
    /// Target width in px. With only one side set the other follows the aspect ratio; with
    /// neither, the intrinsic size is used.
    pub width: Option<u32>,
    /// Target height in px.
    pub height: Option<u32>,
    /// Background painted under the drawing (straight RGBA); transparent when `None`.
    pub background: Option<[u8; 4]>,
    /// Load the system fonts so `<text>` renders (first call scans the system once).
    pub system_fonts: bool,
}

impl RenderOptions {
    /// Square output of `size` px.
    #[must_use]
    pub fn square(size: u32) -> Self {
        Self {
            width: Some(size),
            height: Some(size),
            ..Self::default()
        }
    }
}

/// A rendered image: straight (non-premultiplied) RGBA8, row-major.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Raster {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

fn system_fontdb() -> Arc<usvg::fontdb::Database> {
    static DB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        Arc::new(db)
    })
    .clone()
}

/// Parses `svg` into a usvg tree (shared by [`crate::optimize`] and [`crate::diff`]).
///
/// # Errors
/// [`Error::Parse`] when usvg rejects the document.
pub fn parse_tree(svg: &str, system_fonts: bool) -> Result<usvg::Tree> {
    let mut options = usvg::Options::default();
    if system_fonts {
        options.fontdb = system_fontdb();
    }
    usvg::Tree::from_str(svg, &options).map_err(|e| Error::Parse(e.to_string()))
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to 1..=u16::MAX"
)]
fn px(v: f32) -> u32 {
    v.round().clamp(1.0, f32::from(u16::MAX)) as u32
}

fn render_pixmap(svg: &str, options: RenderOptions) -> Result<tiny_skia::Pixmap> {
    let tree = parse_tree(svg, options.system_fonts)?;
    let size = tree.size();
    let (w, h) = match (options.width, options.height) {
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) => (w, px(size.height() * w as f32 / size.width())),
        (None, Some(h)) => (px(size.width() * h as f32 / size.height()), h),
        (None, None) => (px(size.width()), px(size.height())),
    };
    if w == 0 || h == 0 {
        return Err(Error::Invalid("zero output size".into()));
    }
    let mut pixmap = tiny_skia::Pixmap::new(w, h)
        .ok_or_else(|| Error::Raster(format!("cannot allocate {w}x{h}")))?;
    if let Some([r, g, b, a]) = options.background {
        pixmap.fill(tiny_skia::Color::from_rgba8(r, g, b, a));
    }
    let transform =
        tiny_skia::Transform::from_scale(w as f32 / size.width(), h as f32 / size.height());
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Ok(pixmap)
}

/// Renders `svg` to straight-alpha RGBA.
///
/// # Errors
/// Parse failure, zero or unallocatable size.
pub fn render(svg: &str, options: RenderOptions) -> Result<Raster> {
    let pixmap = render_pixmap(svg, options)?;
    let rgba = pixmap
        .pixels()
        .iter()
        .flat_map(|p| {
            let c = p.demultiply();
            [c.red(), c.green(), c.blue(), c.alpha()]
        })
        .collect();
    Ok(Raster {
        width: pixmap.width(),
        height: pixmap.height(),
        rgba,
    })
}

/// Renders `svg` to PNG bytes.
///
/// # Errors
/// As [`render`], plus PNG encoding failures.
pub fn render_png(svg: &str, options: RenderOptions) -> Result<Vec<u8>> {
    render_pixmap(svg, options)?
        .encode_png()
        .map_err(|e| Error::Raster(e.to_string()))
}

/// The Windows shell icon sizes.
pub const WINDOWS_ICO_SIZES: &[u32] = &[16, 20, 24, 32, 40, 48, 64, 256];
/// Favicon sizes.
pub const FAVICON_ICO_SIZES: &[u32] = &[16, 32, 48];

/// Packs PNG images into an ICO container (PNG-compressed entries, Vista+). `images` are
/// `(side, png)` pairs with `1 <= side <= 256`.
///
/// # Errors
/// [`Error::Invalid`] for an empty list, a side out of range or more than `u16::MAX` images.
pub fn pack_ico(images: &[(u32, Vec<u8>)]) -> Result<Vec<u8>> {
    let count =
        u16::try_from(images.len()).map_err(|_| Error::Invalid("too many ICO images".into()))?;
    if count == 0 {
        return Err(Error::Invalid("ICO needs at least one image".into()));
    }
    let mut out = Vec::new();
    out.extend_from_slice(&[0, 0, 1, 0]);
    out.extend_from_slice(&count.to_le_bytes());
    let mut offset = 6 + 16 * u32::from(count);
    for (side, png) in images {
        let dim = match *side {
            256 => 0u8,
            s @ 1..=255 => u8::try_from(s).map_err(|_| Error::Invalid("ICO side".into()))?,
            s => return Err(Error::Invalid(format!("ICO side {s} out of 1..=256"))),
        };
        let len =
            u32::try_from(png.len()).map_err(|_| Error::Invalid("ICO image too large".into()))?;
        out.extend_from_slice(&[dim, dim, 0, 0]);
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&offset.to_le_bytes());
        offset = offset
            .checked_add(len)
            .ok_or_else(|| Error::Invalid("ICO too large".into()))?;
    }
    for (_, png) in images {
        out.extend_from_slice(png);
    }
    Ok(out)
}

/// Every size the Windows 11 shell asks for across DPI scales (16 at 100 % up to 256 jumbo).
pub const WINDOWS_SHELL_ICO_SIZES: &[u32] = &[16, 20, 24, 32, 40, 48, 64, 96, 256];

/// One ICO entry: a PNG stream, or a 32-bit BGRA DIB (the classic layout every Win32 API decodes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IcoImage {
    Png(Vec<u8>),
    Dib(Raster),
}

/// A 32-bit `BITMAPINFOHEADER` DIB with an all-zero AND mask (alpha carries transparency).
fn dib(r: &Raster) -> Result<Vec<u8>> {
    let (w, h) = (r.width as usize, r.height as usize);
    if r.rgba.len() != w * h * 4 {
        return Err(Error::Invalid("raster size mismatch".into()));
    }
    let mask_row = w.div_ceil(32) * 4;
    let mut out = Vec::with_capacity(40 + w * h * 4 + mask_row * h);
    let as_i32 = |v: usize| i32::try_from(v).map_err(|_| Error::Invalid("DIB too large".into()));
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&as_i32(w)?.to_le_bytes());
    out.extend_from_slice(&as_i32(h * 2)?.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&[0u8; 24]);
    for row in (0..h).rev() {
        for p in r.rgba[row * w * 4..(row + 1) * w * 4].chunks_exact(4) {
            out.extend_from_slice(&[p[2], p[1], p[0], p[3]]);
        }
    }
    out.resize(out.len() + mask_row * h, 0);
    Ok(out)
}

/// Packs mixed PNG/DIB entries into an ICO container, sorted as given. Sides are `1..=256`.
///
/// # Errors
/// [`Error::Invalid`] for an empty list, a side out of range or an oversized image.
pub fn pack_ico_mixed(images: &[(u32, IcoImage)]) -> Result<Vec<u8>> {
    let count =
        u16::try_from(images.len()).map_err(|_| Error::Invalid("too many ICO images".into()))?;
    if count == 0 {
        return Err(Error::Invalid("ICO needs at least one image".into()));
    }
    let blobs = images
        .iter()
        .map(|(_, image)| match image {
            IcoImage::Png(png) => Ok(png.clone()),
            IcoImage::Dib(raster) => dib(raster),
        })
        .collect::<Result<Vec<_>>>()?;
    let mut out = Vec::new();
    out.extend_from_slice(&[0, 0, 1, 0]);
    out.extend_from_slice(&count.to_le_bytes());
    let mut offset = 6 + 16 * u32::from(count);
    for ((side, _), blob) in images.iter().zip(&blobs) {
        let dim = match *side {
            256 => 0u8,
            s @ 1..=255 => u8::try_from(s).map_err(|_| Error::Invalid("ICO side".into()))?,
            s => return Err(Error::Invalid(format!("ICO side {s} out of 1..=256"))),
        };
        let len =
            u32::try_from(blob.len()).map_err(|_| Error::Invalid("ICO image too large".into()))?;
        out.extend_from_slice(&[dim, dim, 0, 0]);
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&offset.to_le_bytes());
        offset = offset
            .checked_add(len)
            .ok_or_else(|| Error::Invalid("ICO too large".into()))?;
    }
    for blob in &blobs {
        out.extend_from_slice(blob);
    }
    Ok(out)
}

/// The Windows shell layout: 32-bit DIB entries below 256 px and a PNG-compressed 256 px entry,
/// each size rendered from its own SVG (`svg_for(size)`, so small sizes can drop detail).
///
/// # Errors
/// As [`render`], [`render_png`] and [`pack_ico_mixed`].
pub fn render_ico_windows<'a>(
    svg_for: impl Fn(u32) -> &'a str,
    sizes: &[u32],
) -> Result<Vec<u8>> {
    let images = sizes
        .iter()
        .map(|&s| {
            let svg = svg_for(s);
            let image = if s >= 256 {
                IcoImage::Png(render_png(svg, RenderOptions::square(s))?)
            } else {
                IcoImage::Dib(render(svg, RenderOptions::square(s))?)
            };
            Ok((s, image))
        })
        .collect::<Result<Vec<_>>>()?;
    pack_ico_mixed(&images)
}

/// Renders `svg` once per size (square) and packs the result as an ICO.
///
/// # Errors
/// As [`render_png`] and [`pack_ico`].
pub fn render_ico(svg: &str, sizes: &[u32]) -> Result<Vec<u8>> {
    let images = sizes
        .iter()
        .map(|&s| render_png(svg, RenderOptions::square(s)).map(|png| (s, png)))
        .collect::<Result<Vec<_>>>()?;
    pack_ico(&images)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_ico_mixes_dib_and_png() {
        let ico = render_ico_windows(|_| RED, &[16, 256]).expect("ico");
        assert_eq!(&ico[..6], &[0, 0, 1, 0, 2, 0]);
        let off16 = u32::from_le_bytes(ico[18..22].try_into().unwrap()) as usize;
        assert_eq!(&ico[off16..off16 + 4], &40u32.to_le_bytes());
        let len16 = u32::from_le_bytes(ico[14..18].try_into().unwrap()) as usize;
        assert_eq!(len16, 40 + 16 * 16 * 4 + 4 * 16);
        let off256 = u32::from_le_bytes(ico[34..38].try_into().unwrap()) as usize;
        assert_eq!(&ico[off256..off256 + 4], b"\x89PNG");
        assert_eq!(ico[22], 0, "256 px is encoded as 0");
    }

    const RED: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><rect width="10" height="20" fill="#f00"/></svg>"##;

    #[test]
    fn renders_with_aspect_ratio() {
        let r = render(
            RED,
            RenderOptions {
                width: Some(20),
                ..RenderOptions::default()
            },
        )
        .expect("ok");
        assert_eq!((r.width, r.height), (20, 40));
        assert_eq!(&r.rgba[..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn png_and_ico_have_signatures() {
        let png = render_png(RED, RenderOptions::square(8)).expect("png");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let ico = render_ico(RED, FAVICON_ICO_SIZES).expect("ico");
        assert_eq!(&ico[..6], &[0, 0, 1, 0, 3, 0]);
        assert_eq!(ico[6], 16);
        let first_offset = u32::from_le_bytes([ico[18], ico[19], ico[20], ico[21]]) as usize;
        assert_eq!(first_offset, 6 + 16 * 3);
        assert_eq!(&ico[first_offset..first_offset + 4], b"\x89PNG");
        assert!(pack_ico(&[(300, vec![])]).is_err());
    }
}
