// SPDX-License-Identifier: MIT
using System.Buffers;
using System.Text;
using System.Text.Json;

namespace BunOs.Windows.Native;

/// <summary>Reflection-free JSON (Utf8JsonWriter / JsonDocument): nothing for the AOT trimmer to lose.</summary>
internal static class Json
{
    public static string Write(Action<Utf8JsonWriter> body)
    {
        var buffer = new ArrayBufferWriter<byte>(1024);
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { SkipValidation = true }))
            body(writer);
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    public static JsonElement Parse(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return default;
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    public static string? Str(this JsonElement args, string name) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static int Int(this JsonElement args, string name, int fallback) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : fallback;

    public static bool Bool(this JsonElement args, string name, bool fallback) =>
        args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v) &&
        v.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? v.GetBoolean()
            : fallback;
}

/// <summary>An argument error: reported with code EINVAL instead of an HRESULT.</summary>
internal sealed class ArgumentProblem(string message) : Exception(message);
