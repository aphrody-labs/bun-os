// SPDX-License-Identifier: MIT
using System.Buffers;
using System.Collections;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text;
using System.Text.Json;

namespace BunOs.Pwsh;

/// <summary>
/// C ABI of BunOs.Pwsh.dll for bun:dotnet (<c>functionPointer({ type: "BunOs.Pwsh.Exports, BunOs.Pwsh", method })</c>).
/// <c>Eval(script, options)</c> runs a pipeline in a persistent runspace and returns the output objects, the error,
/// warning, information, verbose and debug streams as one JSON document (UTF-8, released with <c>Free</c>).
/// </summary>
public static unsafe class Exports
{
    public const int AbiVersion = 1;

    /// <summary>PSHOME: the directory of the System.Management.Automation this host binds to.</summary>
    public static string PsHome { get; } = ResolvePsHome();

#pragma warning disable CA2255 // a library module initializer is the point: it must run before any PowerShell type loads
    [ModuleInitializer]
    internal static void Init()
    {
        // The default load context knows only the shared frameworks. PowerShell's own assemblies, RID-specific ones
        // (runtimes/win-x64/lib/...) and native libraries resolve through pwsh.deps.json of PSHOME, like pwsh.exe.
        var deps = Path.Combine(PsHome, "pwsh.dll");
        var resolver = File.Exists(deps) ? new AssemblyDependencyResolver(deps) : null;
        AssemblyLoadContext.Default.Resolving += (context, name) =>
        {
            var path = resolver?.ResolveAssemblyToPath(name) ?? Path.Combine(PsHome, name.Name + ".dll");
            return File.Exists(path) ? context.LoadFromAssemblyPath(path) : null;
        };
        AssemblyLoadContext.Default.ResolvingUnmanagedDll += (_, name) =>
        {
            var path = resolver?.ResolveUnmanagedDllToPath(name);
            return path is not null && NativeLibrary.TryLoad(path, out var handle) ? handle : 0;
        };
    }

    private static string ResolvePsHome()
    {
        var explicitHome = Environment.GetEnvironmentVariable("BUNOS_PSHOME");
        if (!string.IsNullOrEmpty(explicitHome)) return Path.GetFullPath(explicitHome);
        var here = Path.GetDirectoryName(typeof(Exports).Assembly.Location) ?? AppContext.BaseDirectory;
        foreach (var candidate in new[] { Path.Combine(here, "pshome"), Path.Combine(here, "..", "pwsh-fxdependent"), here })
            if (File.Exists(Path.Combine(candidate, "System.Management.Automation.dll")))
                return Path.GetFullPath(candidate);
        return here;
    }

    [UnmanagedCallersOnly]
    public static int Abi() => AbiVersion;

    [UnmanagedCallersOnly]
    public static long Ping(long value) => value + 1;

    [UnmanagedCallersOnly]
    public static void Free(byte* value)
    {
        if (value != null) NativeMemory.Free(value);
    }

    [UnmanagedCallersOnly]
    public static byte* Version() => Alloc(Host.VersionJson());

    /// <summary>Runs <paramref name="script"/>; <paramref name="options"/> is JSON (see <see cref="Host.Eval"/>).</summary>
    [UnmanagedCallersOnly]
    public static byte* Eval(byte* script, byte* options)
    {
        string result;
        try
        {
            result = Host.Eval(Read(script), Read(options));
        }
        catch (Exception error)
        {
            result = Host.Failure(error);
        }
        return Alloc(result);
    }

    /// <summary>
    /// <see cref="Eval"/> on a thread-pool thread; <paramref name="callback"/>(user, 1, json) runs there when the
    /// pipeline completes (the JSON pointer is valid only during the callback).
    /// </summary>
    [UnmanagedCallersOnly]
    public static void EvalAsync(byte* script, byte* options, nint callback, nint user)
    {
        var text = Read(script);
        var json = Read(options);
        _ = Task.Run(() =>
        {
            string result;
            try
            {
                result = Host.Eval(text, json);
            }
            catch (Exception error)
            {
                result = Host.Failure(error);
            }
            var count = Encoding.UTF8.GetByteCount(result);
            var bytes = new byte[count + 1];
            Encoding.UTF8.GetBytes(result, bytes);
            fixed (byte* p = bytes) ((delegate* unmanaged[Cdecl]<nint, int, byte*, void>)callback)(user, 1, p);
        });
    }

