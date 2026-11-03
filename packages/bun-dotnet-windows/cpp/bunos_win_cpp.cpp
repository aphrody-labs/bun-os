// SPDX-License-Identifier: MIT
// bunos_win_cpp.dll: the C++ side of the Bun OS Windows stack. DirectX 12 through DirectX-Headers (d3dx12
// CD3DX12FeatureSupport), DXGI 1.6, COM through WIL (com_ptr, error handling), WinRT through C++/WinRT, all behind a
// C ABI (include/bunos_windows.h) that bun:ffi, Rust (libloading/windows-rs) and C# bind alike.

// DirectX-Headers first: they supersede the d3d12 headers of the Windows SDK.
#include <directx/d3d12.h>
#include <directx/d3dx12.h>
#include <dxguids/dxguids.h>

#include <windows.h>
#include <dxgi1_6.h>
#include <shlobj_core.h>

#include <wil/com.h>
#include <wil/result.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.ExchangeActiveSyncProvisioning.h>
#include <winrt/Windows.System.Profile.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>

#include "bunos_windows.h"

namespace
{
    // Minimal JSON writer: the C ABI returns one UTF-8 JSON document per call.
    class Json
    {
    public:
        Json& key(std::string_view name)
        {
            sep();
            quote(name);
            out_ += ':';
            return *this;
        }
        Json& begin(char c) { sep(); out_ += c; return *this; }
        Json& end(char c) { out_ += c; need_ = true; return *this; }
        Json& str(std::string_view value) { sep(); quote(value); need_ = true; return *this; }
        Json& str(std::wstring_view value) { return str(utf8(value)); }
        Json& num(uint64_t value) { sep(); out_ += std::to_string(value); need_ = true; return *this; }
        Json& boolean(bool value) { sep(); out_ += value ? "true" : "false"; need_ = true; return *this; }
        Json& hex(uint32_t value, int width)
        {
            char buffer[16];
            std::snprintf(buffer, sizeof buffer, "0x%0*X", width, value);
            return str(std::string_view(buffer));
        }
        std::string take() { return std::move(out_); }

        static std::string utf8(std::wstring_view value)
        {
            if (value.empty()) return {};
            int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
            std::string result(static_cast<size_t>(size), '\0');
            WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
            return result;
        }

    private:
        void sep()
        {
            if (need_) out_ += ',';
            need_ = false;
        }
        void quote(std::string_view value)
        {
            out_ += '"';
            for (unsigned char ch : value)
            {
                switch (ch)
                {
                case '"': out_ += "\\\""; break;
                case '\\': out_ += "\\\\"; break;
                case '\n': out_ += "\\n"; break;
                case '\r': out_ += "\\r"; break;
                case '\t': out_ += "\\t"; break;
                default:
                    if (ch < 0x20)
                    {
                        char buffer[8];
                        std::snprintf(buffer, sizeof buffer, "\\u%04x", ch);
                        out_ += buffer;
                    }
                    else
                    {
                        out_ += static_cast<char>(ch);
                    }
                }
            }
            out_ += '"';
        }
        std::string out_;
        bool need_ = false;
    };

    char* dup(const std::string& text)
    {
        auto* buffer = static_cast<char*>(std::malloc(text.size() + 1));
        if (buffer == nullptr) return nullptr;
        std::memcpy(buffer, text.c_str(), text.size() + 1);
        return buffer;
    }

    std::string level(D3D_FEATURE_LEVEL value)
    {
        auto v = static_cast<unsigned>(value);
        return std::to_string(v >> 12) + "_" + std::to_string((v >> 8) & 0xF);
    }

