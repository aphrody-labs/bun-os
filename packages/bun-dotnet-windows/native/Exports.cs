// SPDX-License-Identifier: MIT
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;

namespace BunOs.Windows.Native;

/// <summary>
/// The C ABI of bunos_windows.dll (include/bunos_windows.h). Every string crosses as NUL-terminated UTF-8; every
/// string this library returns is allocated here and released with <c>bunos_free</c>.
/// </summary>
public static unsafe class Exports
{
    /// <summary>ABI revision; bumped on any breaking change of the exported signatures.</summary>
    public const int AbiVersion = 1;

    private static long s_calls;

    [UnmanagedCallersOnly(EntryPoint = "bunos_abi", CallConvs = [typeof(CallConvCdecl)])]
    public static int Abi() => AbiVersion;

    /// <summary>Round-trip probe for call-latency measurements: returns its argument plus one.</summary>
    [UnmanagedCallersOnly(EntryPoint = "bunos_ping", CallConvs = [typeof(CallConvCdecl)])]
    public static long Ping(long value) => value + 1;

    [UnmanagedCallersOnly(EntryPoint = "bunos_version", CallConvs = [typeof(CallConvCdecl)])]
    public static byte* Version() => Utf8.Alloc(Dispatcher.VersionJson());

    [UnmanagedCallersOnly(EntryPoint = "bunos_free", CallConvs = [typeof(CallConvCdecl)])]
    public static void Free(byte* value)
    {
        if (value != null) NativeMemory.Free(value);
    }

    /// <summary>The methods <c>bunos_call</c> dispatches, as a JSON array.</summary>
    [UnmanagedCallersOnly(EntryPoint = "bunos_methods", CallConvs = [typeof(CallConvCdecl)])]
    public static byte* Methods() => Utf8.Alloc(Dispatcher.MethodsJson());

    /// <summary>
    /// Synchronous call: <paramref name="method"/> (e.g. <c>winget.search</c>) with JSON arguments; returns
    /// <c>{"ok":true,"value":...}</c> or <c>{"ok":false,"error":{...}}</c>. COM work runs on an MTA thread-pool
    /// thread, so the caller's apartment (often an STA UI or JS thread) is never changed.
    /// </summary>
    [UnmanagedCallersOnly(EntryPoint = "bunos_call", CallConvs = [typeof(CallConvCdecl)])]
    public static byte* Call(byte* method, byte* args)
    {
        var name = Utf8.Read(method);
        var json = Utf8.Read(args);
        var result = Dispatcher.NeedsMta(name)
            ? Task.Run(() => Dispatcher.Invoke(name, json, null)).GetAwaiter().GetResult()
            : Dispatcher.Invoke(name, json, null);
        return Utf8.Alloc(result);
    }

    /// <summary>
    /// Asynchronous call. <paramref name="callback"/> runs on a library thread with <c>kind</c> 0 = progress JSON,
    /// 1 = final envelope (the shape <c>bunos_call</c> returns). The JSON pointer is valid only during the callback.
    /// Returns the call id.
    /// </summary>
    [UnmanagedCallersOnly(EntryPoint = "bunos_call_async", CallConvs = [typeof(CallConvCdecl)])]
    public static long CallAsync(byte* method, byte* args, nint callback, nint user)
    {
        var name = Utf8.Read(method);
        var json = Utf8.Read(args);
        var id = Interlocked.Increment(ref s_calls);
        _ = Task.Run(() =>
        {
            var result = Dispatcher.Invoke(name, json, progress => Emit(callback, user, 0, progress));
            Emit(callback, user, 1, result);
        });
        return id;
    }

    private static void Emit(nint callback, nint user, int kind, string payload)
    {
        var bytes = Utf8.Bytes(payload);
        fixed (byte* p = bytes) ((delegate* unmanaged[Cdecl]<nint, int, byte*, void>)callback)(user, kind, p);
    }
}

internal static unsafe class Utf8
{
    public static string Read(byte* value) =>
        value == null ? string.Empty : Marshal.PtrToStringUTF8((nint)value) ?? string.Empty;

    public static byte[] Bytes(string value)
    {
        var count = Encoding.UTF8.GetByteCount(value);
        var bytes = new byte[count + 1];
        Encoding.UTF8.GetBytes(value, bytes);
        return bytes;
    }

    public static byte* Alloc(string value)
    {
        var count = Encoding.UTF8.GetByteCount(value);
        var buffer = (byte*)NativeMemory.Alloc((nuint)count + 1);
        Encoding.UTF8.GetBytes(value, new Span<byte>(buffer, count));
        buffer[count] = 0;
        return buffer;
    }
}
