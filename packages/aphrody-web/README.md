# `@aphrody/web-crawl`

Typed Bun client and small CLI for the Aphrody Web crawler. It delegates crawl
policy, rendering, extraction, persistence and indexing to the installed
`aphrody` Rust CLI; it never shells out through a command string.

## Install

```sh
bun add @aphrody/web-crawl
```

Install the matching Aphrody CLI from the [Aphrody Bun OS releases](https://github.com/aphrody-labs/bun-os/releases)
or build `aphrody` from the workspace. Put it on `PATH`, or set `APHRODY_BIN`
to its absolute path. JavaScript package support targets Bun; the crawler and
its public Rust API are implemented in Rust.

## JavaScript / TypeScript API

```ts
import { crawl } from "@aphrody/web-crawl";

const report = await crawl({
  urls: ["https://example.com"],
  allowedDomains: ["example.com"],
  maxDepth: 1,
  maxRequests: 10,
  concurrency: 2,
  obeyRobots: true,
  browser: "playwright",
});

console.log(report.pages.map(({ url, title }) => ({ url, title })));
```

The API validates seed URL schemes and numeric bounds, passes arguments as an
argv array (no shell), returns the CLI JSON report, and throws
`AphrodyWebError` with the exit code and stderr on failure.

## CLI

```sh
bunx @aphrody/web-crawl https://example.com \
  --allowed-domain example.com --max-depth 1 --max-requests 10 \
  --browser playwright --obey-robots true
```

The `playwright` transport requires the local Aphrody Obscura browser and
Playwright bridge services. Use `native` when no bridge is installed.
