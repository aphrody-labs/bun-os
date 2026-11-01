#!/usr/bin/env bun
import { crawl, type CrawlOptions } from "./index.ts";

function parse(argv: string[]): CrawlOptions {
  const options: CrawlOptions = { urls: [] };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      options.urls.push(item);
      continue;
    }
    if (item === "--obey-robots" || item === "--sitemaps") {
      const next = argv[index + 1];
      const enabled = next !== "false";
      if (next === "true" || next === "false") index++;
      if (item === "--obey-robots") options.obeyRobots = enabled;
      else options.sitemaps = enabled;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`missing value for ${item}`);
    switch (item) {
      case "--allowed-domain":
      case "--allowed-domains":
        (options.allowedDomains ??= []).push(...value.split(",").filter(Boolean));
        break;
      case "--max-depth":
        options.maxDepth = Number(value);
        break;
      case "--max-requests":
        options.maxRequests = Number(value);
        break;
      case "--concurrency":
        options.concurrency = Number(value);
        break;
      case "--max-per-host":
        options.maxPerHost = Number(value);
        break;
      case "--max-retries":
        options.maxRetries = Number(value);
        break;
      case "--per-host-delay":
        options.perHostDelay = Number(value);
        break;
      case "--sqlite":
        options.sqlite = value;
        break;
      case "--browser":
        if (value !== "native" && value !== "playwright") throw new Error("--browser must be native or playwright");
        options.browser = value;
        break;
      default:
        throw new Error(`unknown option: ${item}`);
    }
  }
  return options;
}

if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
  console.log(
    "Usage: aphrody-web <url...> [--browser native|playwright] [--allowed-domain host] [--max-depth n] [--max-requests n] [--concurrency n] [--max-per-host n] [--max-retries n] [--per-host-delay ms] [--sqlite path] [--obey-robots] [--sitemaps]",
  );
} else {
  try {
    const report = await crawl(parse(Bun.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
