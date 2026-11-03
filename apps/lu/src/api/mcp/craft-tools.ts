// Craft CLI tools in the Bun OS desktop. The engines keep their own CLI contracts.
import type { MCPToolDefinition, ToolArgs } from "./types";
import { allAppCapabilities } from "@aphrody/bun-workspace/capabilities";

const engines = allAppCapabilities().map(capability => capability.libraryId);

export const CRAFT_EXECUTE: MCPToolDefinition = {
  name: "craft_execute",
  description:
    "Run an installed Bun OS Craft CLI for documents, presentations, spreadsheets, CAD, video or other creative work. Pass the engine’s own CLI arguments; use --help first when unsure. Works on the local desktop and reports an error if the CLI is not installed. This can read or write files.",
  inputSchema: {
    type: "object",
    properties: {
      engine: { type: "string", enum: [...engines], description: "Craft engine owning the operation." },
      args: { type: "array", items: { type: "string" }, description: "Arguments in the engine’s own CLI format." },
      timeoutMs: {
        type: "number",
        minimum: 1000,
        maximum: 43200000,
        description: "Optional timeout in milliseconds for long exports; defaults to two minutes.",
      },
    },
    required: ["engine", "args"],
    additionalProperties: false,
  },
  category: "terminal",
  source: "builtin",
};

/** Build a shell invocation without interpolating model-controlled strings into code. */
export function craftShellArgs(args: ToolArgs): ToolArgs | string {
  if (typeof args.engine !== "string" || !engines.includes(args.engine)) {
    return "craft_execute: choose a supported Craft engine.";
  }
  if (
    !Array.isArray(args.args) ||
    args.args.length > 32 ||
    args.args.some(arg => typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"))
  ) {
    return "craft_execute: args must be an array of at most 32 strings, each at most 4096 characters and without NUL.";
  }
  if (
    args.timeoutMs !== undefined &&
    (typeof args.timeoutMs !== "number" ||
      !Number.isInteger(args.timeoutMs) ||
      args.timeoutMs < 1000 ||
      args.timeoutMs > 43200000)
  ) {
    return "craft_execute: timeoutMs must be an integer from 1000 to 43200000.";
  }
  // Bash receives these as $0 and $@, not source text. The existing shell executor
  // supplies workspace context, read-only policy, cancellation and timeout.
  return {
    command: 'exec "$0" "$@"',
    shell: "bash",
    args: [`${args.engine}-cli`, ...args.args],
    ...(args.timeoutMs === undefined ? {} : { timeout: args.timeoutMs }),
  };
}
