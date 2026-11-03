// SPDX-License-Identifier: MIT
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Management.Deployment;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Com;
using Windows.Win32.System.LibraryLoader;

namespace BunOs.Windows.Native;

/// <summary>
/// winget through its COM/WinRT API (Microsoft.Management.Deployment, the API winget.exe itself is a client of),
/// wrapped by the CsWinRT projection built from the vendor/winget-cli IDL. Activation, first match wins:
/// <list type="bullet">
/// <item>out-of-process: CoCreateInstance of the production CLSIDs (WindowsPackageManagerServer.exe, non-elevated);</item>
/// <item>manual: WinGetServerManualActivation_CreateInstance of winrtact.dll, the route for elevated callers;</item>
/// <item>in-process: WindowsPackageManager.dll named by BUNOS_WINGET_INPROC_DLL (a source build of vendor/winget-cli).</item>
/// </list>
/// Cross-process calls go through the WinRT universal marshaler, which must resolve Microsoft.Management.Deployment.winmd:
/// a packaged caller finds it in its package graph; an unpackaged one (bun.exe) does not and gets
/// APPMODEL_ERROR_NO_PACKAGE (0x80073D54). winrtact.dll (UndockedRegFreeWinRT, built from vendor/winget-cli) is loaded
/// first: it detours RoGetMetaDataFile/RoResolveNamespace to also search its own directory, where the winmd sits.
/// </summary>
internal static unsafe class Winget
{
    // Production CLSIDs (vendor/winget-cli/src/Microsoft.Management.Deployment/Public/ComClsids.h), out-of-process / in-process.
    private static readonly (Guid Oop, Guid InProc) ClsidPackageManager = (new("C53A4F16-787E-42A4-B304-29EFFB4BF597"), new("2DDE4456-64D9-4673-8F7E-A4F19A2E6CC3"));
    private static readonly (Guid Oop, Guid InProc) ClsidFindPackagesOptions = (new("572DED96-9C60-4526-8F92-EE7D91D38C1A"), new("96B9A53A-9228-4DA0-B013-BB1B2031AB3D"));
    private static readonly (Guid Oop, Guid InProc) ClsidCreateCompositePackageCatalogOptions = (new("526534B8-7E46-47C8-8416-B1685C327D37"), new("768318A6-2EB5-400D-84D0-DF3534C30F5D"));
    private static readonly (Guid Oop, Guid InProc) ClsidInstallOptions = (new("1095F097-EB96-453B-B4E6-1613637F3B14"), new("E2AF3BA8-8A88-4766-9DDA-AE4013ADE286"));
    private static readonly (Guid Oop, Guid InProc) ClsidUninstallOptions = (new("E1D9A11E-9F85-4D87-9C17-2B93143ADB8D"), new("869CB959-EB54-425C-A1E4-1A1C291C64E9"));
    private static readonly (Guid Oop, Guid InProc) ClsidPackageMatchFilter = (new("D02C9DAF-99DC-429C-B503-4E504E4AB000"), new("57DC8962-7343-42CD-B91C-04F6A25DB1D0"));
    private static readonly Guid IidIUnknown = new("00000000-0000-0000-C000-000000000046");

    private enum Activation { Auto, OutOfProc, Manual, InProc }

    private static readonly Lock s_gate = new();
    private static Activation s_mode = Environment.GetEnvironmentVariable("BUNOS_WINGET_ACTIVATION") switch
    {
        "inproc" => Activation.InProc,
        "manual" => Activation.Manual,
        "outofproc" => Activation.OutOfProc,
        _ => Activation.Auto,
    };
    private static bool s_hooked;
    private static string? s_winrtact;
    private static delegate* unmanaged[Stdcall]<Guid*, Guid*, uint, void**, int> s_manualCreate;
    private static delegate* unmanaged[Stdcall]<Guid*, Guid*, void**, int> s_getClassObject;
    private static readonly List<SafeHandle> s_libraries = [];
    private static PackageManager? s_manager;

