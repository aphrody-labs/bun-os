//! Encoding: H.264, ProRes, DNxHR, APV and Motion-JPEG video, AAC and PCM audio into MP4 or
//! QuickTime; animated GIF, PNG and WAV as one-call helpers.
//!
//! [`Encoder`] is a push encoder: feed pictures (RGBA8 or any decoded [`VideoFrame`]) and planar
//! `f32` audio in any chunk size, then call [`Encoder::finish`]. The output is a seekable writer
//! (a file or a `Cursor<Vec<u8>>`). For Matroska output, encode to MP4 and use
//! [`remux`](crate::remux).
//!
//! All encoders are FilmCraft's own pure-Rust implementations and are deterministic: the same
//! input gives the same bytes on every machine.

use std::io::{Read, Seek, Write};

use filmcraft_export as ex;
use filmcraft_frame::VideoFrame;
use filmcraft_isobmff as iso;
use filmcraft_time::FrameRate;

use crate::control::{Control, Stage};
use crate::error::{Error, ErrorKind, Result};
use crate::limits::Limits;

/// A video codec the encoder can write.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum VideoCodec {
    /// H.264/AVC (Baseline, Main or High; B-frames; CRF, CBR, VBR and two-pass).
    H264,
    /// Apple ProRes (Proxy, LT, 422, 422 HQ, 4444, 4444 XQ) into QuickTime or MP4.
    ProRes,
    /// Avid DNxHR (LB, SQ, HQ, HQX).
    DnxHr,
    /// APV (Advanced Professional Video, RFC 9924).
    Apv,
    /// Motion-JPEG.
    Mjpeg,
}

impl VideoCodec {
    fn format(self) -> ex::Format {
        match self {
            VideoCodec::H264 => ex::Format::H264,
            VideoCodec::ProRes => ex::Format::ProRes,
            VideoCodec::DnxHr => ex::Format::DnxHr,
            VideoCodec::Apv => ex::Format::Apv,
            VideoCodec::Mjpeg => ex::Format::Mjpeg,
        }
    }
}

/// How H.264 spends bits.
#[derive(Clone, Copy, Debug, PartialEq)]
#[non_exhaustive]
pub enum RateControl {
    /// Constant quality: 0 (best) to 51 (smallest); 18 is near-lossless, 23 the default.
    Crf(f32),
    /// Constant bitrate in kbit/s.
    Cbr {
        /// Target bitrate.
        kbps: u32,
    },
    /// Variable bitrate in one pass.
    Vbr {
        /// Average bitrate.
        target_kbps: u32,
        /// Peak bitrate.
        max_kbps: u32,
    },
    /// Variable bitrate planned by a first pass ([`analyze_h264`]); set [`VideoOptions::first_pass`].
    TwoPass {
        /// Average bitrate.
        target_kbps: u32,
        /// Peak bitrate.
        max_kbps: u32,
    },
}

/// Statistics of an H.264 analysis pass, for [`RateControl::TwoPass`].
#[derive(Clone, Debug, PartialEq)]
pub struct FirstPass(filmcraft_h264enc::PassStats);

impl FirstPass {
    /// The statistics as text, to store between runs.
    pub fn to_text(&self) -> String {
        self.0.to_text()
    }
}

/// Video settings of an [`Encoder`].
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct VideoOptions {
    /// Codec.
    pub codec: VideoCodec,
    /// Picture width in pixels.
    pub width: u32,
    /// Picture height in pixels.
    pub height: u32,
    /// Frame rate; the container timescale is its numerator, so 29.97 stays exact.
    pub frame_rate: FrameRate,
    /// H.264 rate control (ignored by other codecs).
    pub rate_control: RateControl,
    /// H.264 profile: `baseline`, `main` or `high` (default `high`).
    pub h264_profile: Option<String>,
    /// ProRes flavour (`proxy`, `lt`, `standard`, `hq`, `4444`, `4444xq`), DNxHR profile (`lb`,
    /// `sq`, `hq`, `hqx`) or APV profile (`422-10`, `422-12`, `444-10`, `444-12`).
    pub profile: Option<String>,
    /// Frames between keyframes (default: two seconds).
    pub keyframe_interval: Option<u32>,
    /// Motion-JPEG quality 1-100.
    pub quality: u8,
    /// Result of [`analyze_h264`] for [`RateControl::TwoPass`].
    pub first_pass: Option<FirstPass>,
}

impl VideoOptions {
    /// `codec` at `width` x `height` and `frame_rate` with default quality (H.264 CRF 23).
    pub fn new(codec: VideoCodec, width: u32, height: u32, frame_rate: FrameRate) -> Self {
        Self {
            codec,
            width,
            height,
            frame_rate,
            rate_control: RateControl::Crf(23.0),
            h264_profile: None,
            profile: None,
            keyframe_interval: None,
            quality: 90,
            first_pass: None,
        }
    }
}

