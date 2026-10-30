using System.Runtime.InteropServices;
using System.Text;

namespace Aphrody.Ds;

/// <summary>
/// Native-hosting entry point (src/hostfxr.ts). One JSON request in, one JSON response out, through caller-owned UTF-8 buffers.
/// Returns the response length, or the negated required capacity when the buffer is too small.
/// </summary>
public static unsafe class Exports
{
    [UnmanagedCallersOnly]
    public static int Abi() => 1;

    [UnmanagedCallersOnly]
    public static int Invoke(byte* request, int requestLength, byte* response, int capacity)
    {
        string json;
        try
        {
            json = Dispatcher.Run(Encoding.UTF8.GetString(request, requestLength));
        }
        catch (Exception exception)
        {
            json = Dispatcher.Error(exception);
        }

        var bytes = Encoding.UTF8.GetBytes(json);
        if (bytes.Length > capacity) return -bytes.Length;
        bytes.CopyTo(new Span<byte>(response, capacity));
        return bytes.Length;
    }
}
