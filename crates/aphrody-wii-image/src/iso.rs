use crate::dvd::*;
use zerocopy::FromBytes;

pub struct Iso {
    pub header: Header,
    pub header_info: HeaderInfo,
    pub apploader: Apploader,
    pub filesystem: FstNode,
    data: Vec<u8>,
}

impl Iso {
    pub fn parse(data: Vec<u8>) -> Self {
        Self::try_parse(data).expect("invalid disc image")
    }

    /// Parse a disc image and reject truncated headers or malformed filesystem tables.
    pub fn try_parse(data: Vec<u8>) -> Result<Self, &'static str> {
        let header = Header::read_from_bytes(
            data.get(DVD_HEADER_OFFSET..DVD_HEADER_OFFSET + DVD_HEADER_SIZE)
                .ok_or("truncated disc header")?,
        )
        .map_err(|_| "invalid disc header")?;
        if !header.is_wii() && !header.is_gc() {
            return Err("unrecognized disc magic");
        }
        let header_info = HeaderInfo::read_from_bytes(
            data.get(DVD_HEADER_INFO_OFFSET..DVD_HEADER_INFO_OFFSET + DVD_HEADER_INFO_SIZE)
                .ok_or("truncated disc header info")?,
        )
        .map_err(|_| "invalid disc header info")?;
        let apploader = Apploader::read_from_bytes(
            data.get(DVD_APPLOADER_OFFSET..DVD_APPLOADER_OFFSET + DVD_APPLOADER_SIZE)
                .ok_or("truncated apploader")?,
        )
        .map_err(|_| "invalid apploader")?;

        let fst_start = header.offset_filesystem.get() as usize;
        let fst_end = fst_start
            .checked_add(header.filesystem_size.get() as usize)
            .ok_or("filesystem range overflow")?;
        let file_offset_shift = if header.gc_magic == crate::GC_MAGIC {
            0
        } else {
            2
        };
        let filesystem = FstNode::try_parse(
            data.get(fst_start..fst_end)
                .ok_or("filesystem outside image")?,
            file_offset_shift,
        )?;

        Ok(Iso {
            header,
            header_info,
            apploader,
            filesystem,
            data,
        })
    }

    pub fn data(&self) -> &[u8] {
        &self.data
    }
}

impl crate::Dvd for Iso {
    fn header(&self) -> &Header {
        &self.header
    }

    fn apploader(&self) -> &Apploader {
        &self.apploader
    }

    fn read_disc_into(&self, offset: usize, buf: &mut [u8]) {
        buf.copy_from_slice(&self.data[offset..offset + buf.len()]);
    }

    fn data_partition_offset(&self) -> u64 {
        if self.header.is_wii() { 0xF80_0000 } else { 0 }
    }

    fn read_raw_disc(&self, offset: usize, buf: &mut [u8]) {
        buf.copy_from_slice(&self.data[offset..offset + buf.len()]);
    }
}

#[cfg(test)]
mod tests {
    use super::Iso;

    #[test]
    fn truncated_image_returns_an_error() {
        assert!(Iso::try_parse(Vec::new()).is_err());
        assert!(Iso::try_parse(vec![0; super::DVD_HEADER_SIZE]).is_err());
    }
}