/// An audio codec the encoder can write.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum AudioCodec {
    /// AAC-LC.
    Aac,
    /// 16-bit little-endian PCM.
    Pcm16,
    /// 32-bit float PCM.
    PcmF32,
}

/// Audio settings of an [`Encoder`].
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct AudioOptions {
    /// Codec.
    pub codec: AudioCodec,
    /// Sample rate in Hz.
    pub sample_rate: u32,
    /// Channels: 1, 2 or 6 (5.1: L, R, C, LFE, Ls, Rs).
    pub channels: u32,
    /// AAC bitrate in kbit/s (32-512).
    pub bitrate_kbps: u32,
}

impl AudioOptions {
    /// AAC at 192 kbit/s.
    pub fn aac(sample_rate: u32, channels: u32) -> Self {
        Self {
            codec: AudioCodec::Aac,
            sample_rate,
            channels,
            bitrate_kbps: 192,
        }
    }
}

/// Live buffer budgets for fragmented MP4 encoding; no limit on movie duration or total bytes.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub struct FragmentOptions {
    /// Largest raw RGBA picture accepted, in bytes.
    pub max_frame_bytes: u64,
    /// Largest planar float audio chunk accepted, in bytes across all channels.
    pub max_audio_chunk_bytes: u64,
    /// Encoded audio bytes buffered before the first video picture initializes the tracks.
    pub max_pending_audio_bytes: u64,
    /// Encoded audio packets buffered before track initialization, including empty packets.
    pub max_pending_audio_packets: u32,
    /// Maximum encoded sample payload buffered in one fragment.
    pub max_fragment_bytes: u64,
    /// Maximum samples buffered in one fragment, including zero-length packets.
    pub max_fragment_samples: u32,
}

impl Default for FragmentOptions {
    fn default() -> Self {
        Self {
            max_frame_bytes: 256 << 20,
            max_audio_chunk_bytes: 4 << 20,
            max_pending_audio_bytes: 4 << 20,
            max_pending_audio_packets: 120,
            max_fragment_bytes: 16 << 20,
            max_fragment_samples: 120,
        }
    }
}

/// Settings of an [`Encoder`].
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct EncoderOptions {
    /// Video track, if any.
    pub video: Option<VideoOptions>,
    /// Audio track, if any.
    pub audio: Option<AudioOptions>,
    /// `true` writes QuickTime (`.mov`), `false` ISO MP4.
    pub quicktime: bool,
    /// Move `moov` to the front when finishing.
    pub faststart: bool,
    /// Fragmented MP4 with bounded live buffers; incompatible with PCM audio and `faststart`.
    /// `None` preserves the classic MP4/QuickTime writer and its complete feature set.
    pub fragments: Option<FragmentOptions>,
    /// Size caps (picture size).
    pub limits: Limits,
}

impl EncoderOptions {
    /// An MP4 with the given tracks.
    pub fn new(video: Option<VideoOptions>, audio: Option<AudioOptions>) -> Self {
        Self {
            video,
            audio,
            quicktime: false,
            faststart: false,
            fragments: None,
            limits: Limits::default(),
        }
    }
}

/// What an [`Encoder`] wrote.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct EncodeReport {
    /// Pictures encoded.
    pub video_frames: u64,
    /// Audio samples per channel accepted.
    pub audio_samples: u64,
}

/// Live payload buffered by the facade/muxer, excluding codec reference pictures and caller output.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EncodeBufferUsage {
    /// Encoded bytes awaiting the first video picture.
    pub pending_audio_bytes: u64,
    /// Encoded payload held by the current fragment.
    pub fragment_bytes: u64,
    /// Samples held by the current fragment.
    pub fragment_samples: u32,
}

fn settings_for(
    v: &VideoOptions,
    a: Option<&AudioOptions>,
    pass: ex::H264Pass,
) -> Result<ex::ExportSettings> {
    let mut s = ex::ExportSettings {
        format: v.codec.format(),
        ..Default::default()
    };
    s.quality = v.quality.clamp(1, 100);
    s.keyframe_distance = v.keyframe_interval.filter(|k| *k > 0);
    let p = v.profile.clone().unwrap_or_default();
    s.prores_profile = p.clone();
    s.dnx_profile = p.clone();
    s.apv_profile = p;
    s.h264_pass = pass;
    s.h264_profile = match v
        .h264_profile
        .as_deref()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("baseline") => ex::H264Profile::Baseline,
        Some("main") => ex::H264Profile::Main,
        Some("high") | None => ex::H264Profile::High,
        Some(other) => {
            return Err(Error::unsupported(format!(
                "H.264 profile {other:?}: use baseline, main or high"
            )));
        }
    };
    match v.rate_control {
        RateControl::Crf(c) => {
            if !c.is_finite() || !(0.0..=51.0).contains(&c) {
                return Err(Error::invalid("CRF must be between 0 and 51"));
            }
            s.bitrate_mode = ex::BitrateMode::Crf;
            s.crf = c;
        }
        RateControl::Cbr { kbps } => {
            s.bitrate_mode = ex::BitrateMode::Cbr;
            s.bitrate_kbps = kbps.max(100);
        }
        RateControl::Vbr {
            target_kbps,
            max_kbps,
        } => {
            s.bitrate_mode = ex::BitrateMode::Vbr1Pass;
            s.bitrate_kbps = target_kbps.max(100);
            s.max_bitrate_kbps = Some(max_kbps.max(target_kbps));
        }
        RateControl::TwoPass {
            target_kbps,
            max_kbps,
        } => {
            s.bitrate_mode = ex::BitrateMode::Vbr2Pass;
            s.bitrate_kbps = target_kbps.max(100);
            s.max_bitrate_kbps = Some(max_kbps.max(target_kbps));
        }
    }
    if let Some(a) = a {
        s.audio.bitrate_kbps = a.bitrate_kbps.clamp(32, 512);
    }
    Ok(s)
}

