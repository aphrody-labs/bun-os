// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { WinUIError, WinUIHost, isHostBuilt, probe } from "../src/winui";

const info = await probe();
const run = process.platform === "win32" && info.ok && isHostBuilt();

describe("winui probe", () => {
  test("probe reports installed runtime packages", async () => {
    const r = await probe();
    expect(Array.isArray(r.packages)).toBe(true);
    expect(typeof r.ok).toBe("boolean");
    if (process.platform === "win32") expect(r.ok ? r.reason === undefined : typeof r.reason === "string").toBe(true);
  });

  test("start without a built host throws ERR_WINUI_HOST_NOT_BUILT", async () => {
    const err = await WinUIHost.start({ dir: "C:\\nonexistent\\winui-host" }).catch(e => e);
    expect(err).toBeInstanceOf(WinUIError);
    expect(err.code).toBe("ERR_WINUI_HOST_NOT_BUILT");
  });
});

const xaml = `<StackPanel xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Spacing="8" Padding="16">
  <TextBlock x:Name="label" Text="before"/>
  <Button x:Name="btn" Content="Go"/>
</StackPanel>`;

describe.skipIf(!run)("winui window smoke", () => {
  test("open, click, read back, close", async () => {
    await using host = await WinUIHost.start();
    await host.open({ title: "bun smoke", xaml, width: 400, height: 300, headless: true });
    expect(await host.get("label", "Text")).toBe("before");

    // Handler lives in Bun: the host emits a click event, Bun reacts with set().
    const off = host.onEvent(e => {
      if (e.event === "click" && e.name === "btn") void host.set("label", "Text", "after");
    });
    const clicked = host.waitEvent(e => e.event === "click" && e.name === "btn");
    await host.click("btn");
    await clicked;
    for (let i = 0; i < 50 && (await host.get("label", "Text")) !== "after"; i++) await Bun.sleep(20);
    off();
    expect(await host.get("label", "Text")).toBe("after");
    await host.close();
  }, 60_000);
});
