#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Audit and safely normalize host temporary paths in TS sources. */
import { Glob } from "bun";
import { Project, SyntaxKind } from "ts-morph";
import { relative, resolve } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";

export async function runPathAudit(args: string[]): Promise<number> {
  if (args.includes("--repository"))
    return (await import("./host-paths.ts")).runHostPaths(args.filter(arg => arg !== "--repository"));
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: yolo ops path-audit [--root path] [--apply]\n       yolo ops path-audit --repository --help");
    return 0;
  }
  const rootIndex = args.indexOf("--root");
  if (rootIndex >= 0 && !args[rootIndex + 1]) throw new Error("--root requires a path");
  const root = rootIndex >= 0 ? resolve(args[rootIndex + 1]!) : findWorkspaceRoot();
  const apply = args.includes("--apply");
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });
  const glob = new Glob("**/*.{ts,tsx,mts,cts}");
  const ignored = new Set(["node_modules", ".git", "target", "dist", ".next"]);
  const findings: {
    file: string;
    line: number;
    value: string;
    safe: boolean;
  }[] = [];

  for await (const path of glob.scan({
    cwd: root,
    onlyFiles: true,
    dot: true,
  })) {
    if (path.split(/[\\/]/).some(part => ignored.has(part))) continue;
    const absolute = resolve(root, path);
    const sourceText = await Bun.file(absolute).text();
    if (!/(?:^|["'`])(?:\/tmp\/|\/home\/[^/]+\/|\/Users\/[^/]+\/|[A-Za-z]:[\\/]Users[\\/])/m.test(sourceText)) continue;
    const source = project.createSourceFile(absolute, sourceText, {
      overwrite: true,
    });
    let changed = false;
    const nodes = [
      ...source.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...source.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ];
    for (const node of nodes) {
      const value = node.getLiteralValue();
      if (absolute === resolve(root, "packages/bun-workspace/src/automation/path-audit.ts")) continue;
      const isTemp = value.startsWith("/tmp/");
      const isUserPath = /^\/home\/[^/]+\/|^\/Users\/[^/]+\/|^[A-Za-z]:[\\/]Users[\\/]/.test(value);
      if (!isTemp && !isUserPath) continue;
      const line = node.getStartLineNumber();
      const code = node.getParent()?.getKind() !== SyntaxKind.JsxAttribute;
      findings.push({
        file: relative(root, absolute),
        line,
        value,
        safe: isTemp && code,
      });
      if (!apply || !code || !isTemp) continue;
      const normalized = value.slice("/tmp/".length).split("/").filter(Boolean);
      node.replaceWithText(`tempPath(${normalized.map(part => JSON.stringify(part)).join(", ")})`);
      changed = true;
    }
    if (changed) {
      const hasImport = source
        .getImportDeclarations()
        .some(item => item.getModuleSpecifierValue() === "@aphrody/paths");
      if (hasImport) {
        const existing = source
          .getImportDeclarations()
          .find(item => item.getModuleSpecifierValue() === "@aphrody/paths")!;
        if (!existing.getNamedImports().some(item => item.getName() === "tempPath"))
          existing.addNamedImport("tempPath");
      } else {
        const text = source.getFullText();
        const shebang = text.startsWith("#!") ? text.indexOf("\n") + 1 : 0;
        const offset = shebang > 0 ? shebang : 0;
        source.insertText(offset, 'import { tempPath } from "@aphrody/paths";\n');
      }
      await Bun.write(absolute, source.getFullText());
    }
  }

  for (const item of findings) {
    console.log(`${item.safe ? (apply ? "FIXED" : "SAFE") : "REVIEW"} ${item.file}:${item.line} ${item.value}`);
  }
  console.log(
    `${apply ? "Normalized" : "Found"} ${findings.filter(item => item.safe).length} safe temporary paths; ${findings.filter(item => !item.safe).length} user-specific or context-bound paths require review.`,
  );

  return 0;
}
