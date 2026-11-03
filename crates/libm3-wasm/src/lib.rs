//! WebAssembly ABI over the canonical Material 3 engine (`aphrody-m3-tokens`). Browsers and Bun load it through `@aphrody/m3-tokens/wasm`; no other
//! colour engine runs on the web.
//!
//! Scalar exports take and return numbers only. The three buffer exports (`schemeFromSeed`,
//! `themeFromImage`, `applyDynamicColor`) exchange bytes through linear memory that the host
//! allocates with `m3_alloc` and releases with `m3_dealloc`; every pointer and length is checked
//! against the allocation table before it is read or written.
use std::{collections::BTreeMap, sync::Mutex};

use aphrody_m3_tokens::{
    hct::Hct, image::source_color_from_rgba8, role::Role, scheme::Variant, shape, sheets,
    theme::ThemeRequest, typography,
};

/// Host allocations: start address -> length. Only these ranges are ever dereferenced.
static ALLOCATIONS: Mutex<BTreeMap<usize, usize>> = Mutex::new(BTreeMap::new());
/// Text produced by `applyDynamicColor`, read by the host through `m3_output_ptr`.
static OUTPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());

#[unsafe(no_mangle)]
pub extern "C" fn m3_abi_version() -> u32 {
    3
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_color_count() -> u32 {
    Role::ALL.len() as u32
}

/// UTF-8 bytes from the role owner; zero terminates the name or rejects an index.
#[unsafe(no_mangle)]
pub extern "C" fn m3_role_name_byte(role: u32, offset: u32) -> u32 {
    Role::ALL
        .get(role as usize)
        .and_then(|role| role.camel_name().as_bytes().get(offset as usize))
        .map_or(0, |value| u32::from(*value))
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_variant_name_byte(variant: u32, offset: u32) -> u32 {
    Variant::ALL
        .get(variant as usize)
        .and_then(|variant| variant.name().as_bytes().get(offset as usize))
        .map_or(0, |value| u32::from(*value))
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_color(mode: u32, role: u32) -> u32 {
    let Some(role) = Role::ALL.get(role as usize) else {
        return 0;
    };
    if mode > 1 {
        return 0;
    }
    ThemeRequest::default().scheme(mode == 1).argb(*role)
}

#[unsafe(no_mangle)]
pub extern "C" fn m3_variant_count() -> u32 {
    Variant::ALL.len() as u32
}

fn request(seed: u32, variant: u32, contrast: f64, mode: u32) -> Option<(ThemeRequest, bool)> {
    let variant = Variant::ALL.get(variant as usize)?;
    if mode > 1 {
        return None;
    }
    ThemeRequest::new(seed, *variant, contrast)
        .ok()
        .map(|request| (request, mode == 1))
}

/// Zero signals an invalid request; valid colors are always opaque ARGB.
#[unsafe(no_mangle)]
pub extern "C" fn m3_seed_color(
    seed: u32,
    variant: u32,
    contrast: f64,
    mode: u32,
    role: u32,
) -> u32 {
    let Some(role) = Role::ALL.get(role as usize) else {
        return 0;
    };
    request(seed, variant, contrast, mode)
        .map_or(0, |(request, dark)| request.scheme(dark).argb(*role))
}

/// Size in dp of a typescale role (`aphrody_m3_tokens::typography::ALL` order); zero rejects the index.
#[unsafe(no_mangle)]
pub extern "C" fn m3_type_size(role: u32) -> f32 {
    typography::ALL
        .get(role as usize)
        .map_or(0.0, |style| style.size_dp)
}

/// Radius in dp of a corner role (`aphrody_m3_tokens::shape::ALL` order); zero rejects the index.
#[unsafe(no_mangle)]
pub extern "C" fn m3_shape_radius(role: u32) -> u32 {
    shape::ALL
        .get(role as usize)
        .map_or(0, |radius| u32::from(radius.dp))
}

/// HCT hue of an ARGB colour (`Hct.fromInt(argb).hue`).
#[unsafe(no_mangle)]
pub extern "C" fn m3_hct_hue(argb: u32) -> f64 {
    Hct::from_argb(argb).hue
}

/// HCT chroma of an ARGB colour.
#[unsafe(no_mangle)]
pub extern "C" fn m3_hct_chroma(argb: u32) -> f64 {
    Hct::from_argb(argb).chroma
}

/// HCT tone of an ARGB colour.
#[unsafe(no_mangle)]
pub extern "C" fn m3_hct_tone(argb: u32) -> f64 {
    Hct::from_argb(argb).tone
}

/// The displayable ARGB colour closest to hue, chroma and tone (`Hct.from(h, c, t).toInt()`).
#[unsafe(no_mangle)]
pub extern "C" fn m3_hct_to_argb(hue: f64, chroma: f64, tone: f64) -> u32 {
    if !(hue.is_finite() && chroma.is_finite() && tone.is_finite()) {
        return 0;
    }
    Hct::new(hue, chroma, tone).to_argb()
}

/// Reserve `len` bytes of linear memory for the host. Zero means the request was rejected.
#[unsafe(no_mangle)]
pub extern "C" fn m3_alloc(len: u32) -> usize {
    if len == 0 {
        return 0;
    }
    let buffer = vec![0u8; len as usize].into_boxed_slice();
    let address = Box::into_raw(buffer).cast::<u8>() as usize;
    let mut allocations = ALLOCATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    allocations.insert(address, len as usize);
    address
}

/// Release a range previously returned by `m3_alloc`; unknown ranges are ignored.
#[unsafe(no_mangle)]
pub extern "C" fn m3_dealloc(ptr: usize, len: u32) {
    let mut allocations = ALLOCATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if allocations.get(&ptr) != Some(&(len as usize)) {
        return;
    }
    allocations.remove(&ptr);
    let slice = std::ptr::slice_from_raw_parts_mut(ptr as *mut u8, len as usize);
    // SAFETY: the range was created by `Box::into_raw` in `m3_alloc` with this exact length
    // and is removed from the table before it is freed, so it is released once.
    drop(unsafe { Box::from_raw(slice) });
}

/// Run `body` over a host allocation that fully contains `ptr..ptr+len`.
fn with_buffer<T>(ptr: usize, len: usize, body: impl FnOnce(&mut [u8]) -> T) -> Option<T> {
    let allocations = ALLOCATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let start = ptr;
    let (base, size) = allocations.range(..=start).next_back()?;
    if start.checked_add(len)? > base + size || len == 0 {
        return None;
    }
    // SAFETY: `start..start+len` lies inside a live allocation owned by this module, and the
    // table lock is held for the whole borrow so the range cannot be released meanwhile.
    let bytes = unsafe { std::slice::from_raw_parts_mut(start as *mut u8, len) };
    Some(body(bytes))
}

/// Resolve every colour role of one mode into `out` (49 little-endian ARGB words in
/// `m3_role_name_byte` order). Returns the role count, or zero for an invalid request or buffer.
#[unsafe(export_name = "schemeFromSeed")]
pub extern "C" fn scheme_from_seed(
    seed: u32,
    variant: u32,
    contrast: f64,
    mode: u32,
    out: usize,
) -> u32 {
    let Some((request, dark)) = request(seed, variant, contrast, mode) else {
        return 0;
    };
    let scheme = request.scheme(dark);
    with_buffer(out, Role::ALL.len() * 4, |bytes| {
        for (chunk, role) in bytes.as_chunks_mut::<4>().0.iter_mut().zip(Role::ALL) {
            chunk.copy_from_slice(&scheme.argb(role).to_le_bytes());
        }
        Role::ALL.len() as u32
    })
    .unwrap_or(0)
}

/// The source colour best suited to a theme, from tightly packed RGBA8 pixels at `ptr`
/// (`CanvasRenderingContext2D.getImageData` layout). Zero rejects the buffer.
#[unsafe(export_name = "themeFromImage")]
pub extern "C" fn theme_from_image(ptr: usize, len: u32) -> u32 {
    if !len.is_multiple_of(4) {
        return 0;
    }
    with_buffer(ptr, len as usize, |bytes| source_color_from_rgba8(bytes)).unwrap_or(0)
}

/// Render the custom-property block of one mode (49 roles plus the extended success and
/// warning roles) from the canonical scheme sheet. The UTF-8 text is read from
/// `m3_output_ptr`; the return value is its byte length, zero for an invalid request.
#[unsafe(export_name = "applyDynamicColor")]
pub extern "C" fn apply_dynamic_color(seed: u32, variant: u32, contrast: f64, mode: u32) -> u32 {
    let Some((request, dark)) = request(seed, variant, contrast, mode) else {
        return 0;
    };
    let css = sheets::scheme_css(
        request.seed(),
        request.variant(),
        dark,
        request.contrast_level(),
    );
    let mut output = OUTPUT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    *output = css.into_bytes();
    output.len() as u32
}

/// Address of the text written by the last `applyDynamicColor` call.
#[unsafe(no_mangle)]
pub extern "C" fn m3_output_ptr() -> usize {
    OUTPUT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ptr() as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_buffer_matches_scalar_roles() {
        let out = m3_alloc(49 * 4);
        let seed = 0xFF67_50A4;
        assert_eq!(scheme_from_seed(seed, 2, 0.0, 1, out), 49);
        let words: Vec<u32> = with_buffer(out, 49 * 4, |bytes| {
            bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|chunk| u32::from_le_bytes(*chunk))
                .collect()
        })
        .expect("buffer");
        for (index, word) in words.iter().enumerate() {
            assert_eq!(*word, m3_seed_color(seed, 2, 0.0, 1, index as u32));
        }
        assert_eq!(
            scheme_from_seed(seed, 2, 0.0, 1, out + 4),
            0,
            "overflowing buffer is rejected"
        );
        m3_dealloc(out, 49 * 4);
        assert_eq!(
            scheme_from_seed(seed, 2, 0.0, 1, out),
            0,
            "released buffer is rejected"
        );
    }

    #[test]
    fn image_and_css_exports() {
        let pixels = m3_alloc(16);
        with_buffer(pixels, 16, |bytes| {
            for pixel in bytes.as_chunks_mut::<4>().0 {
                pixel.copy_from_slice(&[0xFF, 0, 0, 0xFF]);
            }
        });
        assert_eq!(theme_from_image(pixels, 16), 0xFFFF_0000);
        assert_eq!(theme_from_image(pixels, 15), 0);
        m3_dealloc(pixels, 16);
        let len = apply_dynamic_color(0xFF67_50A4, 2, 0.0, 0);
        let text = String::from_utf8(OUTPUT.lock().expect("output").clone()).expect("utf-8");
        assert_eq!(text.len(), len as usize);
        assert!(text.contains("--md-sys-color-primary: #"));
        assert!(text.contains("--md-ext-color-success"));
        assert_eq!(apply_dynamic_color(0x0067_50A4, 2, 0.0, 0), 0);
    }

    #[test]
    fn hct_round_trip() {
        let argb = 0xFF67_50A4;
        let back = m3_hct_to_argb(m3_hct_hue(argb), m3_hct_chroma(argb), m3_hct_tone(argb));
        assert_eq!(back, argb);
    }
}
