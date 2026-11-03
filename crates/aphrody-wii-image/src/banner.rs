use crate::Dvd;
use crate::dvd::FstNode;

pub const GCN_BANNER_WIDTH: u32 = 96;
pub const GCN_BANNER_HEIGHT: u32 = 32;

const GCN_PIXELS_OFFSET: usize = 0x20;
const WII_IMET_MAGIC_OFFSET: usize = 0x40;
const WII_U8_OFFSET: usize = 0x600;
const U8_MAGIC: [u8; 4] = [0x55, 0xAA, 0x38, 0x2D];
const TPL_MAGIC: u32 = 0x0020_AF30;

#[derive(Debug, Clone)]
pub struct Banner {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub fn extract(dvd: &dyn Dvd) -> Option<Banner> {
    let header = dvd.header();
    let fst_offset = header.offset_filesystem.get() as usize;
    let fst_size = header.filesystem_size.get() as usize;
    if fst_size == 0 || fst_offset == 0 {
        return None;
    }

    let mut fst_buf = vec![0u8; fst_size];
    dvd.read_disc_into(fst_offset, &mut fst_buf);
    let shift = if header.is_wii() { 2 } else { 0 };
    let root = FstNode::try_parse(&fst_buf, shift).ok()?;
    let (file_offset, file_size) = self::find_file(&root, "opening.bnr")?;

    let mut buf = vec![0u8; file_size as usize];
    dvd.read_disc_into(usize::try_from(file_offset).ok()?, &mut buf);

    if buf.len() >= 4 && (&buf[0..4] == b"BNR1" || &buf[0..4] == b"BNR2") {
        return self::decode_gcn(&buf);
    }

    if header.is_wii() {
        return self::decode_wii(&buf);
    }