fn check_video(v: &VideoOptions, limits: &Limits) -> Result<()> {
    if v.width == 0 || v.height == 0 {
        return Err(Error::invalid("picture size must be positive"));
    }
    let px = u64::from(v.width).saturating_mul(u64::from(v.height));
    if px > limits.max_frame_pixels {
        return Err(Error::limit(
            "picture size in pixels",
            limits.max_frame_pixels,
            px,
        ));
    }
    if v.width > 16384 || v.height > 16384 {
        return Err(Error::unsupported(
            "pictures larger than 16384 pixels are not supported",
        ));
    }
    let r = v.frame_rate;
    if r.num <= 0
        || r.den <= 0
        || r.num > i64::from(u32::MAX)
        || r.den > i64::from(u32::MAX)
        || r.as_f64() > 1000.0
    {
        return Err(Error::invalid(
            "frame rate must be positive, at most 1000 fps, with a 32-bit numerator and denominator",
        ));
    }
    Ok(())
}

/// Run an H.264 analysis pass over `frames` and return the statistics for
/// [`RateControl::TwoPass`]. Pictures are the same ones you will pass to the real encode.
///
/// # Errors
///
/// As [`Encoder::push_rgba`]; `options.codec` must be H.264.
pub fn analyze_h264(
    options: &VideoOptions,
    frames: impl IntoIterator<Item = VideoFrame>,
    control: &Control,
) -> Result<FirstPass> {
    if options.codec != VideoCodec::H264 {
        return Err(Error::unsupported("two-pass analysis is an H.264 feature"));
    }
    check_video(options, &Limits::default())?;
    let mut o = options.clone();
    if let RateControl::TwoPass {
        target_kbps,
        max_kbps,
    } = o.rate_control
    {
        o.rate_control = RateControl::Vbr {
            target_kbps,
            max_kbps,
        };
    }
    let s = settings_for(&o, None, ex::H264Pass::First)?;
    let mut venc = ex::create_video_encoder(&s, o.width, o.height, o.frame_rate)?;
    let mut n = 0u64;
    for f in frames {
        control.check()?;
        let rgba = f.to_rgba8();
        check_len(&rgba, o.width, o.height)?;
        venc.encode(&ex::EncoderFrame {
            width: o.width,
            height: o.height,
            rgba: &rgba,
            hdr: None,
            index: n,
        })?;
        n += 1;
        control.report(Stage::Encoding, n, None);
    }
    venc.flush()?;
    venc.pass_stats()
        .map(FirstPass)
        .ok_or_else(|| Error::new(ErrorKind::Encode, "the encoder produced no pass statistics"))
}

fn check_len(rgba: &[u8], w: u32, h: u32) -> Result<()> {
    let want = u64::from(w) * u64::from(h) * 4;
    if rgba.len() as u64 != want {
        return Err(Error::invalid(format!(
            "a {w}x{h} RGBA picture is {want} bytes, got {}",
            rgba.len()
        )));
    }
    Ok(())
}

enum AudioEnc {
    Codec(Box<dyn ex::AudioEncoder>),
    Pcm { float: bool },
}

/// A push encoder producing an MP4 or QuickTime file.
///
/// `Encoder` is `Send`: move it to a worker thread, but use it from one thread at a time.
///
/// # Example
///
/// ```
/// # fn main() -> Result<(), filmcraft_lib::Error> {
/// use std::io::Cursor;
/// use filmcraft_lib::{Control, Encoder, EncoderOptions, FrameRate, VideoCodec, VideoOptions};
///
/// let video = VideoOptions::new(VideoCodec::H264, 64, 48, FrameRate::FPS_30);
/// let mut enc = Encoder::new(Cursor::new(Vec::new()), EncoderOptions::new(Some(video), None))?;
/// for i in 0..10u8 {
///     enc.push_rgba(&vec![i * 20; 64 * 48 * 4])?;
/// }
/// let (file, report) = enc.finish(&Control::default())?;
/// assert_eq!(report.video_frames, 10);
/// assert_eq!(&file.into_inner()[4..8], b"ftyp");
/// # Ok(()) }
/// ```
pub struct Encoder<W: Read + Write + Seek> {
    opts: EncoderOptions,
    out: Option<W>,
    writer: Option<EncodeWriter<W>>,
    venc: Option<Box<dyn ex::VideoEncoder>>,
    aenc: Option<AudioEnc>,
    vt: usize,
    at: Option<usize>,
    pending_audio: Vec<(Vec<u8>, u32)>,
    pending_audio_bytes: u64,
    control: Control,
    failed: bool,
    frames: u64,
    audio_samples: u64,
}

