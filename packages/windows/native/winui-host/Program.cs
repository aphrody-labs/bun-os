// SPDX-License-Identifier: Apache-2.0
// WinUI 3 smoke host: JSON lines over stdin/stdout, driven by Bun.
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Markup;
using Microsoft.Windows.ApplicationModel.DynamicDependency;
using WinRT;

namespace WinUIHost;

static class Out {
  static readonly object Gate = new();
  static readonly Stream Stdout = Console.OpenStandardOutput();
  public static void Line(object o) {
    var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o) + "\n");
    lock (Gate) { Stdout.Write(bytes); Stdout.Flush(); }
  }
}

static class Program {
  static int InitBootstrap(out string version) {
    version = "";
    if (!Bootstrap.TryInitialize(
          0x00020006, // WindowsAppSDK 2.6
          "",
          new PackageVersion(0),
          Bootstrap.InitializeOptions.None, out int hr)) return hr;
    try { System.Runtime.InteropServices.NativeLibrary.Load("Microsoft.WindowsAppRuntime.dll"); } catch { }
    foreach (ProcessModule m in Process.GetCurrentProcess().Modules) {
      var mm = System.Text.RegularExpressions.Regex.Match(m.FileName ?? "", @"Microsoft\.WindowsAppRuntime\.[^_\\]*_([0-9.]+)_");
      if (mm.Success) { version = mm.Groups[1].Value; break; }
    }
    return 0;
  }

  [STAThread]
  static int Main(string[] args) {
    ComWrappersSupport.InitializeComWrappers();
    int hr = InitBootstrap(out var version);
    if (args.Contains("--probe")) {
      Out.Line(new {
        ok = hr == 0,
        runtimeVersion = version,
        requested = "2.6",
        hresult = hr == 0 ? null : "0x" + hr.ToString("X8"),
      });
      if (hr == 0) Bootstrap.Shutdown();
      return hr == 0 ? 0 : 2;
    }
    if (hr != 0) {
      Out.Line(new { @event = "error", code = "ERR_WINUI_RUNTIME_NOT_FOUND", hresult = "0x" + hr.ToString("X8") });
      return 2;
    }
    AppDomain.CurrentDomain.UnhandledException += (_, e) => Console.Error.WriteLine("unhandled: " + e.ExceptionObject);
    Application.Start(p => {
      try {
      var dq = DispatcherQueue.GetForCurrentThread();
      SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(dq));
      _ = new HostApp(dq);
      } catch (Exception e) { Console.Error.WriteLine("start failed: " + e); throw; }
    });
    Bootstrap.Shutdown();
    return 0;
  }
}

class HostApp : Application {
  readonly DispatcherQueue _dq;
  Window? _window;
  FrameworkElement? _root;

  public HostApp(DispatcherQueue dq) {
    _dq = dq;
  }

  protected override void OnLaunched(LaunchActivatedEventArgs args) {
    try {
      Resources.MergedDictionaries.Add(new XamlControlsResources());
    } catch (Exception e) {
      Console.Error.WriteLine("resources: " + e);
    }
    var t = new Thread(ReadLoop) { IsBackground = true, Name = "stdin" };
    t.Start();
    Out.Line(new { @event = "ready" });
  }

  void ReadLoop() {
    var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    string? line;
    while ((line = reader.ReadLine()) != null) {
      if (line.Length == 0) continue;
      var l = line;
      _dq.TryEnqueue(() => Handle(l));
    }
    _dq.TryEnqueue(Shutdown);
  }

  void Shutdown() {
    try { _window?.Close(); } catch { }
    Exit();
  }

