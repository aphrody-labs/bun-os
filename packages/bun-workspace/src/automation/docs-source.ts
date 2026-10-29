// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "@typescript/typescript6";

export interface SourceReferenceTarget {
  id: string;
  language: "typescript" | "rust" | "python";
  paths: string[];
}

function fence(text: string, language = ""): string {
  const length = Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1));
  const delimiter = "`".repeat(length);
  return `${delimiter}${language}\n${text.trimEnd()}\n${delimiter}`;
}

function typescriptReference(text: string, path: string): string {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true });
  const print = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, node, source);
  const signature = (node: ts.Node): string => {
    if (ts.isFunctionDeclaration(node))
      return print(
        ts.factory.updateFunctionDeclaration(
          node,
          node.modifiers,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          node.parameters,
          node.type,
          undefined,
        ),
      );
    if (ts.isMethodDeclaration(node))
      return print(
        ts.factory.updateMethodDeclaration(
          node,
          node.modifiers,
          node.asteriskToken,
          node.name,
          node.questionToken,
          node.typeParameters,
          node.parameters,
          node.type,
          undefined,
        ),
      );
    if (ts.isConstructorDeclaration(node))
      return print(ts.factory.updateConstructorDeclaration(node, node.modifiers, node.parameters, undefined));
    if (ts.isGetAccessorDeclaration(node))
      return print(
        ts.factory.updateGetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, node.type, undefined),
      );
    if (ts.isSetAccessorDeclaration(node))
      return print(
        ts.factory.updateSetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, undefined),
      );
    if (ts.isPropertyDeclaration(node))
      return print(
        ts.factory.updatePropertyDeclaration(
          node,
          node.modifiers,
          node.name,
          node.questionToken ?? node.exclamationToken,
          node.type,
          undefined,
        ),
      );
    if (ts.isVariableStatement(node)) {
      return print(
        ts.factory.updateVariableStatement(
          node,
          node.modifiers,
          ts.factory.updateVariableDeclarationList(
            node.declarationList,
            node.declarationList.declarations.map(declaration =>
              ts.factory.updateVariableDeclaration(
                declaration,
                declaration.name,
                declaration.exclamationToken,
                declaration.type,
                undefined,
              ),
            ),
          ),
        ),
      );
    }
    if (ts.isClassDeclaration(node)) {
      const header = node
        .getText(source)
        .slice(0, node.members.pos - node.getStart(source))
        .trimEnd();
      return `${header}\n${node.members.map(signature).join("\n")}\n}`;
    }
    return print(node);
  };
  const blocks: string[] = [];
  for (const node of source.statements) {
    const exported =
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node) ||
      (ts.canHaveModifiers(node) &&
        ts
          .getModifiers(node)
          ?.some(
            modifier => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword,
          ));
    if (!exported) continue;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const docs = ts
      .getJSDocCommentsAndTags(node)
      .filter(ts.isJSDoc)
      .map(doc => doc.getText(source));
    blocks.push(
      `### Source line ${line}\n\n${docs.length ? `${fence(docs.join("\n"), "typescript")}\n\n` : ""}${fence(signature(node), "typescript")}`,
    );
  }
  return blocks.join("\n\n") || "No explicit exports found.";
}

const PYTHON_AST = `import ast, json, sys
source = sys.stdin.read()
tree = ast.parse(source)
items = []
def visit(nodes, prefix=''):
    for node in nodes:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            name = prefix + node.name
            if isinstance(node, ast.ClassDef):
                signature = 'class ' + node.name + '(' + ', '.join(ast.unparse(x) for x in node.bases) + ')'
            else:
                signature = ('async ' if isinstance(node, ast.AsyncFunctionDef) else '') + 'def ' + node.name + '(' + ast.unparse(node.args) + ')'
                if node.returns is not None: signature += ' -> ' + ast.unparse(node.returns)
            items.append(dict(name=name, line=node.lineno, signature=signature, doc=ast.get_docstring(node, clean=False)))
            if isinstance(node, ast.ClassDef): visit(node.body, name + '.')
visit(tree.body)
print(json.dumps(dict(doc=ast.get_docstring(tree, clean=False), items=items)))
`;

function pythonCommand(): string[] {
  return [
    Bun.which("uv") ?? "uv", // the real uv; upstream Bun has no `bun uv`
    "run",
    "--no-project",
    "--offline",
    "--no-python-downloads",
    ...(process.env.PYTHON ? ["--python", process.env.PYTHON] : []),
    "python",
  ];
}

