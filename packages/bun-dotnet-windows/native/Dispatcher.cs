// SPDX-License-Identifier: MIT
using System.Runtime.InteropServices;
using System.Text.Json;

namespace BunOs.Windows.Native;

/// <summary>Method table behind <c>bunos_call</c>. Each method reads JSON arguments and writes one JSON value.</summary>
internal static class Dispatcher
{
    public delegate void Method(JsonElement args, Utf8JsonWriter output, Action<string>? progress);

    private static readonly Dictionary<string, Method> s_methods = new(StringComparer.Ordinal)
    {
        ["system.info"] = SystemInfo.Info,
        ["graphics.adapters"] = Graphics.Adapters,
        ["winget.status"] = static (_, w, _) =>
        {
            w.WriteStartObject();
            Winget.Status(w);
            w.WriteEndObject();
        },
        ["winget.sources"] = Winget.Sources,
        ["winget.search"] = Winget.Search,
        ["winget.list"] = Winget.List,
        ["winget.show"] = Winget.Show,
        ["winget.install"] = Winget.Install,
        ["winget.upgrade"] = Winget.Upgrade,
        ["winget.uninstall"] = Winget.Uninstall,
    };

    /// <summary>Methods that talk COM/WinRT and must not run on the caller's (possibly STA) thread.</summary>
    public static bool NeedsMta(string name) => !name.StartsWith("graphics.", StringComparison.Ordinal);

    public static string MethodsJson() => Json.Write(w =>
    {
        w.WriteStartArray();
        foreach (var name in s_methods.Keys.Order(StringComparer.Ordinal)) w.WriteStringValue(name);
        w.WriteEndArray();
    });

    public static string VersionJson() => Json.Write(w =>
    {
        w.WriteStartObject();
        w.WriteString("library", "bunos_windows");
        w.WriteNumber("abi", Exports.AbiVersion);
        w.WriteString("version", typeof(Dispatcher).Assembly.GetName().Version?.ToString(3) ?? "0.0.0");
        w.WriteString("runtime", RuntimeInformation.FrameworkDescription);
        w.WriteBoolean("nativeAot", !System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeSupported);
        w.WriteString("arch", RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant());
        w.WriteEndObject();
    });

    public static string Invoke(string name, string argsJson, Action<string>? progress)
    {
        try
        {
            if (!s_methods.TryGetValue(name, out var method))
                throw new ArgumentProblem($"unknown method '{name}'; see bunos_methods()");
            var args = Json.Parse(argsJson);
            return Json.Write(w =>
            {
                w.WriteStartObject();
                w.WriteBoolean("ok", true);
                w.WritePropertyName("value");
                method(args, w, progress);
                w.WriteEndObject();
            });
        }
        catch (Exception error)
        {
            return Json.Write(w =>
            {
                w.WriteStartObject();
                w.WriteBoolean("ok", false);
                w.WriteStartObject("error");
                w.WriteString("code", error is ArgumentProblem or JsonException ? "EINVAL" : $"0x{error.HResult:X8}");
                w.WriteString("message", error.Message);
                w.WriteString("type", error.GetType().Name);
                if (Environment.GetEnvironmentVariable("BUNOS_WINDOWS_DEBUG") is { Length: > 0 })
                    w.WriteString("stack", error.ToString());
                w.WriteEndObject();
                w.WriteEndObject();
            });
        }
    }
}
