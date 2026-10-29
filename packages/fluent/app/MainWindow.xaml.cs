using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace BunOs.Fluent;
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        Title = "Bun OS Fluent";
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1000, 640));
        Nav.SelectedItem = Nav.MenuItems[0];
    }
    private void OnNavChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs e)
    {
        if (e.SelectedItem is NavigationViewItem item) PageTitle.Text = item.Content?.ToString() ?? "";
        else if (e.IsSettingsSelected) PageTitle.Text = "Settings";
    }
    private async void OnOpenDialog(object sender, RoutedEventArgs e)
    {
        var dialog = new ContentDialog { Title = "Bun OS", Content = "ContentDialog from WinUI 3", CloseButtonText = "Close", XamlRoot = Content.XamlRoot };
        dialog.Name = "Dialog";
        await dialog.ShowAsync();
    }
}