    /// <summary>The activation route in use and the winrtact.dll that resolves the winget metadata.</summary>
    public static void Status(Utf8JsonWriter w)
    {
        Manager();
        w.WriteString("activation", s_mode.ToString().ToLowerInvariant());
        w.WriteString("winrtact", s_winrtact);
    }

    private static COMException Failure(string what, int hr) => new(
        hr == unchecked((int)0x80040154)
            ? "the winget COM server is not registered (install or update App Installer, Microsoft.DesktopAppInstaller)"
            : hr == unchecked((int)0x80073D54)
                ? "the WinRT marshaler cannot resolve Microsoft.Management.Deployment.winmd: install winrtact.dll and the winmd beside bunos_windows.dll (bun packages/bun-dotnet-windows/scripts/build.ts cpp) or set BUNOS_WINRTACT"
                : $"{what} failed (0x{hr:X8})",
        hr);

    /// <summary>The directory of bunos_windows.dll itself (not of the host exe).</summary>
    private static string? OwnDirectory()
    {
        HMODULE module;
        delegate* unmanaged[Cdecl]<int> self = &Exports.Abi;
        if (!PInvoke.GetModuleHandleEx(
                GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                (char*)self,
                &module))
            return null;
        var buffer = stackalloc char[1024];
        var length = PInvoke.GetModuleFileName(module, buffer, 1024);
        return length == 0 ? null : Path.GetDirectoryName(new string(buffer, 0, (int)length));
    }

    private const uint GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS = 0x4;
    private const uint GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT = 0x2;

    private static SafeHandle Load(string path)
    {
        var module = PInvoke.LoadLibraryEx(path, LOAD_LIBRARY_FLAGS.LOAD_WITH_ALTERED_SEARCH_PATH);
        if (module.IsInvalid) throw Failure($"LoadLibraryEx({path})", Marshal.GetHRForLastWin32Error());
        s_libraries.Add(module); // never released: these stay loaded for the life of the process
        return module;
    }