enum EncodeWriter<W: Read + Write + Seek> {
    Classic(iso::Mp4Writer<W>),
    Fragmented {
        writer: iso::FragmentedWriter<W>,
        bytes: u64,
        samples: u32,
        limits: FragmentOptions,
        fragments: u32,
        durations: Vec<u64>,
    },
}

impl<W: Read + Write + Seek> EncodeWriter<W> {
    fn add_track(&mut self, config: iso::TrackConfig) -> Result<usize> {
        Ok(match self {
            Self::Classic(writer) => writer.add_track(config)?,
            Self::Fragmented {
                writer, durations, ..
            } => {
                let track = writer.add_track(config)?;
                durations.push(0);
                track
            }
        })
    }

    fn write_sample(&mut self, track: usize, sample: iso::WriteSample<'_>) -> Result<()> {
        match self {
            Self::Classic(writer) => writer.write_sample(track, sample)?,
            Self::Fragmented {
                writer,
                bytes,
                samples,
                limits,
                fragments,
                durations,
            } => {
                let duration = durations
                    .get_mut(track)
                    .ok_or_else(|| Error::invalid("fragment track does not exist"))?;
                let next_duration = duration
                    .checked_add(u64::from(sample.duration))
                    .ok_or_else(|| Error::invalid("fragment track duration overflow"))?;
                let len = sample.data.len() as u64;
                if len > limits.max_fragment_bytes {
                    return Err(Error::limit(
                        "encoded sample in fragment",
                        limits.max_fragment_bytes,
                        len,
                    ));
                }
                if *samples >= limits.max_fragment_samples
                    || *bytes > limits.max_fragment_bytes - len
                {
                    Self::flush_fragment(writer, bytes, samples, fragments)?;
                }
                writer.write_sample(track, sample)?;
                *duration = next_duration;
                *bytes += len;
                *samples += 1;
                if *samples >= limits.max_fragment_samples || *bytes == limits.max_fragment_bytes {
                    Self::flush_fragment(writer, bytes, samples, fragments)?;
                }
            }
        }
        Ok(())
    }

    fn flush_fragment(
        writer: &mut iso::FragmentedWriter<W>,
        bytes: &mut u64,
        samples: &mut u32,
        fragments: &mut u32,
    ) -> Result<()> {
        if *samples == 0 {
            return Ok(());
        }
        let next = fragments
            .checked_add(1)
            .ok_or_else(|| Error::invalid("fragment sequence number overflow"))?;
        writer.flush_fragment()?;
        *fragments = next;
        *bytes = 0;
        *samples = 0;
        Ok(())
    }

    fn finish(self, faststart: bool) -> Result<W> {
        Ok(match self {
            Self::Classic(writer) if faststart => writer.finish_faststart()?,
            Self::Classic(writer) => writer.finish()?,
            Self::Fragmented {
                mut writer,
                mut bytes,
                mut samples,
                mut fragments,
                ..
            } => {
                Self::flush_fragment(&mut writer, &mut bytes, &mut samples, &mut fragments)?;
                writer.finish()?
            }
        })
    }
}

impl<W: Read + Write + Seek> Encoder<W> {
    /// Create an encoder writing to `out`.
    ///
    /// # Errors
    ///
    /// [`crate::ErrorKind::Invalid`] for impossible sizes or rates; [`crate::ErrorKind::LimitExceeded`] for a
    /// picture over `limits.max_frame_pixels`; [`crate::ErrorKind::Unsupported`] for combinations no
    /// encoder implements.
    pub fn new(out: W, opts: EncoderOptions) -> Result<Self> {
        Self::new_with_control(out, opts, Control::default())
    }