    private static string Read(byte* value) => value == null ? string.Empty : Marshal.PtrToStringUTF8((nint)value) ?? string.Empty;

    private static byte* Alloc(string value)
    {
        var count = Encoding.UTF8.GetByteCount(value);
        var buffer = (byte*)NativeMemory.Alloc((nuint)count + 1);
        Encoding.UTF8.GetBytes(value, new Span<byte>(buffer, count));
        buffer[count] = 0;
        return buffer;
    }
}

internal static class Host
{
    private static readonly Lock s_gate = new();
    private static Runspace? s_runspace;

    private static Runspace Open()
    {
        var state = InitialSessionState.CreateDefault2();
        if (OperatingSystem.IsWindows()) state.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.Bypass;
        state.ThreadOptions = PSThreadOptions.UseCurrentThread;
        var runspace = RunspaceFactory.CreateRunspace(state);
        runspace.Open();
        return runspace;
    }

    public static string VersionJson() => Write(w =>
    {
        w.WriteStartObject();
        w.WriteString("library", "BunOs.Pwsh");
        w.WriteNumber("abi", Exports.AbiVersion);
        w.WriteString("powershell", typeof(PSObject).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);
        w.WriteString("pshome", Exports.PsHome);
        w.WriteString("runtime", RuntimeInformation.FrameworkDescription);
        w.WriteEndObject();
    });

    /// <summary>
    /// Options: <c>depth</c> (object graph depth, default 2), <c>fresh</c> (new runspace instead of the persistent
    /// one), <c>variables</c> (object: name to JSON value, set before the script runs), <c>cwd</c>.
    /// </summary>
    public static string Eval(string script, string optionsJson)
    {
        using var options = JsonDocument.Parse(string.IsNullOrWhiteSpace(optionsJson) ? "{}" : optionsJson);
        var root = options.RootElement;
        var depth = root.TryGetProperty("depth", out var d) && d.TryGetInt32(out var di) ? Math.Clamp(di, 0, 16) : 2;
        var fresh = root.TryGetProperty("fresh", out var f) && f.ValueKind == JsonValueKind.True;

        lock (s_gate)
        {
            var started = Stopwatch.GetTimestamp();
            var runspace = fresh ? Open() : (s_runspace ??= Open());
            try
            {
                using var ps = PowerShell.Create();
                ps.Runspace = runspace;
                if (root.TryGetProperty("variables", out var variables) && variables.ValueKind == JsonValueKind.Object)
                    foreach (var variable in variables.EnumerateObject())
                        runspace.SessionStateProxy.SetVariable(variable.Name, FromJson(variable.Value));
                if (root.TryGetProperty("cwd", out var cwd) && cwd.ValueKind == JsonValueKind.String)
                    runspace.SessionStateProxy.Path.SetLocation(WildcardPattern.Escape(cwd.GetString()!));
                ps.AddScript(script);
                Collection<PSObject> output;
                Exception? terminating = null;
                try
                {
                    output = ps.Invoke();
                }
                catch (RuntimeException error)
                {
                    output = [];
                    terminating = error;
                }
                var elapsed = Stopwatch.GetElapsedTime(started);
                return Write(w =>
                {
                    w.WriteStartObject();
                    w.WriteBoolean("ok", true);
                    w.WriteStartObject("value");
                    w.WriteStartArray("output");
                    foreach (var item in output) Value(w, item, depth);
                    w.WriteEndArray();
                    w.WriteStartArray("errors");
                    if (terminating is not null) w.WriteStringValue(terminating.Message);
                    foreach (var record in ps.Streams.Error) w.WriteStringValue(record.ToString());
                    w.WriteEndArray();
                    Strings(w, "warnings", ps.Streams.Warning);
                    Strings(w, "verbose", ps.Streams.Verbose);
                    Strings(w, "debug", ps.Streams.Debug);
                    w.WriteStartArray("information");
                    foreach (var record in ps.Streams.Information) w.WriteStringValue(record.MessageData?.ToString());
                    w.WriteEndArray();
                    w.WriteBoolean("hadErrors", ps.HadErrors || terminating is not null);
                    w.WriteNumber("durationMs", Math.Round(elapsed.TotalMilliseconds, 3));
                    w.WriteEndObject();
                    w.WriteEndObject();
                });
            }
            finally
            {
                if (fresh) runspace.Dispose();
            }
        }
    }

