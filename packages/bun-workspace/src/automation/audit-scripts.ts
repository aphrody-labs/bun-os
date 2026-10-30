/** Shared source-script policy audit for first-party workspaces. */
import { Glob } from "bun";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
export async function runScriptAudit(repo: string, workspaceRoot?: string): Promise<void> {
  if (!/^[a-z0-9-]+$/u.test(repo)) throw new Error("invalid repository name");
  const root = workspaceRoot ? resolve(workspaceRoot) : resolve(import.meta.dir, "..", "..", "..", "..", repo);
  const roots = ["scripts", "apps/bot/scripts", "apps/site/scripts", "packages/pipeline/scripts"].filter(path =>
    existsSync(join(root, path)),
  );
  const violations: string[] = [];
  for (const dir of roots)
    for await (const file of new Glob("**/*.{ts,tsx,js,mjs,cjs,sh}").scan({
      cwd: join(root, dir),
      absolute: true,
    })) {
      const text = await Bun.file(file).text();
      const label = relative(root, file).split(sep).join("/");
      if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"'@]+@/i.test(text))
        violations.push(`${label}: hard-coded PostgreSQL credential`);
      if (label.startsWith("scripts/ops/") && /\/home\/ubuntu|C:\/Users\/aphro/u.test(text))
        violations.push(`${label}: machine-specific absolute path`);
      if (/DELETE\s+FROM\s+bot\.db_(wishes|timeline_events|power_levels)\b/i.test(text))
        violations.push(`${label}: physical deletion of editorial data`);
    }
  if (violations.length) throw new Error(violations.join("\n"));
  console.log(`script audit passed: ${repo}`);
}