async function pythonReference(text: string): Promise<string> {
  const child = Bun.spawn([...pythonCommand(), "-I", "-c", PYTHON_AST], {
    windowsHide: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill(), 30_000);
  child.stdin.write(text);
  void child.stdin.end();
  const [stdout, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).finally(() => clearTimeout(deadline));
  if (code !== 0) throw new Error(`Python AST extraction failed: ${error.trim()}`);
  const parsed = JSON.parse(stdout) as {
    doc: string | null;
    items: Array<{
      name: string;
      line: number;
      signature: string;
      doc: string | null;
    }>;
  };
  return (
    [
      parsed.doc ? fence(parsed.doc) : "",
      ...parsed.items.map(
        item =>
          `### ${item.name} — source line ${item.line}\n\n${fence(item.signature, "python")}${item.doc ? `\n\n${fence(item.doc)}` : ""}`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n") || "No module docstring or definitions found."
  );
}

function rustReference(text: string): string {
  const lines = text.split("\n");
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/^\s*\/\/[/!]/.test(lines[index]!)) continue;
    const start = index;
    const excerpt: string[] = [];
    while (index < lines.length && /^\s*\/\/[/!]/.test(lines[index]!)) excerpt.push(lines[index++]!);
    blocks.push(
      `### Documentation excerpt — source lines ${start + 1}–${index}\n\n${fence(excerpt.join("\n"), "rust")}`,
    );
    index--;
  }
  return blocks.join("\n\n") || "No line documentation comments found.";
}

/** Extract source facts without importing project modules, compiling, or writing files. */
export async function generateSourceReference(
  root: string,
  targets: readonly SourceReferenceTarget[],
): Promise<Map<string, string>> {
  const base = await realpath(root);
  const outputs = new Map<string, string>();
  const ids = new Set<string>();
  for (const target of targets) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(target.id) || ids.has(target.id))
      throw new Error(`Invalid or duplicate source reference id: ${target.id}`);
    ids.add(target.id);
    if (!["typescript", "rust", "python"].includes(target.language) || !target.paths.length)
      throw new Error(`Invalid source reference target: ${target.id}`);
    // Validation and file reads are independent per path: run them concurrently, keep sorted order.
    // oxlint-disable-next-line no-await-in-loop -- targets are generated in declared order so the first failing target reports deterministically
    const sources = await Promise.all(
      [...new Set(target.paths)].toSorted().map(async path => {
        if (
          !path ||
          isAbsolute(path) ||
          path.includes("\\") ||
          path
            .split("/")
            .some(
              part =>
                !part ||
                part === "." ||
                part === ".." ||
                part === ".git" ||
                part === ".npmrc" ||
                part.startsWith(".env"),
            )
        )
          throw new Error(`Unsafe source reference path: ${path}`);
        const absolute = await realpath(resolve(base, path));
        const local = relative(base, absolute);
        if (local.split(sep)[0] === ".." || isAbsolute(local))
          throw new Error(`Source reference escapes repository: ${path}`);
        if (local.split(sep).some(part => part === ".git" || part === ".npmrc" || part.startsWith(".env")))
          throw new Error(`Unsafe resolved source reference path: ${path}`);
        const bytes = await readFile(absolute);
        return {
          path,
          text: bytes.toString("utf8"),
          hash: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
    );
    const sections: string[] = [];
    for (const { path, text, hash } of sources) {
      let facts: string;
      if (target.language === "typescript") facts = typescriptReference(text, path);
      else if (target.language === "python") {
        // oxlint-disable-next-line no-await-in-loop -- one Python interpreter per file, kept sequential to bound concurrent processes
        facts = await pythonReference(text);
      } else facts = rustReference(text);
      sections.push(`## Source: ${path}\n\nSHA-256: \`${hash}\`\n\n${facts}`);
    }
    const scope =
      target.language === "rust"
        ? "Line documentation excerpts only; this is not an exhaustive API or compilation result."
        : target.language === "typescript"
          ? "Syntax-only explicit exports and JSDoc. Initializers and implementation bodies are omitted; inferred types and re-export resolution are not computed."
          : "Python stdlib AST definitions, signatures and docstrings. Project modules are never imported; runtime exports are not evaluated.";
    outputs.set(
      `docs/apis/generated/${target.id}.md`,
      `<!-- Generated from source by @aphrody/bun-workspace. Do not edit. -->\n# Source reference: ${target.id}\n\n${scope}\n\n${sections.join("\n\n")}\n`,
    );
  }
  return outputs;
}