    /// Create an encoder whose pushes, packet writes and final flush share cancellation/deadline.
    /// A codec call already executing completes before cancellation is observed.
    pub fn new_with_control(out: W, opts: EncoderOptions, control: Control) -> Result<Self> {
        control.check()?;
        if opts.video.is_none() && opts.audio.is_none() {
            return Err(Error::invalid("an encoder needs a video or an audio track"));
        }
        if let Some(f) = &opts.fragments {
            if f.max_frame_bytes == 0
                || f.max_audio_chunk_bytes == 0
                || f.max_pending_audio_bytes == 0
                || f.max_fragment_bytes == 0
                || f.max_fragment_samples == 0
                || f.max_fragment_samples > 65_536
                || f.max_pending_audio_packets == 0
                || f.max_pending_audio_packets > 65_536
                || f.max_fragment_bytes > (i32::MAX as u64 / 2)
            {
                return Err(Error::invalid(
                    "fragment limits must be positive, payload at most 1 GiB and samples at most 65536",
                ));
            }
            if opts.faststart
                || opts
                    .audio
                    .as_ref()
                    .is_some_and(|a| a.codec != AudioCodec::Aac)
            {
                return Err(Error::unsupported(
                    "fragmented encoding does not support PCM or faststart; use the classic writer",
                ));
            }
            if let Some(v) = &opts.video {
                let bytes = u64::from(v.width)
                    .checked_mul(u64::from(v.height))
                    .and_then(|n| n.checked_mul(4))
                    .ok_or_else(|| Error::invalid("RGBA frame byte count overflow"))?;
                if bytes > f.max_frame_bytes {
                    return Err(Error::limit("RGBA frame bytes", f.max_frame_bytes, bytes));
                }
            }
        }
        let venc = match &opts.video {
            Some(v) => {
                check_video(v, &opts.limits)?;
                let pass = match (&v.rate_control, &v.first_pass) {
                    (RateControl::TwoPass { .. }, Some(fp)) => ex::H264Pass::Second(fp.0.clone()),
                    (RateControl::TwoPass { .. }, None) => {
                        return Err(Error::invalid(
                            "two-pass rate control needs VideoOptions::first_pass (see analyze_h264)",
                        ));
                    }
                    _ => ex::H264Pass::Single,
                };
                let mut s = settings_for(v, opts.audio.as_ref(), pass)?;
                if v.codec == VideoCodec::H264 {
                    let kbps = s.bitrate_kbps;
                    if s.max_bitrate_kbps.is_none() && kbps > 0 {
                        s.max_bitrate_kbps = Some(kbps.saturating_add(kbps / 2));
                    }
                }
                Some(ex::create_video_encoder(
                    &s,
                    v.width,
                    v.height,
                    v.frame_rate,
                )?)
            }
            None => None,
        };
        let aenc = match &opts.audio {
            Some(a) => {
                if a.sample_rate == 0 || a.sample_rate > 384_000 || !matches!(a.channels, 1 | 2 | 6)
                {
                    return Err(Error::invalid(
                        "audio needs a sample rate up to 384000 Hz and 1, 2 or 6 channels",
                    ));
                }
                Some(match a.codec {
                    AudioCodec::Aac => {
                        let s = settings_for_audio(a);
                        AudioEnc::Codec(ex::create_audio_encoder(&s, a.sample_rate, a.channels)?)
                    }
                    AudioCodec::Pcm16 => AudioEnc::Pcm { float: false },
                    AudioCodec::PcmF32 => AudioEnc::Pcm { float: true },
                })
            }
            None => None,
        };
        Ok(Self {
            opts,
            out: Some(out),
            writer: None,
            venc,
            aenc,
            vt: 0,
            at: None,
            pending_audio: Vec::new(),
            pending_audio_bytes: 0,
            control,
            failed: false,
            frames: 0,
            audio_samples: 0,
        })
    }

    fn check(&self) -> Result<()> {
        self.control.check()?;
        if self.failed {
            return Err(Error::new(
                ErrorKind::Encode,
                "the encoder failed; discard its partial output",
            ));
        }
        Ok(())
    }

    /// Current bounded fragment/pre-init payload; classic MP4 sample tables are not included.
    pub fn buffer_usage(&self) -> EncodeBufferUsage {
        let (fragment_bytes, fragment_samples) = match &self.writer {
            Some(EncodeWriter::Fragmented { bytes, samples, .. }) => (*bytes, *samples),
            _ => (0, 0),
        };
        EncodeBufferUsage {
            pending_audio_bytes: self.pending_audio_bytes,
            fragment_bytes,
            fragment_samples,
        }
    }

