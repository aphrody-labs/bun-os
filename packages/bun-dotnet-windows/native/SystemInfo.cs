// SPDX-License-Identifier: MIT
using System.Text.Json;
using Windows.Security.ExchangeActiveSyncProvisioning;
using Windows.System.Power;
using Windows.System.Profile;
using Windows.Win32;
using Windows.Win32.System.SystemInformation;

namespace BunOs.Windows.Native;

/// <summary><c>system.info</c>: WinRT (Windows.System.Profile, EAS device information, power) and Win32 facts.</summary>
internal static unsafe class SystemInfo
{
    public static void Info(JsonElement args, Utf8JsonWriter w, Action<string>? progress)
    {
        w.WriteStartObject();

        var version = AnalyticsInfo.VersionInfo;
        var family = ulong.TryParse(version.DeviceFamilyVersion, out var v) ? v : 0;
        w.WriteStartObject("profile");
        w.WriteString("deviceFamily", version.DeviceFamily);
        w.WriteString("deviceFamilyVersion", $"{family >> 48}.{(family >> 32) & 0xFFFF}.{(family >> 16) & 0xFFFF}.{family & 0xFFFF}");
        w.WriteString("productName", version.ProductName);
        w.WriteBoolean("integrityPolicy", WindowsIntegrityPolicy.IsEnabled);
        w.WriteString("oobeState", SystemSetupInfo.OutOfBoxExperienceState.ToString());
        w.WriteEndObject();

        var device = new EasClientDeviceInformation();
        w.WriteStartObject("device");
        w.WriteString("friendlyName", device.FriendlyName);
        w.WriteString("operatingSystem", device.OperatingSystem);
        w.WriteString("manufacturer", device.SystemManufacturer);
        w.WriteString("product", device.SystemProductName);
        w.WriteString("sku", device.SystemSku);
        w.WriteString("firmware", device.SystemFirmwareVersion);
        w.WriteString("hardware", device.SystemHardwareVersion);
        w.WriteEndObject();

        w.WriteStartObject("power");
        w.WriteString("energySaver", PowerManager.EnergySaverStatus.ToString());
        w.WriteString("battery", PowerManager.BatteryStatus.ToString());
        w.WriteString("supply", PowerManager.PowerSupplyStatus.ToString());
        w.WriteNumber("remainingChargePercent", PowerManager.RemainingChargePercent);
        w.WriteEndObject();

        w.WriteStartObject("win32");
        SYSTEM_INFO info;
        PInvoke.GetNativeSystemInfo(&info);
        w.WriteNumber("logicalProcessors", info.dwNumberOfProcessors);
        w.WriteString("architecture", info.Anonymous.Anonymous.wProcessorArchitecture.ToString());
        var memory = new MEMORYSTATUSEX { dwLength = (uint)sizeof(MEMORYSTATUSEX) };
        if (PInvoke.GlobalMemoryStatusEx(&memory))
        {
            w.WriteNumber("memoryTotal", memory.ullTotalPhys);
            w.WriteNumber("memoryAvailable", memory.ullAvailPhys);
        }
        w.WriteNumber("uptimeMs", PInvoke.GetTickCount64());
        w.WriteBoolean("elevated", PInvoke.IsUserAnAdmin());
        w.WriteEndObject();

        w.WriteEndObject();
    }
}