    /// <summary>Loads winrtact.dll once: BUNOS_WINRTACT, else beside this library, else ../cpp in the build tree.</summary>
    private static void Hook()
    {
        if (s_hooked) return;
        s_hooked = true;
        var own = OwnDirectory();
        string?[] candidates =
        [
            Environment.GetEnvironmentVariable("BUNOS_WINRTACT"),
            own is null ? null : Path.Combine(own, "winrtact.dll"),
            own is null ? null : Path.Combine(own, "..", "cpp", "winrtact.dll"),
        ];
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrEmpty(candidate) || !File.Exists(candidate)) continue;
            var module = Load(Path.GetFullPath(candidate));
            var init = PInvoke.GetProcAddress(module, "winrtact_Initialize");
            if (!init.IsNull) ((delegate* unmanaged[Stdcall]<void>)(nint)init.Value)();
            var manual = PInvoke.GetProcAddress(module, "WinGetServerManualActivation_CreateInstance");
            if (!manual.IsNull) s_manualCreate = (delegate* unmanaged[Stdcall]<Guid*, Guid*, uint, void**, int>)(nint)manual.Value;
            s_winrtact = Path.GetFullPath(candidate);
            return;
        }
    }

    private static void Decide()
    {
        Hook();
        if (s_mode != Activation.Auto) return;
        // The out-of-process server refuses elevated callers; manual activation (winrtact) is their route.
        s_mode = PInvoke.IsUserAnAdmin() && s_manualCreate != null ? Activation.Manual : Activation.OutOfProc;
    }

    private static void LoadInProc()
    {
        if (s_getClassObject != null) return;
        var path = Environment.GetEnvironmentVariable("BUNOS_WINGET_INPROC_DLL");
        if (string.IsNullOrEmpty(path))
            throw new ArgumentProblem("in-process winget needs BUNOS_WINGET_INPROC_DLL (WindowsPackageManager.dll of a vendor/winget-cli build)");
        var module = Load(path);
        var init = PInvoke.GetProcAddress(module, "WindowsPackageManagerInProcModuleInitialize");
        var get = PInvoke.GetProcAddress(module, "WindowsPackageManagerInProcModuleGetClassObject");
        if (init.IsNull || get.IsNull) throw new COMException($"{path} has no in-process winget exports", unchecked((int)0x8007007F));
        var hr = ((delegate* unmanaged[Stdcall]<int>)(nint)init.Value)();
        if (hr < 0) throw Failure("WindowsPackageManagerInProcModuleInitialize", hr);
        s_getClassObject = (delegate* unmanaged[Stdcall]<Guid*, Guid*, void**, int>)(nint)get.Value;
    }

    private static T Create<T>((Guid Oop, Guid InProc) clsids, Func<nint, T> fromAbi)
    {
        lock (s_gate) Decide();
        void* raw = null;
        var iid = IidIUnknown;
        int hr;
        switch (s_mode)
        {
            case Activation.InProc:
            {
                lock (s_gate) LoadInProc();
                var clsid = clsids.InProc;
                var factoryIid = IClassFactory.IID_Guid;
                void* factoryRaw;
                hr = s_getClassObject(&clsid, &factoryIid, &factoryRaw);
                if (hr < 0) throw Failure($"GetClassObject({clsid})", hr);
                var factory = (IClassFactory*)factoryRaw;
                try
                {
                    factory->CreateInstance(null, &iid, &raw);
                }
                finally
                {
                    factory->Release();
                }
                break;
            }
            case Activation.Manual:
            {
                if (s_manualCreate == null) throw new ArgumentProblem("manual winget activation needs winrtact.dll (BUNOS_WINRTACT)");
                var clsid = clsids.Oop;
                hr = s_manualCreate(&clsid, &iid, 0, &raw);
                if (hr < 0) throw Failure($"WinGetServerManualActivation_CreateInstance({clsid})", hr);
                break;
            }
            default:
            {
                var clsid = clsids.Oop;
                var result = PInvoke.CoCreateInstance(&clsid, null, CLSCTX.CLSCTX_LOCAL_SERVER, &iid, &raw);
                if (result.Failed) throw Failure($"CoCreateInstance({clsid})", result.Value);
                break;
            }
        }
        try
        {
            return fromAbi((nint)raw);
        }
        catch (COMException error) when (error.HResult == unchecked((int)0x80073D54))
        {
            throw Failure("winget proxy", error.HResult);
        }
        finally
        {
            Marshal.Release((nint)raw);
        }
    }

    private static PackageManager Manager() => s_manager ??= Create(ClsidPackageManager, PackageManager.FromAbi);

    private static PackageMatchFilter Filter(PackageMatchField field, PackageFieldMatchOption option, string value)
    {
        var filter = Create(ClsidPackageMatchFilter, PackageMatchFilter.FromAbi);
        filter.Field = field;
        filter.Option = option;
        filter.Value = value;
        return filter;
    }

    // WinRT collections are walked by index (IVectorView Size/GetAt): the cross-process proxies do not expose
    // IIterable<T> for every element type, so foreach/LINQ (GetEnumerator -> IIterable) fails with E_NOINTERFACE.

    /// <summary>The remote catalog(s) to search: one by name, or every configured source.</summary>
    private static List<PackageCatalogReference> Remotes(PackageManager manager, string? source)
    {
        if (!string.IsNullOrEmpty(source))
        {
            var named = manager.GetPackageCatalogByName(source)
                ?? throw new ArgumentProblem($"no winget source named '{source}'");
            return [named];
        }
        var all = manager.GetPackageCatalogs();
        var list = new List<PackageCatalogReference>(all.Count);
        for (var i = 0; i < all.Count; i++) list.Add(all[i]);
        return list;
    }


    /// <summary>A connected composite catalog: remote packages correlated with what is installed, or the reverse.</summary>
    private static PackageCatalog Connect(string? source, bool installed)
    {
        var manager = Manager();
        var options = Create(ClsidCreateCompositePackageCatalogOptions, CreateCompositePackageCatalogOptions.FromAbi);
        foreach (var remote in Remotes(manager, source)) options.Catalogs.Add(remote);
        options.CompositeSearchBehavior = installed
            ? CompositeSearchBehavior.LocalCatalogs
            : CompositeSearchBehavior.RemotePackagesFromAllCatalogs;
        var connect = manager.CreateCompositePackageCatalog(options).Connect();
        if (connect.Status != ConnectResultStatus.Ok)
            throw new COMException($"winget catalog connect failed: {connect.Status}", connect.ExtendedErrorCode?.HResult ?? -1);
        return connect.PackageCatalog;
    }

    private static IReadOnlyList<MatchResult> Find(PackageCatalog catalog, JsonElement args, bool requireQuery)
    {
        var options = Create(ClsidFindPackagesOptions, FindPackagesOptions.FromAbi);
        options.ResultLimit = (uint)Math.Clamp(args.Int("limit", requireQuery ? 50 : 0), 0, 10_000);
        var id = args.Str("id");
        var query = args.Str("query");
        if (!string.IsNullOrEmpty(id))
            options.Filters.Add(Filter(PackageMatchField.Id, PackageFieldMatchOption.EqualsCaseInsensitive, id));
        else if (!string.IsNullOrEmpty(query))
            options.Selectors.Add(Filter(PackageMatchField.CatalogDefault, PackageFieldMatchOption.ContainsCaseInsensitive, query));
        else if (requireQuery)
            throw new ArgumentProblem("winget search requires 'query' or 'id'");
        var name = args.Str("name");
        if (!string.IsNullOrEmpty(name))
            options.Filters.Add(Filter(PackageMatchField.Name, PackageFieldMatchOption.ContainsCaseInsensitive, name));
        var moniker = args.Str("moniker");
        if (!string.IsNullOrEmpty(moniker))
            options.Filters.Add(Filter(PackageMatchField.Moniker, PackageFieldMatchOption.EqualsCaseInsensitive, moniker));
        var tag = args.Str("tag");
        if (!string.IsNullOrEmpty(tag))
            options.Filters.Add(Filter(PackageMatchField.Tag, PackageFieldMatchOption.ContainsCaseInsensitive, tag));
        var result = catalog.FindPackages(options);
        if (result.Status != FindPackagesResultStatus.Ok)
            throw new COMException($"winget find failed: {result.Status}", result.ExtendedErrorCode?.HResult ?? -1);
        return result.Matches;
    }

    private static void WritePackage(Utf8JsonWriter w, CatalogPackage package)
    {
        w.WriteStartObject();
        w.WriteString("id", package.Id);
        w.WriteString("name", package.Name);
        var installed = package.InstalledVersion;
        var available = package.DefaultInstallVersion;
        if (installed is not null) w.WriteString("installedVersion", installed.Version);
        if (available is not null)
        {
            w.WriteString("version", available.Version);
            w.WriteString("source", available.PackageCatalog?.Info.Name);
        }
        else if (installed is not null)
        {
            w.WriteString("source", installed.PackageCatalog?.Info.Name);
        }
        w.WriteBoolean("installed", installed is not null);
        w.WriteBoolean("updateAvailable", package.IsUpdateAvailable);
        w.WriteEndObject();
    }

    public static void Sources(JsonElement args, Utf8JsonWriter w, Action<string>? progress)
    {
        w.WriteStartArray();
        var catalogs = Manager().GetPackageCatalogs();
        for (var i = 0; i < catalogs.Count; i++)
        {
            var info = catalogs[i].Info;
            w.WriteStartObject();
            w.WriteString("name", info.Name);
            w.WriteString("id", info.Id);
            w.WriteString("type", info.Type);
            w.WriteString("argument", info.Argument);
            w.WriteString("origin", info.Origin.ToString());
            w.WriteString("trustLevel", info.TrustLevel.ToString());
            w.WriteBoolean("explicit", info.Explicit);
            w.WriteString("lastUpdate", info.LastUpdateTime.ToString("O"));
            w.WriteEndObject();
        }
        w.WriteEndArray();
    }

    public static void Search(JsonElement args, Utf8JsonWriter w, Action<string>? progress)
    {
        var matches = Find(Connect(args.Str("source"), installed: false), args, requireQuery: true);
        w.WriteStartArray();
        for (var i = 0; i < matches.Count; i++) WritePackage(w, matches[i].CatalogPackage);
        w.WriteEndArray();
    }

    public static void List(JsonElement args, Utf8JsonWriter w, Action<string>? progress)
    {
        var upgradable = args.Bool("upgradable", false);
        var matches = Find(Connect(args.Str("source"), installed: true), args, requireQuery: false);
        w.WriteStartArray();
        for (var i = 0; i < matches.Count; i++)
        {
            var package = matches[i].CatalogPackage;
            if (!upgradable || package.IsUpdateAvailable) WritePackage(w, package);
        }
        w.WriteEndArray();
    }

    private static CatalogPackage One(JsonElement args, bool installed)
    {
        if (string.IsNullOrEmpty(args.Str("id"))) throw new ArgumentProblem("this winget method requires 'id'");
        var matches = Find(Connect(args.Str("source"), installed), args, requireQuery: false);
        return matches.Count switch
        {
            0 => throw new ArgumentProblem($"no package with id '{args.Str("id")}'{(installed ? " is installed" : "")}"),
            _ => matches[0].CatalogPackage,
        };
    }

    public static void Show(JsonElement args, Utf8JsonWriter w, Action<string>? progress)
    {
        var package = One(args, installed: false);
        w.WriteStartObject();
        w.WriteString("id", package.Id);
        w.WriteString("name", package.Name);
        var version = package.DefaultInstallVersion;
        if (version is not null)
        {
            var meta = version.GetCatalogPackageMetadata();
            w.WriteString("version", version.Version);
            w.WriteString("publisher", meta.Publisher);
            w.WriteString("author", meta.Author);
            w.WriteString("description", meta.Description);
            w.WriteString("shortDescription", meta.ShortDescription);
            w.WriteString("license", meta.License);
            w.WriteString("licenseUrl", meta.LicenseUrl);
            w.WriteString("packageUrl", meta.PackageUrl);
            w.WriteString("publisherUrl", meta.PublisherUrl);
            w.WriteString("releaseNotesUrl", meta.ReleaseNotesUrl);
            w.WriteStartArray("tags");
            var tags = meta.Tags;
            for (var i = 0; i < tags.Count; i++) w.WriteStringValue(tags[i]);
            w.WriteEndArray();
        }
        if (package.InstalledVersion is not null) w.WriteString("installedVersion", package.InstalledVersion.Version);
        w.WriteStartArray("versions");
        var versions = package.AvailableVersions;
        for (var i = 0; i < versions.Count; i++) w.WriteStringValue(versions[i].Version);
        w.WriteEndArray();
        w.WriteEndObject();
    }

    private static InstallOptions InstallOptionsFor(JsonElement args, CatalogPackage package)
    {
        var options = Create(ClsidInstallOptions, InstallOptions.FromAbi);
        options.PackageInstallMode = args.Bool("interactive", false) ? PackageInstallMode.Interactive : PackageInstallMode.Silent;
        options.PackageInstallScope = args.Str("scope") switch
        {
            "user" => PackageInstallScope.User,
            "machine" or "system" => PackageInstallScope.System,
            _ => PackageInstallScope.Any,
        };
        options.AcceptPackageAgreements = true;
        options.Force = args.Bool("force", false);
        options.AllowHashMismatch = false;
        var location = args.Str("location");
        if (!string.IsNullOrEmpty(location)) options.PreferredInstallLocation = location;
        var log = args.Str("log");
        if (!string.IsNullOrEmpty(log)) options.LogOutputPath = log;
        var wanted = args.Str("version");
        if (!string.IsNullOrEmpty(wanted))
        {
            var versions = package.AvailableVersions;
            PackageVersionId? key = null;
            for (var i = 0; i < versions.Count && key is null; i++)
                if (string.Equals(versions[i].Version, wanted, StringComparison.OrdinalIgnoreCase)) key = versions[i];
            options.PackageVersionId = key ?? throw new ArgumentProblem($"{package.Id} has no version '{wanted}'");
        }
        return options;
    }

    private static void WriteInstall(Utf8JsonWriter w, string action, CatalogPackage package, InstallResult result)
    {
        w.WriteStartObject();
        w.WriteString("action", action);
        w.WriteString("id", package.Id);
        w.WriteString("status", result.Status.ToString());
        w.WriteBoolean("ok", result.Status == InstallResultStatus.Ok);
        w.WriteBoolean("rebootRequired", result.RebootRequired);
        w.WriteNumber("installerErrorCode", result.InstallerErrorCode);
        if (result.ExtendedErrorCode is { } error) w.WriteString("extendedError", $"0x{error.HResult:X8}");
        w.WriteString("correlation", result.CorrelationData);
        w.WriteEndObject();
    }

    private static void Report(Action<string>? progress, string action, InstallProgress p)
    {
        progress?.Invoke(Json.Write(w =>
        {
            w.WriteStartObject();
            w.WriteString("action", action);
            w.WriteString("state", p.State.ToString());
            w.WriteNumber("bytesDownloaded", p.BytesDownloaded);
            w.WriteNumber("bytesRequired", p.BytesRequired);
            w.WriteNumber("downloadProgress", p.DownloadProgress);
            w.WriteNumber("installationProgress", p.InstallationProgress);
            w.WriteEndObject();
        }));
    }

    public static void Install(JsonElement args, Utf8JsonWriter w, Action<string>? progress)
    {
        var package = One(args, installed: false);
        var operation = Manager().InstallPackageAsync(package, InstallOptionsFor(args, package));
        operation.Progress = (_, p) => Report(progress, "install", p);
        WriteInstall(w, "install", package, operation.AsTask().GetAwaiter().GetResult());
    }

    public static void Upgrade(JsonElement args, Utf8JsonWriter w, Action<string>? progress)
    {
        var package = One(args, installed: true);
        if (!package.IsUpdateAvailable && !args.Bool("force", false))
        {
            w.WriteStartObject();
            w.WriteString("action", "upgrade");
            w.WriteString("id", package.Id);
            w.WriteString("status", "NoApplicableUpgrade");
            w.WriteBoolean("ok", true);
            w.WriteString("installedVersion", package.InstalledVersion?.Version);
            w.WriteEndObject();
            return;
        }
        var operation = Manager().UpgradePackageAsync(package, InstallOptionsFor(args, package));
        operation.Progress = (_, p) => Report(progress, "upgrade", p);
        WriteInstall(w, "upgrade", package, operation.AsTask().GetAwaiter().GetResult());
    }

    public static void Uninstall(JsonElement args, Utf8JsonWriter w, Action<string>? progress)
    {
        var package = One(args, installed: true);
        var options = Create(ClsidUninstallOptions, UninstallOptions.FromAbi);
        options.PackageUninstallMode = args.Bool("interactive", false) ? PackageUninstallMode.Interactive : PackageUninstallMode.Silent;
        options.Force = args.Bool("force", false);
        var operation = Manager().UninstallPackageAsync(package, options);
        operation.Progress = (_, p) => progress?.Invoke(Json.Write(x =>
        {
            x.WriteStartObject();
            x.WriteString("action", "uninstall");
            x.WriteString("state", p.State.ToString());
            x.WriteNumber("uninstallationProgress", p.UninstallationProgress);
            x.WriteEndObject();
        }));
        var result = operation.AsTask().GetAwaiter().GetResult();
        w.WriteStartObject();
        w.WriteString("action", "uninstall");
        w.WriteString("id", package.Id);
        w.WriteString("status", result.Status.ToString());
        w.WriteBoolean("ok", result.Status == UninstallResultStatus.Ok);
        w.WriteBoolean("rebootRequired", result.RebootRequired);
        w.WriteNumber("uninstallerErrorCode", result.UninstallerErrorCode);
        if (result.ExtendedErrorCode is { } error) w.WriteString("extendedError", $"0x{error.HResult:X8}");
        w.WriteEndObject();
    }
}
