// SPDX-License-Identifier: MIT
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace BunOs;

/// <summary>C ABI of the sample library; factory/dotnet-linux/README documents it, packages/buncc/src/dotnet-linux/interop.ts binds it.</summary>
public static unsafe class Exports
{
    [UnmanagedCallersOnly(EntryPoint = "bunos_add")]
    public static int Add(int a, int b) => a + b;

    /// <summary>Length in UTF-16 code units of a NUL-terminated UTF-8 string, -1 for NULL.</summary>
    [UnmanagedCallersOnly(EntryPoint = "bunos_utf16_length")]
    public static int Utf16Length(byte* utf8) => utf8 == null ? -1 : Marshal.PtrToStringUTF8((nint)utf8)!.Length;

    /// <summary>Writes the runtime description (for example ".NET 10.0.14") as UTF-8 into buf and returns the bytes written, or -1 if cap is too small.</summary>
    [UnmanagedCallersOnly(EntryPoint = "bunos_runtime_description")]
    public static int RuntimeDescription(byte* buf, int cap)
    {
        var bytes = Encoding.UTF8.GetBytes(RuntimeInformation.FrameworkDescription);
        if (bytes.Length > cap) return -1;
        bytes.AsSpan().CopyTo(new Span<byte>(buf, cap));
        return bytes.Length;
    }
}