    fn open_writer(&mut self) -> Result<()> {
        self.control.check()?;
        if self.writer.is_some() {
            return Ok(());
        }
        let out = self
            .out
            .take()
            .ok_or_else(|| Error::new(ErrorKind::Encode, "the encoder already finished"))?;
        let brand = if self.opts.quicktime {
            iso::Brand::Mov
        } else {
            iso::Brand::Mp4
        };
        let mut w = if let Some(limits) = self.opts.fragments {
            EncodeWriter::Fragmented {
                writer: iso::FragmentedWriter::new(out, iso::WriterOptions::new(brand)),
                bytes: 0,
                samples: 0,
                limits,
                fragments: 0,
                durations: Vec::new(),
            }
        } else {
            EncodeWriter::Classic(iso::Mp4Writer::new(out, iso::WriterOptions::new(brand))?)
        };
        if let Some(v) = &self.venc {
            let mut c = iso::TrackConfig::new(v.sample_entry(), v.timescale());
            c.media_start = v.media_start();
            self.vt = w.add_track(c)?;
        }
        if let (Some(a), Some(o)) = (&self.aenc, &self.opts.audio) {
            let cfg = match a {
                AudioEnc::Codec(e) => {
                    let mut c = iso::TrackConfig::new(e.sample_entry(), o.sample_rate);
                    c.media_start = Some(i64::from(e.priming()));
                    c
                }
                AudioEnc::Pcm { float } => {
                    let bits = if *float { 32 } else { 16 };
                    let pcm = iso::PcmConfig {
                        bits,
                        float: *float,
                        big_endian: false,
                        signed: true,
                        channels: o.channels,
                        sample_rate: f64::from(o.sample_rate),
                    };
                    iso::TrackConfig::new(iso::SampleEntry::pcm(pcm), o.sample_rate)
                }
            };
            self.at = Some(w.add_track(cfg)?);
        }
        self.writer = Some(w);
        for (au, dur) in std::mem::take(&mut self.pending_audio) {
            self.pending_audio_bytes -= au.len() as u64;
            self.write_audio(&au, dur)?;
        }
        Ok(())
    }

    fn write_audio(&mut self, data: &[u8], duration: u32) -> Result<()> {
        self.control.check()?;
        if self.opts.fragments.is_some() && data.len() as u64 > self.opts.limits.max_packet_bytes {
            return Err(Error::limit(
                "encoded audio packet",
                self.opts.limits.max_packet_bytes,
                data.len() as u64,
            ));
        }
        if let (Some(w), Some(t)) = (self.writer.as_mut(), self.at) {
            w.write_sample(
                t,
                iso::WriteSample {
                    data,
                    duration,
                    composition_offset: 0,
                    is_sync: true,
                },
            )?;
        }
        Ok(())
    }

    fn write_video(&mut self, packets: Vec<ex::EncodedPacket>) -> Result<()> {
        if let Some(w) = self.writer.as_mut() {
            for p in packets {
                self.control.check()?;
                if self.opts.fragments.is_some()
                    && p.data.len() as u64 > self.opts.limits.max_packet_bytes
                {
                    return Err(Error::limit(
                        "encoded video packet",
                        self.opts.limits.max_packet_bytes,
                        p.data.len() as u64,
                    ));
                }
                w.write_sample(
                    self.vt,
                    iso::WriteSample {
                        data: &p.data,
                        duration: p.duration,
                        composition_offset: p.composition_offset,
                        is_sync: p.key,
                    },
                )?;
            }
        }
        Ok(())
    }

    /// Encode one straight-alpha RGBA8 picture of the configured size.
    ///
    /// # Errors
    ///
    /// [`crate::ErrorKind::Invalid`] when the buffer is not exactly `width * height * 4` bytes or the
    /// encoder has no video track.
    pub fn push_rgba(&mut self, rgba: &[u8]) -> Result<()> {
        self.check()?;
        let result = self.push_rgba_inner(rgba);
        if result.is_err() && self.opts.fragments.is_some() {
            self.failed = true;
        }
        result
    }

    fn push_rgba_inner(&mut self, rgba: &[u8]) -> Result<()> {
        let v = self
            .opts
            .video
            .as_ref()
            .ok_or_else(|| Error::invalid("this encoder has no video track"))?;
        let (w, h) = (v.width, v.height);
        check_len(rgba, w, h)?;
        let venc = self
            .venc
            .as_mut()
            .ok_or_else(|| Error::invalid("this encoder has no video track"))?;
        let packets = venc.encode(&ex::EncoderFrame {
            width: w,
            height: h,
            rgba,
            hdr: None,
            index: self.frames,
        })?;
        self.frames = self
            .frames
            .checked_add(1)
            .ok_or_else(|| Error::invalid("video frame count overflow"))?;
        self.open_writer()?;
        self.write_video(packets)
    }

    /// Encode a decoded picture (any pixel layout; converted to RGBA8). Its size must match.
    pub fn push_frame(&mut self, frame: &VideoFrame) -> Result<()> {
        self.check()?;
        let v = self
            .opts
            .video
            .as_ref()
            .ok_or_else(|| Error::invalid("this encoder has no video track"))?;
        if frame.width != v.width || frame.height != v.height {
            return Err(Error::invalid(
                "decoded picture size differs from the configured video track",
            ));
        }
        self.push_rgba(&frame.to_rgba8())
    }

    /// Encode planar `f32` audio (one `Vec` per channel, equal lengths, -1.0..1.0), in chunks of any size.
    ///
    /// # Errors
    ///
    /// [`crate::ErrorKind::Invalid`] for a wrong channel count or unequal channel lengths.
    pub fn push_audio(&mut self, planar: &[Vec<f32>]) -> Result<()> {
        self.check()?;
        let result = self.push_audio_inner(planar);
        if result.is_err() && self.opts.fragments.is_some() {
            self.failed = true;
        }
        result
    }

