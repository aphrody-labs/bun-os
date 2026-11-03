// SPDX-License-Identifier: Apache-2.0

/** A frame counter or an internal framebuffer cannot establish browser presentation. */
export function presentationProblems(id: string, screenshotLit: boolean, renderer: unknown, gpu2d: unknown): string[] {
  const problems: string[] = [];
  if (!screenshotLit) problems.push("the canvas stayed black");
  if (id === "dust-nds" && !(renderer === "wgpu30-dust" && typeof gpu2d === "number" && gpu2d > 0))
    problems.push("no Dust GPU 2D submission was observed");
  return problems;
}
