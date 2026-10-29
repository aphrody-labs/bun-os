import { expect, test } from "bun:test";
import {
  affectedCrates,
  aotBlockers,
  graphFromMetadata,
  jobLimit,
  layerCrates,
  withDependents,
  type CrateNode,
} from "../src/plan.ts";
import { cargoArgs } from "../src/tasks.ts";

const graph: CrateNode[] = [
  { name: "app", dir: "apps/app", deps: ["core", "net"] },
  { name: "core", dir: "crates/core", deps: ["sys"] },
  { name: "net", dir: "crates/net", deps: ["sys"] },
  { name: "sys", dir: "crates/sys", deps: [] },
  { name: "lone", dir: "crates/lone", deps: [] },
];

test("layers put dependencies first and group independent crates", () => {
  const { layers, cycle } = layerCrates(graph);
  expect(cycle).toEqual([]);
  expect(layers).toEqual([["lone", "sys"], ["core", "net"], ["app"]]);
});

test("a selection treats outside dependencies as built", () => {
  expect(layerCrates(graph, ["app", "net"]).layers).toEqual([["net"], ["app"]]);
});

test("cycles are reported, not looped on", () => {
  const cyclic: CrateNode[] = [
    { name: "a", dir: "a", deps: ["b"] },
    { name: "b", dir: "b", deps: ["a"] },
    { name: "c", dir: "c", deps: [] },
  ];
  const result = layerCrates(cyclic);
  expect(result.layers).toEqual([["c"]]);
  expect(result.cycle).toEqual(["a", "b"]);
});

test("reverse dependents are included transitively", () => {
  expect([...withDependents(graph, ["sys"])].sort()).toEqual(["app", "core", "net", "sys"]);
});

test("affected crates come from changed paths, longest directory wins", () => {
  expect(affectedCrates(graph, ["crates/core/src/lib.rs"])).toMatchObject({ all: false, crates: ["app", "core"] });
  expect(affectedCrates(graph, ["README.md"]).crates).toEqual([]);
  expect(affectedCrates(graph, [])).toMatchObject({ all: false, crates: [] });
});

test("lockfile or toolchain changes affect everything", () => {
  expect(affectedCrates(graph, ["Cargo.lock"])).toMatchObject({ all: true });
  expect(affectedCrates(graph, ["rust-toolchain.toml"]).all).toBe(true);
});

test("the graph ignores dev-dependencies, self and outside crates", () => {
  const nodes = graphFromMetadata({
    workspace_root: "/w",
    workspace_members: ["a", "b"],
    packages: [
      {
        id: "a",
        name: "a",
        manifest_path: "/w/crates/a/Cargo.toml",
        dependencies: [
          { name: "b", kind: null },
          { name: "serde", kind: null },
        ],
      },
      {
        id: "b",
        name: "b",
        manifest_path: "/w/crates/b/Cargo.toml",
        dependencies: [
          { name: "a", kind: "dev" },
          { name: "b", kind: null },
        ],
      },
      { id: "z", name: "z", manifest_path: "/w/crates/z/Cargo.toml", dependencies: [] },
    ],
  });
  expect(nodes).toEqual([
    { name: "a", dir: "crates/a", deps: ["b"] },
    { name: "b", dir: "crates/b", deps: [] },
  ]);
});

test("jobs are bounded by cores and by free memory", () => {
  const gib = 1024 ** 3;
  expect(jobLimit(24, 100 * gib)).toBe(24);
  expect(jobLimit(24, 13 * gib)).toBe(6);
  expect(jobLimit(24, 0.5 * gib)).toBe(1);
  expect(jobLimit(24, 100 * gib, 2 * gib, 4)).toBe(4);
  expect(jobLimit(2, 100 * gib, 2 * gib, 8)).toBe(2);
});

test("cargo argument lists per task", () => {
  const base = { cores: 8, freeBytes: 64 * 1024 ** 3 };
  expect(cargoArgs("check", { ...base, packages: [] })).toEqual(["check", "--locked", "--workspace", "-j", "8"]);
  expect(cargoArgs("clippy", { ...base, packages: ["a", "b"], jobs: 2 })).toEqual([
    "clippy",
    "--locked",
    "-p",
    "a",
    "-p",
    "b",
    "--all-targets",
    "-j",
    "2",
  ]);
  expect(cargoArgs("build", { ...base, packages: ["a"], release: true, extra: ["--features", "x"] })).toEqual([
    "build",
    "--locked",
    "-p",
    "a",
    "--release",
    "-j",
    "8",
    "--",
    "--features",
    "x",
  ]);
  expect(cargoArgs("fmt", { ...base, packages: [] })).toEqual(["fmt", "--all", "--", "--check"]);
});

test("components with aot:false or an AOT-ignored hook are blockers", () => {
  const map = new Map([
    ["a", { id: "a", kind: "npm-package", path: "a", aot: true, registration: ["bun-ffi"] }],
    ["b", { id: "b", kind: "npm-package", path: "b", aot: false, registration: ["bun-plugin"] }],
    ["c", { id: "c", kind: "npm-package", path: "c", registration: ["bunfig-preload"] }],
  ]);
  expect(aotBlockers(map).map(entry => entry.id)).toEqual(["b", "c"]);
});
