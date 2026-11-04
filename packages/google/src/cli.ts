// SPDX-License-Identifier: Apache-2.0
/**
 * `yolo google drive|fonts`: the Google commands Bun owns (Drive projection, Google Fonts edge proxy).
 * Gemini and Google Cloud runtime commands belong to the Rust CLI (`aphrody google`).
 */
export const googleHelp = `Usage: yolo google <drive|fonts> ...
  drive <auth-login|status|sync [--download-only] [--dry-run] [--seed-reviewed directory]|sync-models>
  fonts serve [--port 8796] [--cache <dir>] [--origin https://cdn.aphrody.com] [--static <dir>]... [--all-families]
Gemini and Google Cloud runtime commands (status, env, doctor, login, auth-status, whoami, models,
generate, generate-stream) belong to the Rust CLI: aphrody google <command>.`;

const fontsUsage =
  "usage: yolo google fonts serve [--port 8796] [--cache <dir>] [--origin https://cdn.aphrody.com] [--static <dir>]... [--all-families]";

/** Runs one Bun-owned Google command and returns its exit status; `fonts serve` runs until stopped. */
export async function runGoogle(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "drive") {
    await (await import("./drive-cli.ts")).runDriveCli(rest);
    return 0;
  }
  if (command === "docs") {
    return (await import("./docs-wordcraft-cli.ts")).runDocsWordCraftCli(rest);
  }
  if (command === "fonts") {
    const [action, ...options] = rest;
    if (action !== "serve") {
      console.error(fontsUsage);
      return 2;
    }
    const option = (name: string, fallback: string): string => {
      const index = options.indexOf(`--${name}`);
      const value = index >= 0 ? options[index + 1] : undefined;
      return value || fallback;
    };
    const statics = options.flatMap((value, index) => (options[index - 1] === "--static" && value ? [value] : []));
    const { serveFontsProxy } = await import("./fonts-proxy.ts");
    const server = serveFontsProxy({
      port: Number(option("port", Bun.env.FONTS_PROXY_PORT ?? "8796")),
      cacheDir: option("cache", Bun.env.FONTS_PROXY_CACHE ?? "/home/ubuntu/apps/cdn/google"),
      origin: option("origin", Bun.env.FONTS_PROXY_ORIGIN ?? "https://cdn.aphrody.com"),
      families: options.includes("--all-families") ? null : undefined,
      staticRoot: statics.length ? statics : (Bun.env.FONTS_PROXY_STATIC ?? "").split(",").filter(Boolean),
    });
    console.log(`aphrody-fonts-proxy on ${server.url}`);
    return await new Promise<number>(() => {});
  }
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    console.log(googleHelp);
    return command === undefined ? 2 : 0;
  }
  console.error(`yolo google ${command}: not a Bun command; the Rust owner runs it: aphrody google ${argv.join(" ")}`);
  return 2;
}

if (import.meta.main) process.exitCode = await runGoogle(process.argv.slice(2));
