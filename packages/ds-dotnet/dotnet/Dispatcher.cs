using System.Text.Json;
using System.Text.Json.Nodes;
using Konnect.Contract.DataClasses.FileSystem;
using Konnect.Contract.Enums.Management.Files;
using Konnect.Contract.Management.Files;
using Konnect.Contract.Plugin.File;
using Konnect.Contract.Plugin.File.Archive;
using Konnect.Contract.Plugin.File.Image;
using Konnect.Management.Files;
using Konnect.Management.Plugin;
using Konnect.Management.Plugin.Loaders;
using SixLabors.ImageSharp;

namespace Aphrody.Ds;

internal static class Dispatcher
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private static PluginManager manager;
    private static FileManager files;

    private static string PluginDirectory =>
        Environment.GetEnvironmentVariable("APHRODY_DS_PLUGINS")
        ?? Path.Combine(Path.GetDirectoryName(typeof(Dispatcher).Assembly.Location)!, "plugins");

    // Plugins are loaded in isolation by the Konnect loader; resolve their dependencies to the host copies.
    private static bool resolverRegistered;

    private static void RegisterResolver()
    {
        if (resolverRegistered) return;
        resolverRegistered = true;
        var hostDirectory = Path.GetDirectoryName(typeof(Dispatcher).Assembly.Location)!;
        AppDomain.CurrentDomain.AssemblyResolve += (_, args) =>
        {
            var path = Path.Combine(hostDirectory, new System.Reflection.AssemblyName(args.Name).Name + ".dll");
            if (!File.Exists(path)) return null;
            // The hostfxr loader loads this assembly into its own context; share that context's copies with the plugins.
            var context = System.Runtime.Loader.AssemblyLoadContext.GetLoadContext(typeof(Dispatcher).Assembly)!;
            return context.LoadFromAssemblyPath(path);
        };
    }

    private static FileManager Files
    {
        get
        {
            if (files != null) return files;
            RegisterResolver();
            manager = new PluginManager(new PluginLoader<IFilePlugin>(PluginDirectory));
            files = new FileManager(manager);
            return files;
        }
    }

    public static string Error(Exception exception) =>
        new JsonObject { ["ok"] = false, ["error"] = exception.GetBaseException().Message, ["type"] = exception.GetType().Name }.ToJsonString(Json);

    public static string Run(string request)
    {
        var args = JsonNode.Parse(request)!.AsObject();
        var op = args["op"]!.GetValue<string>();
        JsonNode result = op switch
        {
            "plugins" => Plugins(),
            "diagnose" => Diagnose(),
            "identify" => Identify(Str(args, "path")),
            "list" => List(Str(args, "path"), Opt(args, "plugin")),
            "extract" => Extract(Str(args, "path"), Str(args, "entry"), Str(args, "out"), Opt(args, "plugin")),
            "extractAll" => ExtractAll(Str(args, "path"), Str(args, "out"), Opt(args, "plugin")),
            "png" => Png(Str(args, "path"), Opt(args, "entry"), Str(args, "out"), Opt(args, "plugin")),
            "h3d" => H3dSummary(Str(args, "path")),
            "exefs" => ExefsUnpack(Str(args, "path"), Str(args, "out")),
            _ => throw new ArgumentException($"unknown op '{op}'"),
        };
        return new JsonObject { ["ok"] = true, ["result"] = result }.ToJsonString(Json);
    }

    private static string Opt(JsonObject args, string key) => args[key]?.GetValue<string>();

    private static string Str(JsonObject args, string key) =>
        args[key]?.GetValue<string>() ?? throw new ArgumentException($"missing '{key}'");

    private static T Wait<T>(Task<T> task) => task.GetAwaiter().GetResult();

    private static JsonNode PluginInfo(IFilePlugin plugin) => plugin == null ? null : new JsonObject
    {
        ["id"] = plugin.PluginId.ToString(),
        ["type"] = plugin.PluginType.ToString(),
        ["name"] = plugin.Metadata.Name,
    };

    private static JsonNode Plugins()
    {
        _ = Files;
        var array = new JsonArray();
        foreach (var plugin in manager.GetPlugins<IFilePlugin>())
        {
            var info = PluginInfo(plugin).AsObject();
            info["developer"] = plugin.Metadata.Developer;
            info["publisher"] = plugin.Metadata.Publisher;
            info["extensions"] = new JsonArray(plugin.FileExtensions.Select(e => (JsonNode)e).ToArray());
            array.Add(info);
        }
        var errors = new JsonArray(manager.GetErrors().Select(e => (JsonNode)((e.AssemblyPath ?? "") + ": " + (e.Exception?.ToString() ?? ""))).ToArray());
        return new JsonObject { ["plugins"] = array, ["errors"] = errors };
    }

    private static JsonNode Diagnose()
    {
        RegisterResolver();
        var report = new JsonArray();
        foreach (var dll in Directory.GetFiles(PluginDirectory, "*.dll"))
        {
            var entry = new JsonObject { ["assembly"] = dll };
            try
            {
                var assembly = System.Reflection.Assembly.LoadFile(Path.GetFullPath(dll));
                var types = assembly.GetExportedTypes();
                entry["exported"] = types.Length;
                entry["plugins"] = types.Count(typeof(IFilePlugin).IsAssignableFrom);
                var contract = typeof(IFilePlugin).Assembly;
                entry["hostContract"] = contract.Location;
                var referenced = assembly.GetReferencedAssemblies().FirstOrDefault(a => a.Name == "Konnect.Contract");
                entry["referenced"] = referenced?.ToString();
            }
            catch (Exception exception)
            {
                entry["error"] = exception.ToString();
            }
            report.Add(entry);
        }
        return report;
    }

    private static JsonNode Identify(string path)
    {
        var id = Wait(Files.Identify(path));
        if (id != null) return new JsonObject { ["plugin"] = PluginInfo(manager.GetPlugin<IFilePlugin>(id.Value)) };

        // Konnect returns nothing when several plugins claim a file or none can identify content; report the candidates.
        var candidates = new JsonArray(Candidates(path, null).Select(PluginInfo).ToArray());
        return new JsonObject { ["plugin"] = candidates.Count == 1 ? candidates[0].DeepClone() : null, ["candidates"] = candidates };
    }

    // Many Kuriimu2 plugins cannot identify content and are matched by extension only (CIA, CGFX, ...).
    private static IEnumerable<IFilePlugin> Candidates(string path, string pluginSelector)
    {
        var all = manager.GetPlugins<IFilePlugin>().Where(p => p.PluginType != Konnect.Contract.Enums.Plugin.File.PluginType.Font).ToList();
        if (pluginSelector != null)
        {
            var chosen = all.Where(p => p.PluginId.ToString() == pluginSelector
                || string.Equals(p.Metadata.Name, pluginSelector, StringComparison.OrdinalIgnoreCase)).ToList();
            if (chosen.Count == 0) throw new ArgumentException($"unknown plugin '{pluginSelector}'");
            return chosen;
        }

        var identified = new List<IFilePlugin>();
        foreach (var plugin in all.Where(p => p.CanIdentifyFiles))
            if (Wait(Files.Identify(path, plugin.PluginId))) identified.Add(plugin);
        var name = Path.GetFileName(path);
        var byExtension = all.Where(p => !identified.Contains(p) && p.FileExtensions.Any(e =>
            name.EndsWith(e.TrimStart('*'), StringComparison.OrdinalIgnoreCase)));
        return identified.Concat(byExtension).ToList();
    }

    private static IFileState Open(string path, string pluginSelector = null)
    {
        _ = Files;
        var errors = new List<string>();
        foreach (var plugin in Candidates(path, pluginSelector))
        {
            var result = Wait(Files.LoadFile(path, plugin.PluginId));
            if (result.Status == LoadStatus.Successful && result.LoadedFileState != null)
                return result.LoadedFileState;
            errors.Add($"{plugin.Metadata.Name}: {result.Exception?.GetBaseException().Message ?? result.Reason.ToString()}");
        }
        throw new InvalidDataException(errors.Count == 0 ? "no plugin matches this file" : string.Join("; ", errors));
    }

    private static JsonNode List(string path, string plugin)
    {
        using var state = Open(path, plugin);
        var node = new JsonObject { ["plugin"] = PluginInfo(state.FilePlugin) };
        if (state.PluginState is IArchiveFilePluginState archive)
        {
            node["kind"] = "archive";
            node["entries"] = new JsonArray(archive.Files
                .Select(f => (JsonNode)new JsonObject { ["path"] = f.FilePath.FullName, ["size"] = f.FileSize })
                .ToArray());
        }
        else if (state.PluginState is IImageFilePluginState image)
        {
            node["kind"] = "image";
            node["images"] = new JsonArray(image.Images
                .Select(i => (JsonNode)new JsonObject
                {
                    ["name"] = i.ImageInfo.Name,
                    ["width"] = i.ImageInfo.ImageSize.Width,
                    ["height"] = i.ImageInfo.ImageSize.Height,
                    ["format"] = i.ImageInfo.ImageFormat,
                    ["indexed"] = i.IsIndexed,
                })
                .ToArray());
        }
        else
        {
            node["kind"] = state.PluginState.IsText ? "text" : state.PluginState.IsFont ? "font" : "other";
        }
        return node;
    }

    private static IArchiveFile Entry(IArchiveFilePluginState archive, string entry)
    {
        var wanted = "/" + entry.Replace('\\', '/').TrimStart('/');
        return archive.Files.FirstOrDefault(f => "/" + f.FilePath.FullName.TrimStart('/') == wanted)
            ?? throw new FileNotFoundException($"no entry '{entry}'");
    }

    private static long Copy(IArchiveFile entry, string output)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
        using var input = Wait(entry.GetFileData());
        using var target = File.Create(output);
        input.CopyTo(target);
        return target.Length;
    }

    private static JsonNode Extract(string path, string entry, string output, string plugin)
    {
        using var state = Open(path, plugin);
        var archive = state.PluginState as IArchiveFilePluginState ?? throw new InvalidDataException("not an archive");
        return new JsonObject { ["bytes"] = Copy(Entry(archive, entry), output) };
    }

    private static JsonNode ExtractAll(string path, string output, string plugin)
    {
        using var state = Open(path, plugin);
        var archive = state.PluginState as IArchiveFilePluginState ?? throw new InvalidDataException("not an archive");
        long total = 0;
        int count = 0;
        var root = Path.GetFullPath(output);
        foreach (var file in archive.Files)
        {
            var relative = file.FilePath.FullName.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var target = Path.GetFullPath(Path.Combine(root, relative));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"entry escapes output: {file.FilePath}");
            total += Copy(file, target);
            count++;
        }
        return new JsonObject { ["files"] = count, ["bytes"] = total };
    }

    private static JsonNode Png(string path, string entry, string output, string plugin)
    {
        using var state = Open(path, plugin);
        if (entry != null && state.PluginState is IArchiveFilePluginState archive)
        {
            var child = Wait(Files.LoadFile(state, Entry(archive, entry)));
            if (child.Status != LoadStatus.Successful || child.LoadedFileState == null)
                throw new InvalidDataException("entry is not a supported image");
            using var childState = child.LoadedFileState;
            return SaveImage(childState.PluginState as IImageFilePluginState, output);
        }
        return SaveImage(state.PluginState as IImageFilePluginState, output);
    }

    private static JsonNode SaveImage(IImageFilePluginState image, string output)
    {
        if (image == null || image.Images.Count == 0) throw new InvalidDataException("not an image");
        using var bitmap = image.Images[0].GetImage();
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
        bitmap.SaveAsPng(output);
        return new JsonObject { ["width"] = bitmap.Width, ["height"] = bitmap.Height };
    }

    private static JsonNode H3dSummary(string path)
    {
        var data = File.ReadAllBytes(path);
        var scene = data.Length > 3 && data[0] == (byte)'B' && data[1] == (byte)'C' && data[2] == (byte)'H'
            ? SPICA.Formats.CtrH3D.H3D.Open(data)
            : SPICA.Formats.CtrGfx.Gfx.Open(path).ToH3D();
        return new JsonObject
        {
            ["models"] = new JsonArray(scene.Models.Select(m => (JsonNode)m.Name).ToArray()),
            ["textures"] = new JsonArray(scene.Textures.Select(t => (JsonNode)new JsonObject
            {
                ["name"] = t.Name,
                ["width"] = t.Width,
                ["height"] = t.Height,
                ["format"] = t.Format.ToString(),
            }).ToArray()),
            ["skeletalAnimations"] = scene.SkeletalAnimations.Count,
            ["materialAnimations"] = scene.MaterialAnimations.Count,
        };
    }

    private static JsonNode ExefsUnpack(string path, string output)
    {
        Directory.CreateDirectory(output);
        var ok = pk3DS.Core.CTR.ExeFS.UnpackExeFS(path, output);
        return new JsonObject
        {
            ["ok"] = ok,
            ["files"] = new JsonArray(Directory.GetFiles(output).Select(f => (JsonNode)Path.GetFileName(f)).ToArray()),
        };
    }

}
