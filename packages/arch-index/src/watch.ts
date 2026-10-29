// SPDX-License-Identifier: MIT
// Real-time loop: conditional polling of every source, one task per source with its own interval and backoff.
import { deliverWebhook, type Webhook, type WebhookOptions } from "./events.ts";
import { syncAur, syncNews, syncOfficial, syncOfficialSources, syncAurSources, AUR_META_MIN_INTERVAL_MS, DEFAULT_REPOS, type Context } from "./sync.ts";

export interface WatchOptions {
  repos?: readonly string[];
  files?: boolean;
  /** Official repository databases. Default 120 s; one 304 per repo when nothing changed. */
  officialIntervalMs?: number;
  /** AUR metadata archive. Never below the server's 300 s cache lifetime. */
  aurIntervalMs?: number;
  newsIntervalMs?: number;
  /** After each sync fetch .SRCINFO for these pkgbases (official and AUR) when their version changed. */
  trackSources?: string[];
  webhooks?: Webhook[];
  webhookOptions?: WebhookOptions;
  signal?: AbortSignal;
  /** Called after every task run (tests, logging). */
  onTask?: (task: string, result: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Stop after this many task runs (tests). */
  maxRuns?: number;
}

interface Task {
  name: string;
  every: number;
  due: number;
  failures: number;
  run: () => Promise<unknown>;
}

export interface WatchState {
  runs: number;
  tasks: { name: string; nextInMs: number; failures: number }[];
}

/** Run until `signal` aborts (or maxRuns). Returns the number of task runs. */
export async function watch(ctx: Context, options: WatchOptions = {}): Promise<number> {
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const unsub = options.webhooks?.length
    ? ctx.bus.subscribe(e => {
        for (const hook of options.webhooks!) void deliverWebhook(hook, e, options.webhookOptions).catch(() => {});
      })
    : () => {};
  const t0 = ctx.now();
  const tasks: Task[] = [
    {
      name: "official",
      every: options.officialIntervalMs ?? 120_000,
      due: t0,
      failures: 0,
      run: async () => {
        const reports = await syncOfficial(ctx, { repos: options.repos ?? DEFAULT_REPOS, files: options.files });
        const bad = reports.find(r => r.status === "error");
        if (bad) throw new Error(`${bad.repo}: ${bad.error}`);
        if (options.trackSources?.length) await syncOfficialSources(ctx, { names: options.trackSources, pkgbuild: true });
        return reports;
      },
    },
    {
      name: "aur",
      every: Math.max(AUR_META_MIN_INTERVAL_MS, options.aurIntervalMs ?? AUR_META_MIN_INTERVAL_MS),
      due: t0,
      failures: 0,
      run: async () => {
        const r = await syncAur(ctx);
        if (r.status === "error") throw new Error(r.error);
        if (options.trackSources?.length) await syncAurSources(ctx, { names: options.trackSources, pkgbuild: true });
        return r;
      },
    },
    {
      name: "news",
      every: options.newsIntervalMs ?? 600_000,
      due: t0,
      failures: 0,
      run: async () => {
        const r = await syncNews(ctx);
        if (r.status === "error") throw new Error(r.error);
        return r;
      },
    },
  ];
  let runs = 0;
  try {
    while (!options.signal?.aborted && (options.maxRuns === undefined || runs < options.maxRuns)) {
      const now = ctx.now();
      const due = tasks.filter(t => t.due <= now).sort((a, b) => a.due - b.due);
      if (due.length === 0) {
        const wait = Math.min(...tasks.map(t => t.due)) - now;
        await sleep(Math.min(Math.max(wait, 10), 30_000));
        continue;
      }
      for (const task of due) {
        if (options.signal?.aborted) break;
        try {
          const result = await task.run();
          task.failures = 0;
          task.due = ctx.now() + task.every;
          options.onTask?.(task.name, result);
        } catch (error) {
          task.failures++;
          // Exponential backoff with a ceiling of 30 minutes; the error is an event so subscribers see outages.
          task.due = ctx.now() + Math.min(1_800_000, task.every * 2 ** Math.min(task.failures, 6));
          ctx.bus.emit(ctx.store.addEvent({ type: "sync-error", source: task.name, name: task.name, new: error instanceof Error ? error.message : String(error), ts: ctx.now() }));
          options.onTask?.(task.name, { error: error instanceof Error ? error.message : String(error) });
        }
        runs++;
        if (options.maxRuns !== undefined && runs >= options.maxRuns) break;
      }
    }
  } finally {
    unsub();
  }
  return runs;
}