    fn push_audio_inner(&mut self, planar: &[Vec<f32>]) -> Result<()> {
        let o = self
            .opts
            .audio
            .as_ref()
            .ok_or_else(|| Error::invalid("this encoder has no audio track"))?;
        if planar.len() != o.channels as usize {
            return Err(Error::invalid(format!(
                "expected {} channels, got {}",
                o.channels,
                planar.len()
            )));
        }
        let n = planar.first().map_or(0, Vec::len);
        if planar.iter().any(|c| c.len() != n) {
            return Err(Error::invalid("audio channels differ in length"));
        }
        let chunk_bytes = (n as u64)
            .checked_mul(planar.len() as u64)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| Error::invalid("audio chunk byte count overflow"))?;
        if let Some(f) = &self.opts.fragments {
            if chunk_bytes > f.max_audio_chunk_bytes {
                return Err(Error::limit(
                    "audio chunk bytes",
                    f.max_audio_chunk_bytes,
                    chunk_bytes,
                ));
            }
        }
        self.audio_samples = self
            .audio_samples
            .checked_add(n as u64)
            .ok_or_else(|| Error::invalid("audio sample count overflow"))?;
        let mut units: Vec<(Vec<u8>, u32)> = Vec::new();
        match self.aenc.as_mut() {
            Some(AudioEnc::Codec(e)) => {
                let size = e.frame_size();
                for au in e.encode(planar)? {
                    units.push((au, size));
                }
            }
            Some(AudioEnc::Pcm { float }) => {
                let mut bytes = Vec::with_capacity(n * planar.len() * if *float { 4 } else { 2 });
                for i in 0..n {
                    for c in planar {
                        let s = c.get(i).copied().unwrap_or(0.0);
                        let s = if s.is_nan() { 0.0 } else { s };
                        if *float {
                            bytes.extend_from_slice(&s.to_le_bytes());
                        } else {
                            bytes.extend_from_slice(
                                &((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes(),
                            );
                        }
                    }
                }
                if !bytes.is_empty() {
                    units.push((bytes, u32::try_from(n).unwrap_or(u32::MAX)));
                }
            }
            None => {}
        }
        for (au, dur) in units {
            if self.writer.is_some() || self.venc.is_none() {
                if self.writer.is_none() {
                    self.open_writer()?;
                }
                self.write_audio(&au, dur)?;
            } else {
                let total = self
                    .pending_audio_bytes
                    .checked_add(au.len() as u64)
                    .ok_or_else(|| Error::invalid("pending audio byte count overflow"))?;
                if let Some(f) = &self.opts.fragments {
                    if total > f.max_pending_audio_bytes {
                        return Err(Error::limit(
                            "audio awaiting the first video picture",
                            f.max_pending_audio_bytes,
                            total,
                        ));
                    }
                    // Also bound zero-length packets and Vec metadata before initialization.
                    let max_packets = self
                        .opts
                        .limits
                        .max_packets
                        .min(u64::from(f.max_pending_audio_packets));
                    if self.pending_audio.len() as u64 >= max_packets {
                        return Err(Error::limit(
                            "pending audio packets",
                            max_packets,
                            self.pending_audio.len() as u64 + 1,
                        ));
                    }
                }
                self.pending_audio_bytes = total;
                self.pending_audio.push((au, dur));
            }
        }
        self.control.check()
    }

    /// Flush the encoders, finish the container and return the writer.
    ///
    /// # Errors
    ///
    /// [`crate::ErrorKind::Invalid`] when a configured video track received no pictures.
    pub fn finish(mut self, control: &Control) -> Result<(W, EncodeReport)> {
        control.check()?;
        self.check()?;
        control.report(Stage::Finishing, self.frames, None);
        if self.venc.is_some() && self.frames == 0 {
            return Err(Error::invalid("the video track received no pictures"));
        }
        if let Some(v) = self.venc.as_mut() {
            let tail = v.flush()?;
            self.open_writer()?;
            self.write_video(tail)?;
        }
        let mut tail_audio: Vec<(Vec<u8>, u32)> = Vec::new();
        if let Some(AudioEnc::Codec(e)) = self.aenc.as_mut() {
            let size = e.frame_size();
            for au in e.flush()? {
                tail_audio.push((au, size));
            }
        }
        self.open_writer()?;
        for (au, d) in tail_audio {
            control.check()?;
            self.write_audio(&au, d)?;
        }
        let w = self
            .writer
            .take()
            .ok_or_else(|| Error::new(ErrorKind::Encode, "nothing was written"))?;
        control.check()?;
        self.control.check()?;
        let out = w.finish(self.opts.faststart)?;
        control.check()?;
        self.control.check()?;
        Ok((
            out,
            EncodeReport {
                video_frames: self.frames,
                audio_samples: self.audio_samples,
            },
        ))
    }
}

fn settings_for_audio(a: &AudioOptions) -> ex::ExportSettings {
    let mut s = ex::ExportSettings::default();
    s.audio.bitrate_kbps = a.bitrate_kbps.clamp(32, 512);
    s
}

/// Encode RGBA8 pictures as an endlessly looping animated GIF.
///
/// Frame delays follow `frame_rate` with centisecond rounding that never drifts.
///
/// # Errors
///
/// [`crate::ErrorKind::Invalid`] for an empty sequence or a wrongly sized picture.
///
/// ```
/// # fn main() -> Result<(), filmcraft_lib::Error> {
/// use filmcraft_lib::{Control, FrameRate, encode_gif};
/// let frames: Vec<Vec<u8>> = (0..4u8).map(|i| vec![i * 60; 8 * 8 * 4]).collect();
/// let gif = encode_gif(8, 8, FrameRate::FPS_25, frames.iter().map(|f| f.as_slice()), &Control::default())?;
/// assert_eq!(&gif[..3], b"GIF");
/// # Ok(()) }
/// ```
pub fn encode_gif<'a>(
    width: u32,
    height: u32,
    rate: FrameRate,
    frames: impl IntoIterator<Item = &'a [u8]>,
    control: &Control,
) -> Result<Vec<u8>> {
    if width == 0
        || height == 0
        || width > 65535
        || height > 65535
        || rate.num <= 0
        || rate.den <= 0
    {
        return Err(Error::invalid(
            "GIF needs a size up to 65535 and a positive frame rate",
        ));
    }
    let mut buf = Vec::new();
    {
        let mut enc = image::codecs::gif::GifEncoder::new_with_speed(&mut buf, 10);
        enc.set_repeat(image::codecs::gif::Repeat::Infinite)
            .map_err(|e| Error::new(ErrorKind::Encode, e.to_string()))?;
        let cs = |i: i128| {
            (i * 100 * i128::from(rate.den) + i128::from(rate.num) / 2) / i128::from(rate.num)
        };
        let mut n = 0i128;
        for f in frames {
            control.check()?;
            check_len(f, width, height)?;
            let delay_cs = (cs(n + 1) - cs(n)).clamp(1, 65535) as u32;
            let img = image::RgbaImage::from_raw(width, height, f.to_vec())
                .ok_or_else(|| Error::invalid("picture buffer has the wrong size"))?;
            let frame = image::Frame::from_parts(
                img,
                0,
                0,
                image::Delay::from_numer_denom_ms(delay_cs * 10, 1),
            );
            enc.encode_frame(frame)
                .map_err(|e| Error::new(ErrorKind::Encode, e.to_string()))?;
            n += 1;
            control.report(Stage::Encoding, n as u64, None);
        }
        if n == 0 {
            return Err(Error::invalid("a GIF needs at least one picture"));
        }
    }
    Ok(buf)
}

