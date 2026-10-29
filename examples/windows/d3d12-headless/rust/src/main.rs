// D3D12HelloWindow, headless subset (windows-rs): WARP device, queue, allocator, list, fence, clear a render target,
// copy it to a readback buffer and verify the pixel. Prints "OK r,g,b,a" on success.
use std::{ffi::c_void, mem::ManuallyDrop, ptr, time::{Duration, Instant}};
use windows::{core::*, Win32::Foundation::E_FAIL, Win32::Graphics::{Direct3D::*, Direct3D12::*, Dxgi::{Common::*, *}}};

fn run() -> Result<[u8; 4]> {
    unsafe {
        let factory: IDXGIFactory4 = CreateDXGIFactory1()?;
        let warp: IDXGIAdapter = factory.EnumWarpAdapter()?;
        let mut device: Option<ID3D12Device> = None;
        D3D12CreateDevice(&warp, D3D_FEATURE_LEVEL_11_0, &mut device)?;
        let device = device.unwrap();

        let queue: ID3D12CommandQueue = device.CreateCommandQueue(&D3D12_COMMAND_QUEUE_DESC::default())?;
        let alloc: ID3D12CommandAllocator = device.CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT)?;
        let list: ID3D12GraphicsCommandList = device.CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, &alloc, None)?;

        let heap = |t| D3D12_HEAP_PROPERTIES { Type: t, CreationNodeMask: 1, VisibleNodeMask: 1, ..Default::default() };
        let td = D3D12_RESOURCE_DESC {
            Dimension: D3D12_RESOURCE_DIMENSION_TEXTURE2D, Width: 64, Height: 64, DepthOrArraySize: 1, MipLevels: 1,
            Format: DXGI_FORMAT_R8G8B8A8_UNORM, SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Flags: D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET, ..Default::default()
        };
        let mut rt: Option<ID3D12Resource> = None;
        device.CreateCommittedResource(&heap(D3D12_HEAP_TYPE_DEFAULT), D3D12_HEAP_FLAG_NONE, &td, D3D12_RESOURCE_STATE_RENDER_TARGET, None, &mut rt)?;
        let rt = rt.unwrap();

        let rtv_heap: ID3D12DescriptorHeap = device.CreateDescriptorHeap(&D3D12_DESCRIPTOR_HEAP_DESC {
            Type: D3D12_DESCRIPTOR_HEAP_TYPE_RTV, NumDescriptors: 1, ..Default::default() })?;
        let rtv = rtv_heap.GetCPUDescriptorHandleForHeapStart();
        device.CreateRenderTargetView(&rt, None, rtv);

        let bd = D3D12_RESOURCE_DESC {
            Dimension: D3D12_RESOURCE_DIMENSION_BUFFER, Width: 256 * 64, Height: 1, DepthOrArraySize: 1, MipLevels: 1,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Layout: D3D12_TEXTURE_LAYOUT_ROW_MAJOR, ..Default::default()
        };
        let mut readback: Option<ID3D12Resource> = None;
        device.CreateCommittedResource(&heap(D3D12_HEAP_TYPE_READBACK), D3D12_HEAP_FLAG_NONE, &bd, D3D12_RESOURCE_STATE_COPY_DEST, None, &mut readback)?;
        let readback = readback.unwrap();

        list.ClearRenderTargetView(rtv, &[0.0, 0.2, 0.4, 1.0], None);
        let barrier = D3D12_RESOURCE_BARRIER {
            Type: D3D12_RESOURCE_BARRIER_TYPE_TRANSITION,
            Flags: D3D12_RESOURCE_BARRIER_FLAG_NONE,
            Anonymous: D3D12_RESOURCE_BARRIER_0 { Transition: ManuallyDrop::new(D3D12_RESOURCE_TRANSITION_BARRIER {
                pResource: ManuallyDrop::new(Some(rt.clone())), Subresource: D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
                StateBefore: D3D12_RESOURCE_STATE_RENDER_TARGET, StateAfter: D3D12_RESOURCE_STATE_COPY_SOURCE }) },
        };
        list.ResourceBarrier(&[barrier]);
        let dst = D3D12_TEXTURE_COPY_LOCATION {
            pResource: ManuallyDrop::new(Some(readback.clone())), Type: D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT,
            Anonymous: D3D12_TEXTURE_COPY_LOCATION_0 { PlacedFootprint: D3D12_PLACED_SUBRESOURCE_FOOTPRINT { Offset: 0,
                Footprint: D3D12_SUBRESOURCE_FOOTPRINT { Format: DXGI_FORMAT_R8G8B8A8_UNORM, Width: 64, Height: 64, Depth: 1, RowPitch: 256 } } },
        };
        let src = D3D12_TEXTURE_COPY_LOCATION {
            pResource: ManuallyDrop::new(Some(rt.clone())), Type: D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX,
            Anonymous: D3D12_TEXTURE_COPY_LOCATION_0 { SubresourceIndex: 0 },
        };
        list.CopyTextureRegion(&dst, 0, 0, 0, &src, None);
        list.Close()?;
        queue.ExecuteCommandLists(&[Some(list.cast()?)]);

        let fence: ID3D12Fence = device.CreateFence(0, D3D12_FENCE_FLAG_NONE)?;
        queue.Signal(&fence, 1)?;
        let deadline = Instant::now() + Duration::from_secs(30);
        while fence.GetCompletedValue() < 1 {
            if Instant::now() > deadline { return Err(Error::new(E_FAIL, "fence timeout")); }
            std::thread::yield_now();
        }

        let mut p: *mut c_void = ptr::null_mut();
        readback.Map(0, Some(&D3D12_RANGE { Begin: 0, End: 256 * 64 }), Some(&mut p))?;
        let px = std::slice::from_raw_parts(p as *const u8, 4);
        let out = [px[0], px[1], px[2], px[3]];
        readback.Unmap(0, None);
        Ok(out)
    }
}

fn main() {
    match run() {
        Ok([0, 51, 102, 255]) => println!("OK 0,51,102,255"),
        Ok(p) => { println!("FAIL pixel {},{},{},{}", p[0], p[1], p[2], p[3]); std::process::exit(1) }
        Err(e) => { println!("FAIL {e}"); std::process::exit(1) }
    }
}
