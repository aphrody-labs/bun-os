// SPDX-License-Identifier: Apache-2.0
// The M3 additions to the @aphrody/next-bun codemods (the former Bun fork, packages/bun-next/codemods), whose own tests
// live in the fork (test/integration/next-bun/codemods.test.ts): MUI -> M3 and the M3 preset header.
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEMOD_GROUPS,
  CODEMODS,
  M3_TAILWIND_HEADER,
  muiToM3,
  runCodemods,
  selectCodemods,
  tailwindConfigToCss,
} from "../src/codemods";
import { CODEMOD_HELP, runCodemodCli } from "../src/codemods/cli";

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "m3-codemods-"));
  await mkdir(join(dir, "app"), { recursive: true });
  await writeFile(
    join(dir, "app/page.tsx"),
    `import { Button } from "@mui/material";
export default function Page() {
  return <Button variant="contained">Go</Button>;
}
`,
  );
  await writeFile(
    join(dir, "tailwind.config.js"),
    `module.exports = { theme: { extend: { colors: { brand: "#6750a4" } } } };\n`,
  );
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }));
  return dir;
}

describe("mui-to-m3", () => {
  test("Button, Switch, Checkbox and Divider become Base UI wrappers with mapped props", () => {
    const src = `import { Button, Switch, Checkbox, Divider, TextField } from "@mui/material";

export function Form() {
  return (
    <div>
      <Button variant="contained" color="primary" size="small" fullWidth onClick={go}>Save</Button>
      <Button variant="outlined">Cancel</Button>
      <Button>Plain</Button>
      <Switch checked={on} onChange={(e, v) => setOn(v)} />
      <Checkbox defaultChecked />
      <Divider flexItem orientation="vertical" />
      <TextField label="Name" />
    </div>
  );
}
`;
    const out = muiToM3(src);
    expect(out.code).toContain('import { M3Button, M3Checkbox, M3Separator, M3Switch } from "@aphrody/m3-baseui";');
    expect(out.code).toContain('import { TextField } from "@mui/material";');
    expect(out.code).toContain('<M3Button variant="filled" size="xs" className="w-full" onClick={go}>Save</M3Button>');
    expect(out.code).toContain('<M3Button variant="outlined">Cancel</M3Button>');
    expect(out.code).toContain('<M3Button variant="text">Plain</M3Button>');
    expect(out.code).toContain("onCheckedChange={(e, v) => setOn(v)}");
    expect(out.code).toContain('<M3Separator orientation="vertical" />');
    expect(out.warnings.some(w => w.includes("`color`"))).toBe(true);
    expect(out.warnings.some(w => w.includes("onCheckedChange(checked, eventDetails)"))).toBe(true);
    expect(out.warnings.some(w => w.includes("TextField"))).toBe(true);
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(out.code)).not.toThrow();
  });

  test("Typography, Stack, Box and Paper become elements with M3 classes", () => {
    const src = `import { Typography, Stack, Box, Paper } from "@mui/material";
export const A = () => (
  <Stack direction="row" spacing={2}>
    <Typography variant="h4" gutterBottom>Title</Typography>
    <Typography variant="body2" className="x">Text</Typography>
    <Paper elevation={2}><Box sx={{ p: 2 }}>in</Box></Paper>
  </Stack>
);
`;
    const out = muiToM3(src);
    expect(out.code).not.toContain("@mui");
    expect(out.code).toContain('<div className="flex flex-row gap-4">');
    expect(out.code).toContain('<h4 className="text-headline-large">Title</h4>');
    expect(out.code).toContain('<p className="text-body-medium x">Text</p>');
    expect(out.code).toContain(
      '<div className="rounded-medium bg-surface-container text-on-surface shadow-elevation-1">',
    );
    expect(out.code).toContain("<div>in</div>");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(out.code)).not.toThrow();
  });

  test("deep imports and aliases", () => {
    const src = `import MuiButton from "@mui/material/Button";\nimport { Typography as T } from "@mui/material";\nexport const x = <><MuiButton variant="contained">a</MuiButton><T variant="caption">c</T></>;\n`;
    const out = muiToM3(src);
    expect(out.code).toContain('import { M3Button } from "@aphrody/m3-baseui";');
    expect(out.code).toContain('<M3Button variant="filled">a</M3Button>');
    expect(out.code).toContain('<span className="text-body-small">c</span>');
  });

  test("icons, theme and styled are reported", () => {
    const out = muiToM3(
      `import { ThemeProvider, createTheme, styled } from "@mui/material/styles";\nimport { Button } from "@mui/material";\nimport Add from "@mui/icons-material/Add";\nconst S = styled(Button)({});`,
    );
    expect(out.warnings.some(w => w.includes("m3-icons"))).toBe(true);
    expect(out.warnings.some(w => w.includes("M3Root"))).toBe(true);
    expect(out.warnings.some(w => w.includes("styled()"))).toBe(true);
  });

  test("a file without MUI is untouched", () => {
    const src = `export const a = 1;\n`;
    expect(muiToM3(src)).toEqual({ code: src, changes: [], warnings: [] });
  });
});

