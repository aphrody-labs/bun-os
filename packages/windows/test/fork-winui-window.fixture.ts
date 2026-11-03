// SPDX-License-Identifier: MIT
// Ported from aphrody-labs/bun test/js/bun/winui/winui-window.fixture.ts.
// Opens a real WinUI 3 window through bun:winui, checks its XAML tree, properties and events, then closes
// itself: bun winui-window.fixture.ts.
import winui from "../src/fork/winui";

const app = winui.start({
  resources: `<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
    <SolidColorBrush x:Key="BunFixtureBrush" Color="#FF0F6CBD"/>
  </ResourceDictionary>`,
});
const win = app.createWindow({
  title: "bun:winui fixture",
  width: 640,
  height: 480,
  content: `<StackPanel x:Name="root" Padding="16" Spacing="8">
    <TextBlock x:Name="label" Text="Bonjour"/>
    <TextBox x:Name="input" Text="abc"/>
    <PasswordBox x:Name="password" Password="secret"/>
    <RichEditBox x:Name="rich"/>
    <AutoSuggestBox x:Name="search" PlaceholderText="Rechercher"/>
    <ComboBox x:Name="combo" SelectedIndex="1">
      <x:String>Un</x:String>
      <x:String>Deux</x:String>
    </ComboBox>
    <CalendarDatePicker x:Name="date"/>
    <CommandBar x:Name="commands">
      <AppBarButton x:Name="save" Label="Enregistrer"/>
    </CommandBar>
    <Button x:Name="ok" Content="OK">
      <Button.Flyout>
        <MenuFlyout x:Name="menu">
          <MenuFlyoutItem Text="Ouvrir"/>
        </MenuFlyout>
      </Button.Flyout>
    </Button>
    <Pivot x:Name="pivot">
      <PivotItem Header="A"/>
    </Pivot>
    <CalendarView x:Name="calendar"/>
  </StackPanel>`,
});

const events: string[] = [];
const ok = win.find("ok")!;
ok.on("Click", sender => events.push(`Click ${sender?.type}`));
const input = win.find("input")!;
input.on("TextChanged", () => events.push(`TextChanged ${input.get("Text")}`));
win.find("label")!.set("Text", "Au revoir");
const added = win.content!.append(`<ToggleSwitch x:Name="toggle" IsOn="True"/>`);

// XAML loads the tree on the next frames; TextChanged is raised asynchronously once the box is loaded.
const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 10_000;
  while (!condition() && Date.now() < deadline) await Bun.sleep(10);
};
await until(() => win.content!.get("IsLoaded"));
input.set("Text", "modifié");
ok.invoke();
await until(() => events.length >= 2);

console.log(
  JSON.stringify(
    {
      runtime: app.runtime.version !== "",
      hwnd: win.hwnd !== 0,
      title: win.title,
      loaded: win.content!.get("IsLoaded"),
      tree: win.content!.tree(),
      label: win.find("label")!.get("Text"),
      password: win.find("password")!.get("Password"),
      combo: win.find("combo")!.get("SelectedItem"),
      toggle: added.get("IsOn"),
      menu: win.find("menu")?.type ?? null,
      events: events.sort(),
      resources: app.application.get("Resources").get("MergedDictionaries").get("Size"),
    },
    null,
    2,
  ),
);

setTimeout(() => win.close(), 50);
await win.closed;
await app.exited;
console.log("closed", win.isClosed, app.closed);