    None
}

fn decode_gcn(buf: &[u8]) -> Option<Banner> {
    let w = GCN_BANNER_WIDTH as usize;
    let h = GCN_BANNER_HEIGHT as usize;
    let need = GCN_PIXELS_OFFSET + w * h * 2;
    if buf.len() < need {
        return None;
    }

    let rgba = self::decode_rgb5a3_tiled(&buf[GCN_PIXELS_OFFSET..], w, h)?;
    Some(Banner {
        width: GCN_BANNER_WIDTH,
        height: GCN_BANNER_HEIGHT,
        rgba,
    })
}

fn decode_wii(buf: &[u8]) -> Option<Banner> {
    if buf.len() < WII_U8_OFFSET + 32
        || &buf[WII_IMET_MAGIC_OFFSET..WII_IMET_MAGIC_OFFSET + 4] != b"IMET"
    {
        tracing::warn!("wii banner: outer layout / IMET magic missing");
        return None;
    }

    let banner_bin = self::read_u8_file(&buf[WII_U8_OFFSET..], "banner.bin")?;
    let inner = self::strip_imd5_and_lz77(&banner_bin)?;
    let tpl = self::find_largest_tpl(&inner)?;
    self::decode_first_tpl_texture(&tpl)
}

fn strip_imd5_and_lz77(banner_bin: &[u8]) -> Option<Vec<u8>> {
    if banner_bin.len() < 0x28 || &banner_bin[0..4] != b"IMD5" {
        tracing::warn!("wii banner: missing IMD5 header");
        return None;
    }

    let lz77 = &banner_bin[0x20..];
    if lz77.len() < 8 || &lz77[0..4] != b"LZ77" {
        tracing::warn!("wii banner: missing LZ77 header");
        return None;
    }

    if lz77[4] != 0x10 {
        tracing::warn!(ctrl = lz77[4], "wii banner: unsupported LZ77 variant");
        return None;
    }

    let decompressed_size =
        (lz77[5] as usize) | ((lz77[6] as usize) << 8) | ((lz77[7] as usize) << 16);
    let inner = self::lz77_decompress(&lz77[8..], decompressed_size);
    if inner.is_none() {
        tracing::warn!("wii banner: LZ77 decompress failed");
    }

    inner
}

fn find_file(node: &FstNode, name: &str) -> Option<(u64, u32)> {
    match node {
        FstNode::File {
            name: n,
            offset,
            size,
        } => n.eq_ignore_ascii_case(name).then_some((*offset, *size)),
        FstNode::Directory { children, .. } => {
            children.iter().find_map(|c| self::find_file(c, name))
        }
    }
}

fn read_u8_file(archive: &[u8], name: &str) -> Option<Vec<u8>> {
    let (nodes_base, node_count, strings) = self::parse_u8_header(archive)?;

    for i in 1..node_count {
        let base = nodes_base + i * 12;
        if archive[base] != 0 {
            continue;
        }

        let name_off = self::u24_be(archive, base + 1)? as usize;
        let file_offset = self::u32_be(archive, base + 4)? as usize;
        let file_size = self::u32_be(archive, base + 8)? as usize;
        let entry_name = self::read_cstr_at(strings, name_off)?;
        if !entry_name.eq_ignore_ascii_case(name) {
            continue;
        }

        if file_offset + file_size > archive.len() {
            return None;
        }

        return Some(archive[file_offset..file_offset + file_size].to_vec());
    }

    None
}

fn find_largest_tpl(archive: &[u8]) -> Option<Vec<u8>> {
    let (nodes_base, node_count, strings) = self::parse_u8_header(archive)?;
    let mut best: Option<(usize, usize)> = None;

    for i in 1..node_count {
        let base = nodes_base + i * 12;
        if archive[base] != 0 {
            continue;
        }

        let name_off = self::u24_be(archive, base + 1)? as usize;
        let file_offset = self::u32_be(archive, base + 4)? as usize;
        let file_size = self::u32_be(archive, base + 8)? as usize;
        let entry_name = self::read_cstr_at(strings, name_off)?;

        if !entry_name.to_ascii_lowercase().ends_with(".tpl") {
            continue;
        }

        if best.map_or(true, |(_, sz)| file_size > sz) {
            best = Some((file_offset, file_size));
        }
    }

    let (off, sz) = best?;
    if off + sz > archive.len() {
        return None;
    }

    Some(archive[off..off + sz].to_vec())
}

fn parse_u8_header(archive: &[u8]) -> Option<(usize, usize, &[u8])> {
    if archive.len() < 0x20 || archive[0..4] != U8_MAGIC {
        return None;
    }

    let root_node_offset = self::u32_be(archive, 0x04)? as usize;
    let header_size = self::u32_be(archive, 0x08)? as usize;
    let nodes_base = root_node_offset;
    let node_count = self::u32_be(archive, nodes_base + 8)? as usize;
    if node_count == 0 {
        return None;
    }

    let nodes_end = nodes_base + node_count * 12;
    let strings_end = root_node_offset + header_size;
    if strings_end > archive.len() || nodes_end > strings_end {
        return None;
    }

    let strings = &archive[nodes_end..strings_end];
    Some((nodes_base, node_count, strings))
}

fn decode_first_tpl_texture(tpl: &[u8]) -> Option<Banner> {
    if tpl.len() < 12 {
        return None;
    }

    let magic = self::u32_be(tpl, 0)?;
    if magic != TPL_MAGIC {
        tracing::warn!(magic, "wii banner: bad TPL magic");
        return None;
    }

    let ntex = self::u32_be(tpl, 4)?;
    if ntex == 0 {
        return None;
    }

    let table_off = self::u32_be(tpl, 8)? as usize;
    let img_hdr_off = self::u32_be(tpl, table_off)? as usize;
    let palette_hdr_off = self::u32_be(tpl, table_off + 4)? as usize;
    if img_hdr_off + 0x24 > tpl.len() {
        return None;
    }

    let height = u16::from_be_bytes(tpl[img_hdr_off..img_hdr_off + 2].try_into().ok()?) as usize;
    let width = u16::from_be_bytes(tpl[img_hdr_off + 2..img_hdr_off + 4].try_into().ok()?) as usize;
    let format = self::u32_be(tpl, img_hdr_off + 4)?;
    let data_off = self::u32_be(tpl, img_hdr_off + 8)? as usize;

    if width == 0 || height == 0 || width > 4096 || height > 4096 || data_off >= tpl.len() {
        return None;
    }

    let pixels = &tpl[data_off..];
    let rgba = match format {
        4 => self::decode_rgb565_tiled(pixels, width, height)?,
        5 => self::decode_rgb5a3_tiled(pixels, width, height)?,
        6 => self::decode_rgba8_tiled(pixels, width, height)?,
        9 => {
            let palette = self::decode_palette(tpl, palette_hdr_off)?;
            self::decode_c8_tiled(pixels, width, height, &palette)?
        }
        other => {
            tracing::warn!(
                format = other,
                width,
                height,
                "wii banner: unsupported TPL format"
            );
            return None;
        }
    };

    Some(Banner {
        width: width as u32,
        height: height as u32,
        rgba,
    })
}

fn decode_palette(tpl: &[u8], palette_hdr_off: usize) -> Option<Vec<(u8, u8, u8, u8)>> {
    if palette_hdr_off == 0 || palette_hdr_off + 0x0C > tpl.len() {
        tracing::warn!(
            palette_hdr_off,
            "wii banner: paletted texture without palette header"
        );
        return None;
    }

    let entry_count =
        u16::from_be_bytes(tpl[palette_hdr_off..palette_hdr_off + 2].try_into().ok()?) as usize;
    let format = self::u32_be(tpl, palette_hdr_off + 4)?;
    let data_off = self::u32_be(tpl, palette_hdr_off + 8)? as usize;
    if data_off + entry_count * 2 > tpl.len() {
        return None;
    }

    let decode: fn(u16) -> (u8, u8, u8, u8) = match format {
        0 => self::decode_ia8_pixel,
        1 => self::decode_rgb565_pixel,
        2 => self::decode_rgb5a3_pixel,
        other => {
            tracing::warn!(format = other, "wii banner: unsupported palette format");
            return None;
        }
    };

    let mut palette = vec![(0u8, 0u8, 0u8, 0u8); 256];
    for i in 0..entry_count.min(256) {
        let off = data_off + i * 2;
        let value = u16::from_be_bytes([tpl[off], tpl[off + 1]]);
        palette[i] = decode(value);
    }

    Some(palette)
}

fn decode_c8_tiled(
    indices: &[u8],
    width: usize,
    height: usize,
    palette: &[(u8, u8, u8, u8)],
) -> Option<Vec<u8>> {
    const TILE_W: usize = 8;
    const TILE_H: usize = 4;

    let (tiles_x, tiles_y) = self::padded_tiles(width, height, TILE_W, TILE_H);
    let need = tiles_x * tiles_y * TILE_W * TILE_H;
    if indices.len() < need {
        return None;
    }

    let mut rgba = vec![0u8; width * height * 4];
    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let tile_base = (ty * tiles_x + tx) * TILE_W * TILE_H;

            for py in 0..TILE_H {
                for px in 0..TILE_W {
                    let dx = tx * TILE_W + px;
                    let dy = ty * TILE_H + py;
                    if dx >= width || dy >= height {
                        continue;
                    }

                    let idx = indices[tile_base + py * TILE_W + px] as usize;
                    let (r, g, b, a) = palette[idx];
                    let dst = (dy * width + dx) * 4;

                    rgba[dst] = r;
                    rgba[dst + 1] = g;
                    rgba[dst + 2] = b;
                    rgba[dst + 3] = a;
                }
            }
        }
    }

    Some(rgba)
}