  void Handle(string line) {
    JsonElement msg;
    object? id = null;
    try {
      msg = JsonDocument.Parse(line).RootElement;
      if (msg.TryGetProperty("id", out var idEl)) id = idEl.Clone();
      var op = msg.GetProperty("op").GetString();
      object? result = op switch {
        "open" => Open(msg),
        "get" => Get(msg),
        "set" => Set(msg),
        "click" => Click(msg),
        "close" => Close(),
        _ => throw new InvalidOperationException("unknown op " + op),
      };
      Out.Line(new { id, ok = true, result });
      if (op == "close") Shutdown();
    } catch (Exception e) {
      Out.Line(new { id, ok = false, error = e.Message });
    }
  }

  object? Open(JsonElement m) {
    if (_window != null) throw new InvalidOperationException("window already open");
    var xaml = m.GetProperty("xaml").GetString()!;
    var root = (FrameworkElement)XamlReader.Load(xaml);
    var w = new Window { Content = root };
    if (m.TryGetProperty("title", out var t) && t.ValueKind == JsonValueKind.String) w.Title = t.GetString();
    int width = m.TryGetProperty("width", out var wi) && wi.ValueKind == JsonValueKind.Number ? wi.GetInt32() : 0;
    int height = m.TryGetProperty("height", out var he) && he.ValueKind == JsonValueKind.Number ? he.GetInt32() : 0;
    if (width > 0 && height > 0) w.AppWindow.Resize(new Windows.Graphics.SizeInt32(width, height));
    w.Closed += (_, _) => Out.Line(new { @event = "closed" });
    _window = w;
    _root = root;
    HookButtons(root);
    bool headless = m.TryGetProperty("headless", out var h) && h.ValueKind == JsonValueKind.True;
    if (!headless) w.Activate();
    return new { headless };
  }

  void HookButtons(object? node) {
    switch (node) {
      case ButtonBase b:
        var name = b.Name;
        b.Click += (_, _) => Out.Line(new { @event = "click", name });
        HookButtons(b.Content);
        break;
      case Panel p:
        foreach (var c in p.Children) HookButtons(c);
        break;
      case ContentControl cc:
        HookButtons(cc.Content);
        break;
      case Border bo:
        HookButtons(bo.Child);
        break;
    }
  }

  FrameworkElement Find(JsonElement m) {
    var name = m.GetProperty("name").GetString()!;
    if (_root == null) throw new InvalidOperationException("no window open");
    if (_root.Name == name) return _root;
    return _root.FindName(name) as FrameworkElement
      ?? throw new InvalidOperationException("element not found: " + name);
  }

  static System.Reflection.PropertyInfo Prop(object o, string name) =>
    o.GetType().GetProperty(name) ?? throw new InvalidOperationException($"no property {name} on {o.GetType().Name}");

  object? Get(JsonElement m) {
    var el = Find(m);
    var v = Prop(el, m.GetProperty("property").GetString()!).GetValue(el);
    return v switch {
      null => null,
      string or bool or int or long or double or float => v,
      Enum e => e.ToString(),
      _ => v.ToString(),
    };
  }

  object? Set(JsonElement m) {
    var el = Find(m);
    var p = Prop(el, m.GetProperty("property").GetString()!);
    var val = m.GetProperty("value");
    var t = p.PropertyType;
    object? conv = t == typeof(string) ? (val.ValueKind == JsonValueKind.String ? val.GetString() : val.GetRawText())
      : t == typeof(bool) ? val.GetBoolean()
      : t == typeof(double) ? val.GetDouble()
      : t == typeof(int) ? val.GetInt32()
      : t == typeof(object) ? (val.ValueKind == JsonValueKind.String ? val.GetString() : val.GetRawText())
      : t.IsEnum ? Enum.Parse(t, val.GetString()!, true)
      : throw new InvalidOperationException("unsupported property type " + t.Name);
    p.SetValue(el, conv);
    return null;
  }

  object? Click(JsonElement m) {
    var el = Find(m);
    var peer = FrameworkElementAutomationPeer.CreatePeerForElement(el);
    if (peer?.GetPattern(PatternInterface.Invoke) is IInvokeProvider inv) inv.Invoke();
    else throw new InvalidOperationException("element is not invokable");
    return null;
  }

  object? Close() => null;
}
