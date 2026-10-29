#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Turns a JSON-lines results file (one object per measurement, from bench.ts and the install receipts) into a Markdown table.
//   bun factory/dotnet-linux/summary.ts results.jsonl "title"
import { readFileSync } from "node:fs";

const [file, title = "dotnet-linux"] = Bun.argv.slice(2);
const rows = readFileSync(file!, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const mib = (n?: number) => (n === undefined ? "" : (n / 1048576).toFixed(1));
const out = [`### ${title}`, "", "| name | size MiB | start median ms (min-max) | peak RSS MiB | note |", "|---|---:|---:|---:|---|"];
for (const r of rows) {
  const wall = r.wallMs ? `${r.wallMs.median} (${r.wallMs.min}-${r.wallMs.max})` : "";
  out.push(`| ${r.name} | ${mib(r.bytes)} | ${wall} | ${r.maxRssMiB ?? ""} | ${(r.note ?? r.stdout ?? "").toString().replace(/\|/g, "/").slice(0, 120)} |`);
}
console.log(out.join("\n"));