fn decode_ia8_pixel(value: u16) -> (u8, u8, u8, u8) {
    let intensity = (value >> 8) as u8;
    let alpha = (value & 0xFF) as u8;
    (intensity, intensity, intensity, alpha)
}

fn lz77_decompress(src: &[u8], expected_size: usize) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(expected_size);
    let mut i = 0;

    while out.len() < expected_size && i < src.len() {
        let flags = src[i];
        i += 1;

        for bit in 0..8 {
            if out.len() >= expected_size {
                break;
            }

            if flags & (0x80 >> bit) == 0 {
                if i >= src.len() {
                    return None;
                }

                out.push(src[i]);

                i += 1;
            } else {
                if i + 1 >= src.len() {
                    return None;
                }

                let b0 = src[i];
                let b1 = src[i + 1];
                i += 2;

                let length = ((b0 >> 4) as usize) + 3;
                let offset = ((((b0 & 0xF) as usize) << 8) | (b1 as usize)) + 1;
                if offset > out.len() {
                    return None;
                }

                for _ in 0..length {
                    let v = out[out.len() - offset];
                    out.push(v);
                }
            }
        }
    }

    if out.len() != expected_size {
        return None;
    }

    Some(out)
}

fn u32_be(buf: &[u8], off: usize) -> Option<u32> {
    let slice = buf.get(off..off + 4)?;
    Some(u32::from_be_bytes(slice.try_into().ok()?))
}

fn u24_be(buf: &[u8], off: usize) -> Option<u32> {
    let slice = buf.get(off..off + 3)?;
    Some(u32::from_be_bytes([0, slice[0], slice[1], slice[2]]))
}

fn read_cstr_at(buf: &[u8], off: usize) -> Option<&str> {
    let slice = buf.get(off..)?;
    let end = slice.iter().position(|&b| b == 0)?;
    std::str::from_utf8(&slice[..end]).ok()
}

