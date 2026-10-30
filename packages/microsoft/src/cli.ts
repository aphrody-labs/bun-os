#!/usr/bin/env bun
// bun packages/microsoft/src/cli.ts probe              Windows 11 feature probes, Office/COM registration, Start apps count (JSON)
// bun packages/microsoft/src/cli.ts matrix <exe...>    Wine (pinned) import coverage of each PE file (JSON)
import { listStartApps } from "./apps.ts";
import { isRegistered, officeProgIds } from "./com.ts";
import { analyze, fetchSpecs, WINE_TAG } from "./matrix.ts";
import { notBuilt, probeWindows11 } from "./win11.ts";

const [cmd, ...rest] = Bun.argv.slice(2);
if (cmd === "probe") {
  const office = Object.fromEntries(
    await Promise.all(officeProgIds.map(async id => [id, await isRegistered(id)] as const)),
  );
  const apps = await listStartApps();
  console.log(
    JSON.stringify(
      {
        os: process.platform,
        office,
        startApps: { total: apps.length, packaged: apps.filter(a => a.packaged).length },
        windows11: await probeWindows11(),
        notBuilt,
      },
      null,
      2,
    ),
  );
} else if (cmd === "matrix" && rest.length) {
  const specs = await fetchSpecs();
  const rows = [];
  for (const f of rest) rows.push(await analyze(f, specs));
  console.log(JSON.stringify({ wine: WINE_TAG, specDlls: specs.size, rows }, null, 2));
} else {
  console.error("usage: cli.ts probe | matrix <exe...>");
  process.exit(2);
}