    void device(Json& j, IDXGIAdapter4* adapter)
    {
        wil::com_ptr<ID3D12Device> d3d;
        HRESULT hr = D3D12CreateDevice(adapter, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&d3d));
        j.key("d3d12").begin('{');
        j.key("supported").boolean(SUCCEEDED(hr));
        if (FAILED(hr))
        {
            j.key("hresult").hex(static_cast<uint32_t>(hr), 8).end('}');
            return;
        }
        CD3DX12FeatureSupport features;
        if (SUCCEEDED(features.Init(d3d.get())))
        {
            auto sm = static_cast<unsigned>(features.HighestShaderModel());
            j.key("maxFeatureLevel").str(level(features.MaxSupportedFeatureLevel()));
            j.key("shaderModel").str(std::to_string(sm >> 4) + "." + std::to_string(sm & 0xF));
            j.key("resourceBindingTier").num(features.ResourceBindingTier());
            j.key("tiledResourcesTier").num(features.TiledResourcesTier());
            j.key("raytracingTier").num(features.RaytracingTier());
            j.key("meshShaderTier").num(features.MeshShaderTier());
            j.key("samplerFeedbackTier").num(features.SamplerFeedbackTier());
            j.key("variableShadingRateTier").num(features.VariableShadingRateTier());
            j.key("enhancedBarriers").boolean(features.EnhancedBarriersSupported());
            j.key("waveOps").boolean(features.WaveOps());
            j.key("waveLaneCountMin").num(features.WaveLaneCountMin());
            j.key("waveLaneCountMax").num(features.WaveLaneCountMax());
            j.key("uma").boolean(features.UMA());
        }
        j.end('}');
    }

    std::string adapters(bool withDevice)
    {
        wil::com_ptr<IDXGIFactory6> factory;
        THROW_IF_FAILED(CreateDXGIFactory2(0, IID_PPV_ARGS(&factory)));
        Json j;
        j.begin('[');
        for (UINT index = 0;; ++index)
        {
            wil::com_ptr<IDXGIAdapter4> adapter;
            HRESULT hr = factory->EnumAdapterByGpuPreference(index, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE, IID_PPV_ARGS(&adapter));
            if (hr == DXGI_ERROR_NOT_FOUND) break;
            THROW_IF_FAILED(hr);
            DXGI_ADAPTER_DESC3 desc{};
            THROW_IF_FAILED(adapter->GetDesc3(&desc));
            j.begin('{');
            j.key("index").num(index);
            j.key("name").str(std::wstring_view(desc.Description));
            j.key("vendorId").hex(desc.VendorId, 4);
            j.key("deviceId").hex(desc.DeviceId, 4);
            j.key("dedicatedVideoMemory").num(desc.DedicatedVideoMemory);
            j.key("sharedSystemMemory").num(desc.SharedSystemMemory);
            j.key("software").boolean((desc.Flags & DXGI_ADAPTER_FLAG3_SOFTWARE) != 0);
            if (withDevice) device(j, adapter.get());
            j.end('}');
        }
        j.end(']');
        return j.take();
    }

    std::string profile()
    {
        using namespace winrt::Windows::System::Profile;
        using winrt::Windows::Security::ExchangeActiveSyncProvisioning::EasClientDeviceInformation;
        auto version = AnalyticsInfo::VersionInfo();
        uint64_t v = std::wcstoull(version.DeviceFamilyVersion().c_str(), nullptr, 10);
        EasClientDeviceInformation device;
        Json j;
        j.begin('{');
        j.key("deviceFamily").str(std::wstring_view(version.DeviceFamily()));
        j.key("deviceFamilyVersion")
            .str(std::to_string(v >> 48) + "." + std::to_string((v >> 32) & 0xFFFF) + "." + std::to_string((v >> 16) & 0xFFFF) + "." +
                 std::to_string(v & 0xFFFF));
        j.key("friendlyName").str(std::wstring_view(device.FriendlyName()));
        j.key("manufacturer").str(std::wstring_view(device.SystemManufacturer()));
        j.key("product").str(std::wstring_view(device.SystemProductName()));
        j.key("elevated").boolean(IsUserAnAdmin() != FALSE);
        j.end('}');
        return j.take();
    }

    std::string envelope(const char* method, const char* args)
    {
        std::string_view name = method == nullptr ? "" : method;
        std::string_view a = args == nullptr ? "" : args;
        try
        {
            std::string value;
            if (name == "graphics.adapters") value = adapters(a.find("\"device\":false") == std::string_view::npos);
            else if (name == "system.profile") value = profile();
            else
            {
                Json j;
                j.begin('{').key("ok").boolean(false).key("error").begin('{').key("code").str(std::string_view("EINVAL"));
                j.key("message").str("unknown method '" + std::string(name) + "'").end('}').end('}');
                return j.take();
            }
            return "{\"ok\":true,\"value\":" + value + "}";
        }
        catch (...)
        {
            HRESULT hr = wil::ResultFromCaughtException();
            Json j;
            j.begin('{').key("ok").boolean(false).key("error").begin('{');
            j.key("code").hex(static_cast<uint32_t>(hr), 8);
            j.key("message").str(std::string_view("C++ call failed")).end('}').end('}');
            return j.take();
        }
    }
}

extern "C"
{
    BUNOS_API int32_t bunos_cpp_abi(void) { return BUNOS_WINDOWS_ABI; }

    BUNOS_API int64_t bunos_cpp_ping(int64_t value) { return value + 1; }

    BUNOS_API char* bunos_cpp_call(const char* method, const char* args)
    {
        // WinRT needs an apartment on this thread; join the MTA (a no-op if the thread already has one).
        HRESULT co = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        auto result = dup(envelope(method, args));
        if (SUCCEEDED(co)) CoUninitialize();
        return result;
    }

    BUNOS_API void bunos_cpp_free(char* value) { std::free(value); }
}