    public static string Failure(Exception error) => Write(w =>
    {
        w.WriteStartObject();
        w.WriteBoolean("ok", false);
        w.WriteStartObject("error");
        w.WriteString("code", error is JsonException ? "EINVAL" : $"0x{error.HResult:X8}");
        w.WriteString("message", error.Message);
        w.WriteString("type", error.GetType().FullName);
        for (var inner = error.InnerException; inner is not null; inner = inner.InnerException)
        {
            w.WriteString("cause", $"{inner.GetType().FullName}: {inner.Message}");
            if (Environment.GetEnvironmentVariable("BUNOS_WINDOWS_DEBUG") is { Length: > 0 }) w.WriteString("stack", inner.ToString());
            break;
        }
        w.WriteEndObject();
        w.WriteEndObject();
    });

    private static void Strings<T>(Utf8JsonWriter w, string name, PSDataCollection<T> records)
    {
        w.WriteStartArray(name);
        foreach (var record in records) w.WriteStringValue(record?.ToString());
        w.WriteEndArray();
    }

    private static object? FromJson(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.TryGetInt64(out var l) ? l : value.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Array => value.EnumerateArray().Select(FromJson).ToArray(),
        JsonValueKind.Object => value.EnumerateObject().Aggregate(new Hashtable(StringComparer.OrdinalIgnoreCase), (h, p) =>
        {
            h[p.Name] = FromJson(p.Value);
            return h;
        }),
        _ => null,
    };

    /// <summary>PowerShell objects as JSON: scalars as such, dictionaries as objects, enumerables as arrays, any other
    /// object as its (adapted and extended) properties down to <paramref name="depth"/>, then as its string.</summary>
    private static void Value(Utf8JsonWriter w, object? value, int depth)
    {
        if (value is PSObject ps && ps.BaseObject is not PSCustomObject) value = ps.BaseObject;
        switch (value)
        {
            case null or DBNull:
                w.WriteNullValue();
                return;
            case string s:
                w.WriteStringValue(s);
                return;
            case char c:
                w.WriteStringValue(c.ToString());
                return;
            case bool b:
                w.WriteBooleanValue(b);
                return;
            case int or long or short or byte or sbyte or ushort or uint:
                w.WriteNumberValue(Convert.ToInt64(value));
                return;
            case ulong u:
                w.WriteNumberValue(u);
                return;
            case float or double or decimal:
                var number = Convert.ToDouble(value);
                if (double.IsFinite(number)) w.WriteNumberValue(number);
                else w.WriteStringValue(number.ToString());
                return;
            case DateTime dt:
                w.WriteStringValue(dt.ToString("O"));
                return;
            case DateTimeOffset dto:
                w.WriteStringValue(dto.ToString("O"));
                return;
            case TimeSpan ts:
                w.WriteStringValue(ts.ToString("c"));
                return;
            case Guid or Uri or Version or Enum or ScriptBlock or Type:
                w.WriteStringValue(value.ToString());
                return;
        }
        if (depth < 0)
        {
            w.WriteStringValue(value.ToString());
            return;
        }
        if (value is IDictionary dictionary)
        {
            w.WriteStartObject();
            foreach (DictionaryEntry entry in dictionary)
            {
                w.WritePropertyName(entry.Key?.ToString() ?? "");
                Value(w, entry.Value, depth - 1);
            }
            w.WriteEndObject();
            return;
        }
        if (value is IEnumerable enumerable)
        {
            w.WriteStartArray();
            foreach (var item in enumerable) Value(w, item, depth - 1);
            w.WriteEndArray();
            return;
        }
        var wrapped = value as PSObject ?? PSObject.AsPSObject(value);
        w.WriteStartObject();
        foreach (var property in wrapped.Properties)
        {
            if (!property.IsGettable) continue;
            object? item;
            try
            {
                item = property.Value;
            }
            catch
            {
                continue;
            }
            w.WritePropertyName(property.Name);
            Value(w, item, depth - 1);
        }
        w.WriteEndObject();
    }

    private static string Write(Action<Utf8JsonWriter> body)
    {
        var buffer = new ArrayBufferWriter<byte>(4096);
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { SkipValidation = true }))
            body(writer);
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}
