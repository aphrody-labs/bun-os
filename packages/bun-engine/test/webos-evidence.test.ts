import { expect, test } from "bun:test";
import { presentationProblems } from "../web-emulation/webos-evidence";

test("WebOS qualification requires visible output and actual Dust GPU submissions", () => {
  expect(presentationProblems("dust-nds", false, "wgpu30-dust", 120)).toContain("the canvas stayed black");
  expect(presentationProblems("dust-nds", true, "software", 0)).toContain("no Dust GPU 2D submission was observed");
  expect(presentationProblems("dust-nds", true, "wgpu30-dust", 120)).toEqual([]);
  expect(presentationProblems("melonds", true, "software", 0)).toEqual([]);
});