fn padded_tiles(width: usize, height: usize, tile_w: usize, tile_h: usize) -> (usize, usize) {
    let pw = (width + tile_w - 1) & !(tile_w - 1);
    let ph = (height + tile_h - 1) & !(tile_h - 1);
    (pw / tile_w, ph / tile_h)
}

fn decode_rgb5a3_tiled(data: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    self::decode_2bpp_tiled(data, width, height, self::decode_rgb5a3_pixel)
}

fn decode_rgb565_tiled(data: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    self::decode_2bpp_tiled(data, width, height, self::decode_rgb565_pixel)
}

fn decode_2bpp_tiled<F>(data: &[u8], width: usize, height: usize, decode: F) -> Option<Vec<u8>>
where
    F: Fn(u16) -> (u8, u8, u8, u8),
{
    const TILE_W: usize = 4;
    const TILE_H: usize = 4;

    let (tiles_x, tiles_y) = self::padded_tiles(width, height, TILE_W, TILE_H);
    let need = tiles_x * tiles_y * TILE_W * TILE_H * 2;
    if data.len() < need {
        return None;
    }

    let mut rgba = vec![0u8; width * height * 4];
    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let tile_base = (ty * tiles_x + tx) * TILE_W * TILE_H * 2;

            for py in 0..TILE_H {
                for px in 0..TILE_W {
                    let dx = tx * TILE_W + px;
                    let dy = ty * TILE_H + py;
                    if dx >= width || dy >= height {
                        continue;
                    }

                    let src = tile_base + (py * TILE_W + px) * 2;
                    let pixel = u16::from_be_bytes([data[src], data[src + 1]]);
                    let (r, g, b, a) = decode(pixel);
                    let dst = (dy * width + dx) * 4;

                    rgba[dst] = r;
                    rgba[dst + 1] = g;
                    rgba[dst + 2] = b;
                    rgba[dst + 3] = a;
                }
            }
        }
    }

    Some(rgba)
}

fn decode_rgb5a3_pixel(value: u16) -> (u8, u8, u8, u8) {
    if value & 0x8000 != 0 {
        let r5 = ((value >> 10) & 0x1F) as u8;
        let g5 = ((value >> 5) & 0x1F) as u8;
        let b5 = (value & 0x1F) as u8;
        (
            (r5 << 3) | (r5 >> 2),
            (g5 << 3) | (g5 >> 2),
            (b5 << 3) | (b5 >> 2),
            0xFF,
        )
    } else {
        let a3 = ((value >> 12) & 0x7) as u8;
        let r4 = ((value >> 8) & 0xF) as u8;
        let g4 = ((value >> 4) & 0xF) as u8;
        let b4 = (value & 0xF) as u8;
        let a = (a3 << 5) | (a3 << 2) | (a3 >> 1);
        ((r4 << 4) | r4, (g4 << 4) | g4, (b4 << 4) | b4, a)
    }
}

fn decode_rgb565_pixel(value: u16) -> (u8, u8, u8, u8) {
    let r5 = ((value >> 11) & 0x1F) as u8;
    let g6 = ((value >> 5) & 0x3F) as u8;
    let b5 = (value & 0x1F) as u8;
    let r = (r5 << 3) | (r5 >> 2);
    let g = (g6 << 2) | (g6 >> 4);
    let b = (b5 << 3) | (b5 >> 2);
    (r, g, b, 0xFF)
}

fn decode_rgba8_tiled(data: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    const TILE_W: usize = 4;
    const TILE_H: usize = 4;

    let (tiles_x, tiles_y) = self::padded_tiles(width, height, TILE_W, TILE_H);
    let need = tiles_x * tiles_y * 64;
    if data.len() < need {
        return None;
    }

    let mut rgba = vec![0u8; width * height * 4];
    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let tile_base = (ty * tiles_x + tx) * 64;
            for py in 0..TILE_H {
                for px in 0..TILE_W {
                    let pix_idx = py * TILE_W + px;
                    let ar_off = tile_base + pix_idx * 2;
                    let gb_off = tile_base + 32 + pix_idx * 2;
                    let a = data[ar_off];
                    let r = data[ar_off + 1];
                    let g = data[gb_off];
                    let b = data[gb_off + 1];
                    let dx = tx * TILE_W + px;
                    let dy = ty * TILE_H + py;

                    if dx < width && dy < height {
                        let dst = (dy * width + dx) * 4;
                        rgba[dst] = r;
                        rgba[dst + 1] = g;
                        rgba[dst + 2] = b;
                        rgba[dst + 3] = a;
                    }
                }
            }
        }
    }

    Some(rgba)
}
