using System;
using System.IO;
using Microsoft.UI.Xaml;
namespace BunOs.Fluent;
public partial class App : Application
{
    private Window? _window;
    public App()
    {
        InitializeComponent();
        UnhandledException += (s, e) => File.WriteAllText(Path.Combine(Path.GetTempPath(), "fluentapp-crash.txt"), e.Exception + Environment.NewLine + e.Message);
    }
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
