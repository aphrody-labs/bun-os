// D3D12HelloWindow, headless subset (C# + CsWin32): WARP device, queue, allocator, list, fence, clear a render target,
// copy it to a readback buffer and verify the pixel. Prints "OK r,g,b,a" on success.
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Direct3D;
using Windows.Win32.Graphics.Direct3D12;
using Windows.Win32.Graphics.Dxgi;
using Windows.Win32.Graphics.Dxgi.Common;

unsafe
{
    static void Check(HRESULT hr, string what) { if (hr.Failed) { Console.WriteLine($"FAIL {what} 0x{hr.Value:x8}"); Environment.Exit(1); } }

    static Guid* Iid(Guid g) { var q = (Guid*)NativeMemory.Alloc((nuint)sizeof(Guid)); *q = g; return q; }
    void* p;
    Check(PInvoke.CreateDXGIFactory1(Iid(IDXGIFactory4.IID_Guid), &p), "CreateDXGIFactory1");
    var factory = (IDXGIFactory4*)p;
    factory->EnumWarpAdapter(Iid(IDXGIAdapter.IID_Guid), &p);
    var warp = (IDXGIAdapter*)p;
    Check(PInvoke.D3D12CreateDevice((Windows.Win32.System.Com.IUnknown*)warp, D3D_FEATURE_LEVEL.D3D_FEATURE_LEVEL_11_0, Iid(ID3D12Device.IID_Guid), &p), "D3D12CreateDevice");
    var device = (ID3D12Device*)p;

    var qd = new D3D12_COMMAND_QUEUE_DESC();
    device->CreateCommandQueue(&qd, Iid(ID3D12CommandQueue.IID_Guid), &p);
    var queue = (ID3D12CommandQueue*)p;
    device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE.D3D12_COMMAND_LIST_TYPE_DIRECT, Iid(ID3D12CommandAllocator.IID_Guid), &p);
    var alloc = (ID3D12CommandAllocator*)p;
    device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE.D3D12_COMMAND_LIST_TYPE_DIRECT, alloc, null, Iid(ID3D12GraphicsCommandList.IID_Guid), &p);
    var list = (ID3D12GraphicsCommandList*)p;

    D3D12_HEAP_PROPERTIES Heap(D3D12_HEAP_TYPE t) => new() { Type = t, CreationNodeMask = 1, VisibleNodeMask = 1 };
    var td = new D3D12_RESOURCE_DESC
    {
        Dimension = D3D12_RESOURCE_DIMENSION.D3D12_RESOURCE_DIMENSION_TEXTURE2D, Width = 64, Height = 64, DepthOrArraySize = 1, MipLevels = 1,
        Format = DXGI_FORMAT.DXGI_FORMAT_R8G8B8A8_UNORM, SampleDesc = new DXGI_SAMPLE_DESC { Count = 1 },
        Flags = D3D12_RESOURCE_FLAGS.D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET,
    };
    var hp = Heap(D3D12_HEAP_TYPE.D3D12_HEAP_TYPE_DEFAULT);
    device->CreateCommittedResource(&hp, D3D12_HEAP_FLAGS.D3D12_HEAP_FLAG_NONE, &td, D3D12_RESOURCE_STATES.D3D12_RESOURCE_STATE_RENDER_TARGET, null, Iid(ID3D12Resource.IID_Guid), &p);
    var rt = (ID3D12Resource*)p;

    var hd = new D3D12_DESCRIPTOR_HEAP_DESC { Type = D3D12_DESCRIPTOR_HEAP_TYPE.D3D12_DESCRIPTOR_HEAP_TYPE_RTV, NumDescriptors = 1 };
    device->CreateDescriptorHeap(&hd, Iid(ID3D12DescriptorHeap.IID_Guid), &p);
    var rtvHeap = (ID3D12DescriptorHeap*)p;
    D3D12_CPU_DESCRIPTOR_HANDLE rtv = rtvHeap->GetCPUDescriptorHandleForHeapStart();
    device->CreateRenderTargetView(rt, null, rtv);

    var bd = new D3D12_RESOURCE_DESC
    {
        Dimension = D3D12_RESOURCE_DIMENSION.D3D12_RESOURCE_DIMENSION_BUFFER, Width = 256 * 64, Height = 1, DepthOrArraySize = 1, MipLevels = 1,
        SampleDesc = new DXGI_SAMPLE_DESC { Count = 1 }, Layout = D3D12_TEXTURE_LAYOUT.D3D12_TEXTURE_LAYOUT_ROW_MAJOR,
    };
    var rbp = Heap(D3D12_HEAP_TYPE.D3D12_HEAP_TYPE_READBACK);
    device->CreateCommittedResource(&rbp, D3D12_HEAP_FLAGS.D3D12_HEAP_FLAG_NONE, &bd, D3D12_RESOURCE_STATES.D3D12_RESOURCE_STATE_COPY_DEST, null, Iid(ID3D12Resource.IID_Guid), &p);
    var readback = (ID3D12Resource*)p;

    float* color = stackalloc float[4] { 0f, 0.2f, 0.4f, 1f };
    list->ClearRenderTargetView(rtv, color, 0, null);
    var barrier = new D3D12_RESOURCE_BARRIER { Type = D3D12_RESOURCE_BARRIER_TYPE.D3D12_RESOURCE_BARRIER_TYPE_TRANSITION };
    barrier.Anonymous.Transition = new D3D12_RESOURCE_TRANSITION_BARRIER
    {
        pResource = rt, Subresource = 0xFFFFFFFF,
        StateBefore = D3D12_RESOURCE_STATES.D3D12_RESOURCE_STATE_RENDER_TARGET, StateAfter = D3D12_RESOURCE_STATES.D3D12_RESOURCE_STATE_COPY_SOURCE,
    };
    list->ResourceBarrier(1, &barrier);
    var dst = new D3D12_TEXTURE_COPY_LOCATION { pResource = readback, Type = D3D12_TEXTURE_COPY_TYPE.D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT };
    dst.Anonymous.PlacedFootprint = new D3D12_PLACED_SUBRESOURCE_FOOTPRINT
    {
        Offset = 0,
        Footprint = new D3D12_SUBRESOURCE_FOOTPRINT { Format = DXGI_FORMAT.DXGI_FORMAT_R8G8B8A8_UNORM, Width = 64, Height = 64, Depth = 1, RowPitch = 256 },
    };
    var src = new D3D12_TEXTURE_COPY_LOCATION { pResource = rt, Type = D3D12_TEXTURE_COPY_TYPE.D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX };
    list->CopyTextureRegion(&dst, 0, 0, 0, &src, null);
    list->Close();
    var lists = stackalloc ID3D12CommandList*[1] { (ID3D12CommandList*)list };
    queue->ExecuteCommandLists(1, lists);

    device->CreateFence(0, D3D12_FENCE_FLAGS.D3D12_FENCE_FLAG_NONE, Iid(ID3D12Fence.IID_Guid), &p);
    var fence = (ID3D12Fence*)p;
    queue->Signal(fence, 1);
    var deadline = DateTime.UtcNow.AddSeconds(30);
    while (fence->GetCompletedValue() < 1)
    {
        if (DateTime.UtcNow > deadline) { Console.WriteLine("FAIL fence timeout"); return 1; }
        Thread.Yield();
    }

    var range = new D3D12_RANGE { Begin = 0, End = 256 * 64 };
    void* data;
    readback->Map(0, &range, &data);
    byte* px = (byte*)data;
    byte r = px[0], g = px[1], b = px[2], a = px[3];
    readback->Unmap(0, null);
    if (r == 0 && g == 51 && b == 102 && a == 255) { Console.WriteLine("OK 0,51,102,255"); return 0; }
    Console.WriteLine($"FAIL pixel {r},{g},{b},{a}");
    return 1;
}
