// SPDX-License-Identifier: Apache-2.0
//! GPU presentation: D3D11 on the default adapter, one flip-model DirectComposition swap chain per toplevel
//! (premultiplied alpha, so translucent Wayland pixels show the DWM Mica/Acrylic backdrop behind them), damage-only
//! uploads with UpdateSubresource and a GPU copy into the back buffer. DXGI flip model means DWM composes the
//! buffer directly (no redirection bitmap, no extra copy), and independent flip is possible for full-screen windows.

use windows::{
    Win32::{
        Foundation::{HMODULE, HWND},
        Graphics::{
            Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_12_0},
            Direct3D11::{
                D3D11_BIND_SHADER_RESOURCE, D3D11_BOX, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
                D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext,
                ID3D11Texture2D,
            },
            DirectComposition::{DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget, IDCompositionVisual},
            Dxgi::{
                Common::{DXGI_ALPHA_MODE_IGNORE, DXGI_ALPHA_MODE_PREMULTIPLIED, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_UNKNOWN, DXGI_SAMPLE_DESC},
                DXGI_PRESENT, DXGI_SCALING_STRETCH, DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_CHAIN_FLAG, DXGI_SWAP_EFFECT_FLIP_DISCARD,
                DXGI_USAGE_RENDER_TARGET_OUTPUT, IDXGIAdapter, IDXGIDevice, IDXGIFactory2, IDXGISwapChain1,
            },
        },
    },
    core::{Interface, Result},
};

use crate::wire::Rect;

pub struct Device {
    d3d: ID3D11Device,
    ctx: ID3D11DeviceContext,
    factory: IDXGIFactory2,
    dcomp: IDCompositionDevice,
    pub adapter: String,
}

pub struct Surface {
    swap: IDXGISwapChain1,
    tex: ID3D11Texture2D,
    _target: IDCompositionTarget,
    _visual: IDCompositionVisual,
    pub w: u32,
    pub h: u32,
    pub alpha: bool,
}

impl Device {
    pub fn new() -> Result<Self> {
        let mut d3d = None;
        let mut ctx = None;
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_12_0, D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut d3d),
                None,
                Some(&mut ctx),
            )?;
        }
        let d3d = d3d.unwrap();
        let ctx = ctx.unwrap();
        let dxgi: IDXGIDevice = d3d.cast()?;
        let adapter: IDXGIAdapter = unsafe { dxgi.GetAdapter()? };
        let desc = unsafe { adapter.GetDesc()? };
        let name = String::from_utf16_lossy(&desc.Description);
        let factory: IDXGIFactory2 = unsafe { adapter.GetParent()? };
        let dcomp: IDCompositionDevice = unsafe { DCompositionCreateDevice(&dxgi)? };
        Ok(Self { d3d, ctx, factory, dcomp, adapter: name.trim_end_matches('\0').to_string() })
    }

    fn texture(&self, w: u32, h: u32) -> Result<ID3D11Texture2D> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: w,
            Height: h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut tex = None;
        unsafe { self.d3d.CreateTexture2D(&desc, None, Some(&mut tex))? };
        Ok(tex.unwrap())
    }

    pub fn surface(&self, hwnd: HWND, w: u32, h: u32, translucent: bool) -> Result<Surface> {
        let (w, h) = (w.max(1), h.max(1));
        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: w,
            Height: h,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            Stereo: false.into(),
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_DISCARD,
            AlphaMode: if translucent { DXGI_ALPHA_MODE_PREMULTIPLIED } else { DXGI_ALPHA_MODE_IGNORE },
            Flags: 0,
        };
        unsafe {
            let swap = self.factory.CreateSwapChainForComposition(&self.d3d, &desc, None)?;
            let target = self.dcomp.CreateTargetForHwnd(hwnd, true)?;
            let visual = self.dcomp.CreateVisual()?;
            visual.SetContent(&swap)?;
            target.SetRoot(&visual)?;
            self.dcomp.Commit()?;
            Ok(Surface { swap, tex: self.texture(w, h)?, _target: target, _visual: visual, w, h, alpha: translucent })
        }
    }

    pub fn resize(&self, s: &mut Surface, w: u32, h: u32) -> Result<()> {
        let (w, h) = (w.max(1), h.max(1));
        unsafe { s.swap.ResizeBuffers(0, w, h, DXGI_FORMAT_UNKNOWN, DXGI_SWAP_CHAIN_FLAG(0))? };
        s.tex = self.texture(w, h)?;
        s.w = w;
        s.h = h;
        Ok(())
    }

    /// Uploads the damaged rectangles of `pixels` (BGRA, `width * 4` bytes per row) and presents.
    pub fn present(&self, s: &Surface, pixels: &[u8], width: u32, rects: &[Rect], vsync: bool) -> Result<()> {
        let pitch = width * 4;
        unsafe {
            for r in rects {
                if r.w == 0 || r.h == 0 || r.x + r.w > s.w || r.y + r.h > s.h {
                    continue;
                }
                let b = D3D11_BOX { left: r.x, top: r.y, front: 0, right: r.x + r.w, bottom: r.y + r.h, back: 1 };
                let at = (r.y * pitch + r.x * 4) as usize;
                self.ctx.UpdateSubresource(&s.tex, 0, Some(&b), pixels[at..].as_ptr() as *const _, pitch, 0);
            }
            let back: ID3D11Texture2D = s.swap.GetBuffer(0)?;
            self.ctx.CopyResource(&back, &s.tex);
            s.swap.Present(if vsync { 1 } else { 0 }, DXGI_PRESENT(0)).ok()
        }
    }
}
