import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTRIBUTES, pickFormatCommits, renderCodeowners, upsertBlock } from "../src/git-generate.ts";
import { applyConfig, applyProfile, conePaths, git, selectSubmodules, type ProfileFile } from "../src/git-scale.ts";

const file: ProfileFile = {
  alwaysPaths: ["scripts"],
  optionalSubmodules: ["vendor/llvm"],
  profiles: {
    a: { description: "", paths: ["crates"], submodules: ["vendor/x", "vendor/missing"] },
    k: { description: "", paths: ["vendor"], submodules: ["vendor/*"], includeOptional: true },
    d: { description: "", paths: ["vendor"], submodules: ["vendor/*"] },
  },
};
const links = ["vendor/llvm", "vendor/x", "apps/y"];

test("submodule selection is explicit, reports unmatched patterns and holds optional ones back", () => {
  expect(selectSubmodules(file, file.profiles.a!, links)).toEqual({
    submodules: ["vendor/x"],
    unmatched: ["vendor/missing"],
  });
  expect(selectSubmodules(file, file.profiles.k!, links).submodules).toEqual(["vendor/llvm", "vendor/x"]);
  expect(selectSubmodules(file, file.profiles.d!, links).submodules).toEqual(["vendor/x"]);
  expect(conePaths(file, file.profiles.a!)).toEqual(["crates", "scripts"]);
});

test("format commits need a formatting subject and enough files", () => {
  const sha = (c: string) => c.repeat(40);
  const log = [
    `${sha("a")}\tstyle: rustfmt crates`,
    " 900 files changed, 1 insertion(+)",
    `${sha("b")}\tfeat: add thing`,
    " 900 files changed",
    `${sha("c")}\tformat tiny`,
    " 3 files changed",
  ].join("\n");
  expect(pickFormatCommits(log, 200).map(c => c.sha)).toEqual([sha("a")]);
});

test("managed block is replaced in place and idempotent", () => {
  const once = upsertBlock("* text=auto\n", ATTRIBUTES);
  expect(upsertBlock(once, ATTRIBUTES)).toBe(once);
  expect(upsertBlock(once, ["x"])).toContain("x");
  expect(upsertBlock(once, ["x"]).match(/>>> bunrepo/g)!.length).toBe(1);
});

test("codeowners skips submodule paths and templated paths", () => {
  const text = renderCodeowners(
    { components: [{ id: "a", path: "crates/a, vendor/sub/inner, $X/y" }] },
    ["crates"],
    ["vendor/sub"],
    "@o",
  );
  expect(text).toContain("/crates/a/");
  expect(text).not.toContain("vendor/sub");
  expect(text).not.toContain("$X");
});

test("config and profile application are idempotent on a real repository", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunrepo-"));
  try {
    await git(dir, ["init", "-q", "-b", "main"]);
    await git(dir, ["config", "user.email", "t@example.com"]);
    await git(dir, ["config", "user.name", "t"]);
    for (const d of ["crates/a", "web/b"]) {
      mkdirSync(join(dir, d), { recursive: true });
      writeFileSync(join(dir, d, "f.txt"), d);
    }
    writeFileSync(join(dir, "top.txt"), "t");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-qm", "init"]);
    expect((await applyConfig(dir)).length).toBeGreaterThan(5);
    expect(await applyConfig(dir)).toEqual([]);
    expect((await git(dir, ["config", "--local", "--get", "submodule.recurse"])).out.trim()).toBe("false");
    const plan = await applyProfile(dir, "rust-workspace", { submodules: false });
    expect(plan.sparse).toBe(true);
    expect((await git(dir, ["sparse-checkout", "list"])).out).toContain("crates");
    expect(await Bun.file(join(dir, "web/b/f.txt")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "crates/a/f.txt")).exists()).toBe(true);
    await applyProfile(dir, "all", { submodules: false });
    expect(await Bun.file(join(dir, "web/b/f.txt")).exists()).toBe(true);
  } finally {
    await git(dir, ["fsmonitor--daemon", "stop"]);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

test("diff classification selects only the touched areas", async () => {
  const { classify } = await import("../src/git-affected.ts");
  expect(classify(["docs/a.mdx"])).toEqual({ all: false, js: false, rust: false, docs: true, distro: false });
  expect(classify(["crates/x/src/lib.rs"])).toMatchObject({ rust: true, js: false });
  expect(classify([".github/workflows/ci.yml"])).toMatchObject({ all: true, js: true, rust: true });
  expect(classify(["packages/a/src/i.ts"])).toMatchObject({ js: true, rust: false });
});

test("untracked cache is off on Windows (Scalar scalar.c) and on elsewhere", async () => {
  const { applicable } = await import("../src/git-scale.ts");
  const v = (p: NodeJS.Platform) => applicable(p).find(s => s.key === "core.untrackedCache")!.value;
  expect(v("win32")).toBe("false");
  expect(v("linux")).toBe("true");
  expect(applicable("linux").some(s => s.key === "core.multiPackIndex")).toBe(false);
});