/// Encode one RGBA8 picture as PNG.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    check_len(rgba, width, height)?;
    let mut out = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new(&mut out),
        rgba,
        width,
        height,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| Error::new(ErrorKind::Encode, e.to_string()))?;
    Ok(out)
}

/// Encode interleaved `f32` samples as a RIFF/WAVE file (16-bit integer, or 32-bit float with
/// `float`).
///
/// ```
/// # fn main() -> Result<(), filmcraft_lib::Error> {
/// let wav = filmcraft_lib::encode_wav(&[0.0, 0.5, -0.5, 0.25], 2, 48_000, false)?;
/// assert_eq!(&wav[..4], b"RIFF");
/// # Ok(()) }
/// ```
pub fn encode_wav(
    interleaved: &[f32],
    channels: u16,
    sample_rate: u32,
    float: bool,
) -> Result<Vec<u8>> {
    if channels == 0 || sample_rate == 0 {
        return Err(Error::invalid("channels and sample rate must be positive"));
    }
    let fmt = if float {
        ex::SampleFormat::Float32
    } else {
        ex::SampleFormat::Int16
    };
    ex::write_wav(interleaved, channels, sample_rate, fmt)
        .map_err(|e| Error::new(ErrorKind::Encode, e))
}

#[cfg(test)]
mod streaming_tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn fragment_sequence_overflow_is_a_result_before_mux_arithmetic() {
        let mut writer = iso::FragmentedWriter::new(
            Cursor::new(Vec::new()),
            iso::WriterOptions::new(iso::Brand::Mp4),
        );
        let (mut bytes, mut samples, mut fragments) = (1, 1, u32::MAX);
        let error =
            EncodeWriter::flush_fragment(&mut writer, &mut bytes, &mut samples, &mut fragments)
                .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Invalid);
        assert_eq!((bytes, samples, fragments), (1, 1, u32::MAX));
    }
}