describe("composition with @aphrody/next-bun", () => {
  test("next16, mui and tailwind4 codemods, unique ids", () => {
    expect(CODEMOD_GROUPS).toEqual(["next16", "mui", "tailwind4"]);
    expect(new Set(CODEMODS.map(c => c.id)).size).toBe(CODEMODS.length);
    expect([...new Set(CODEMODS.map(c => c.group))]).toEqual(["next16", "mui", "tailwind4"]);
    expect(selectCodemods(["mui"]).map(c => c.id)).toEqual(["mui-to-m3"]);
    expect(selectCodemods(["all"])).toHaveLength(CODEMODS.length);
    expect(() => selectCodemods(["nope"])).toThrow("unknown codemod");
  });

  test("the converted tailwind.config points at the M3 preset", () => {
    const run = CODEMODS.find(c => c.id === "tailwind-config-v4")!.run;
    const out = run('module.exports = { theme: { extend: { colors: { accent: "#ff0" } } } };', "tailwind.config.js");
    expect(out.code.startsWith(M3_TAILWIND_HEADER.join("\n"))).toBe(true);
    expect(out.code).toContain("@aphrody/m3-tailwind/preset.css");
    expect(out.code).toContain("--color-accent: #ff0;");
    expect(tailwindConfigToCss("module.exports = {};", "tailwind.config.js").code).not.toContain("m3-tailwind");
  });

  test("runCodemods applies MUI and the M3 header over a project", async () => {
    const dir = await project();
    try {
      const reports = await runCodemods({
        dir,
        ids: ["mui", "tailwind-config-v4"],
        apply: true,
      });
      // oxlint-disable-next-line unicorn/no-array-sort -- copie fraîche : cible ES2022 du paquet (pas de toSorted)
      expect(reports.map(r => `${r.file}:${r.codemod}`).sort()).toEqual([
        "app/page.tsx:mui-to-m3",
        "tailwind.config.js:tailwind-config-v4",
      ]);
      expect(await readFile(join(dir, "app/page.tsx"), "utf8")).toContain('<M3Button variant="filled">Go</M3Button>');
      expect(await readFile(join(dir, "tailwind-theme.css"), "utf8")).toContain("@aphrody/m3-tailwind/preset.css");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the next-migrate codemod CLI lists the mui group", async () => {
    expect(CODEMOD_HELP).toContain("next-migrate codemod <ids|group|all>");
    expect(CODEMOD_HELP).toContain("Groups: next16, mui, tailwind4.");
    expect(CODEMOD_HELP).toContain("mui        MUI Button");
    const dir = await project();
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      expect(await runCodemodCli(["codemod", "--list"])).toBe(0);
      expect(lines.some(l => l.includes("mui-to-m3"))).toBe(true);
      lines.length = 0;
      expect(await runCodemodCli(["codemod", "mui", dir])).toBe(0);
      expect(lines.some(l => l.includes("app/page.tsx  [mui-to-m3]"))).toBe(true);
      expect(await runCodemodCli(["codemod", "nope", dir])).toBe(2);
      lines.length = 0;
      expect(await runCodemodCli(["pages-hints", dir, "--json"])).toBe(0);
      expect(JSON.parse(lines.join("\n"))).toEqual([]);
    } finally {
      console.log = log;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
