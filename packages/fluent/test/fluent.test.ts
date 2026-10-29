import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("tokens are generated from @fluentui/react-theme: Fluent 2 brand colours, light and dark", () => {
  const t = JSON.parse(readFileSync(join(root, "tokens", "fluent2.json"), "utf8"));
  expect(t.source["@fluentui/react-theme"]).toBe("9.2.2");
  expect(Object.keys(t.light).length).toBeGreaterThan(400);
  expect(t.light.colorBrandBackground).toBe("#0f6cbd"); // Fluent 2 web light brand (Communication blue 80)
  expect(t.dark.colorBrandBackground).not.toBe(t.light.colorBrandBackground);
  const css = readFileSync(join(root, "tokens", "fluent2.css"), "utf8");
  expect(css).toContain("--colorBrandBackground: #0f6cbd;");
  expect(css).toContain("prefers-color-scheme: dark");
  const xaml = readFileSync(join(root, "app", "FluentTokens.xaml"), "utf8");
  expect(xaml).toContain('x:Key="Fluent2.colorBrandBackground" Color="#0f6cbd"');
});

const exe = join(root, "app", "bin", "x64", "Release", "net10.0-windows10.0.26100.0", "win-x64", "FluentApp.exe");
test.skipIf(process.platform !== "win32" || !existsSync(exe))(
  "WinUI 3 app launched from Bun: real window captured with PrintWindow, controls found with UI Automation",
  async () => {
    const png = join(root, "test", "capture.png");
    const json = join(root, "test", "uia.json");
    const p = Bun.spawn(
      ["pwsh", "-NoProfile", "-File", join(root, "capture.ps1"), "-Exe", exe, "-Png", png, "-Json", json],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await p.exited).toBe(0);
    const r = JSON.parse(readFileSync(json, "utf8"));
    expect(r.printWindow).toBe(true);
    expect(r.controls.AppTitleBar).toBe("ControlType.TitleBar");
    expect(r.controls.InfoBar).toBe("ControlType.StatusBar");
    expect(r.controls.DialogButton).toBe("ControlType.Button");
    expect(r.controls.NavHome).toBe("ControlType.ListItem");
    expect(r.controls.ContentDialogText).toBe("found");
    const bytes = readFileSync(png);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 13, 10, 0x1a, 10]);
    expect(bytes.length).toBeGreaterThan(5_000);
  },
  120_000,
);
