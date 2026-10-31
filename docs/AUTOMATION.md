# Bun OS automation

Every recurring step from source to production runs, recovers and reports by itself. Nobody watches, kicks or
approves anything routine. One entry point, `factory/automation/auto.ts`, runs every loop on the VPS from systemd user
units installed by `bun factory/automation/auto.ts install` (re-run automatically when `factory/automation` changes).
State lives in `~/.local/state/bunos-auto`; reports go to [aphrody.com/status](https://aphrody.com/status) and a2a,
never Discord.

Scope: Bun OS only (aphrody.com WebOS, store, site, gateways, Bun OS images). Shenron (dragonballfr.com,
`/srv/shenron-build`, host `dbfr`) is a separate project with its own release pipeline: no loop builds, deploys or
restarts it.

## Loops

| Loop                     | Trigger                                                                | Unit or job                                                      | Recovery                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync and gate            | every 10 min                                                           | `bunos-sync.timer` (factory/sync, [SYNC.md](SYNC.md))            | dirty or diverged trees go to `refs/wip/<host>/<stamp>`; `vps-gate/*` commit statuses; red gates posted to a2a `help-wanted`                            |
| 1. Delivery              | `gate.json` written (`bunos-auto-deliver.path`), catch-up every 15 min | `bunos-auto-deliver.service`: `auto.ts deliver`                  | each lane keeps its last good commit and is retried on the next green gate; a failure files an auto-fix task; `bunos-auto/deliver` commit status        |
| 2. Runtime health        | every 2 min                                                            | `bunos-auto-health.timer`                                        | systemd `Restart=` drop-ins on every live unit; restart after two failed probes; after three restarts in 30 min an escalation task goes to an agent     |
| 2. Resource guards       | every 10 min                                                           | `bunos-auto-guard.timer`                                         | prune caches above 85 % disk, btrfs balance below 8 GiB unallocated, idle priority then stop for builds over 12/24 h, log rotation, certbot, compose up |
| 3. Dependencies          | daily or weekly timers                                                 | `bunos-auto-deps@{forks,locks,bun,helium,android}`               | qualification first, normal push on green; failures file a task to the owner (forks: `fork-migration`)                                                  |
| 4. Agent loop            | persistent, every 10 min                                               | `bunos-auto-coordinator.service`                                 | `Restart=always`; stalled lines and tasks are re-queued after 12 h; daily caps on Gemini tokens and peer runs                                           |
| 5. Nightly qualification | 02:30 UTC                                                              | `bunos-auto-nightly.timer`                                       | a red run files an auto-fix task with the artifacts; the next night runs again                                                                          |
| Status page and digest   | every 5 min; digest after the nightly run                              | `bunos-auto-status.timer`                                        | static files in `~/apps/bunos-status`, served by `snippets/aphrody-status.inc`                                                                          |
| Native apps publish      | `~/native-apps/debs/index.tsv` changes                                 | `bunos-native-publish.path`                                      | replaces the old tmux `publish-watch.sh` loop; runs again on the next deb drop                                                                          |
| WebOS activation         | release handoff (`ready` pointer)                                      | `aphrody-webos-deploy.timer` (root, `aphrody-webos-activate.ts`) | verifies the receipt, switches `~/apps/webos/current`, gates on `/api/health`, rolls back                                                               |
| GitHub Actions           | push to main                                                           | `.github/workflows/ci.yml` and the path-filtered workflows       | secondary signal; the VPS gate is the reference                                                                                                         |

### 1. Continuous delivery

The gate (check, lint, format, cargo check, image plan) runs inside `bunos-sync` and writes
`~/.local/state/bunos-sync/gate.json`. `auto.ts deliver` reads it:

- **Red**: one auto-fix task per failed step (key `gate:<step>`), commit status `bunos-auto/deliver` failure.
- **Green**: every lane whose inputs changed since that lane last succeeded runs, then `deploy-sites.ts --verify-only`
  checks every public host.

| Lane            | Inputs                                                          | Action                                                                                  |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `webos`         | `crates/aphrody-webos-*`, inventory, `bun-ui-web`               | `release.sh` under the checkout lock, then waits until `/api/health` serves the commit  |
| `activator`     | `infra/config/host/libexec/aphrody-webos-activate.ts`           | installed root-owned into `/usr/local/libexec`                                          |
| `store`         | `apps/webos/store`                                              | restart `aphrody-store`, probe                                                          |
| `nginx`         | `infra/config/host/nginx`                                       | install changed files, `nginx -t`, reload; rollback on a failed test; drift is reported |
| `compose`       | `infra/config/host/apps/vps`                                    | install into `~/apps`, `docker compose up -d` for services that have a container        |
| `automation`    | `factory/automation`                                            | `auto.ts install`                                                                       |
| `unified-image` | `factory/images/bunos-unified`, `manifest.json`, cosmic-session | `bun factory image build bunos-unified --target session` (transient unit)               |
| `cosmic`        | `factory/native-apps`, cosmic sources                           | `aphrody-native-apps container cosmic`; the publish path unit refreshes the apt feed    |
| `rust-base`     | `factory/rustbase`, uutils, sudo-rs, ntpd-rs                    | `rust-base.ts all`                                                                      |

nginx drift that no commit asked for (certbot and hand edits live there) is listed on the status page, not
overwritten.

### 2. Self-healing runtime

`auto.ts install` gives every live Bun OS unit a `90-bunos-auto.conf` drop-in: `Restart=always` (Android:
`on-failure`), `RestartSec=5`, a start limit of 30 per 10 minutes, so a crash loop is never parked. None of these
binaries speak `sd_notify`, so the HTTP prober is the watchdog: `/api/health`, `/api/android`, the store
API and apt repo, the site, the chat gateway, downloads, the a2a hub, the Android 17 container (`waydroid status`), the
stream gateways and the session units. The host `aphrody-selfheal.timer` also restarts failed `aphrody-*` units
(Shenron excluded).

The guards prune only derived data (Docker build cache, dangling images); old image jobs and qualification runs move
to `~/.local/share/bunos-auto/quarantine` and are purged after 7 days.

### 3. Dependencies

- **forks**: four `factory/rustbase/forks.json` forks a day, in rotation. Upstream is merged into the `aphrody` branch
  (a merge, not a rebase, so the push is never forced), then `cargo check`, then the fork branch is pushed and the
  gitlink bumped on main.
- **locks**: weekly `cargo update` and `bun update` in the shared checkout under the sync lock; landed only when
  `cargo check --workspace --locked` or `bun check` is green. The VPS stays the single lock writer.
- **bun**: a newer upstream canary is installed from npm (integrity checked); `bun check` and `bun lint` run with it,
  then every pin is bumped.
- **helium**: the newest `imputnet/helium-linux` release (sha256 computed) goes into the image pin. The image lane
  rebuilds it and the nightly run qualifies it.
- **android**: needs a `pins.android17` source in `factory/images/manifest.json`. Until it exists, the job files the
  task to `android`.

### 4. Agent loop

The coordinator reads `docs/PRODUCT.md` from origin/main every 10 minutes:

- Open automation tasks (red gates, failed lanes, escalations, nightly failures) come first. The owner gets one hour
  after the a2a notice, then a Codex or Claude peer runs it (`aphrody a2a invoke`, a transient unit with a 2-hour
  limit).
- Product lines are taken in critical-path order (3, 2, 9, 10, 14, 15, 17, 25, 12, 23, then the rest). Lines that are
  done, or blocked on a line that is not done, are skipped. The first dispatch goes to the owning a2a topic; a line
  with no progress (no change to its state, evidence or next step) for 12 hours goes to a peer.
- At most three items are in flight at once.
- Briefs come from Vertex Gemini (aphrody-bot through `aphrody-chat-gateway`), capped by `BUNOS_AUTO_DAILY_TOKENS`
  (300k). Peer runs are capped by `BUNOS_AUTO_DAILY_INVOKES` (4 a day).
- The "Automation dispatch" section at the end of PRODUCT.md is rewritten at most once an hour.

### 5. Nightly qualification

The nightly run:

1. builds `bunos-unified:session`;
2. runs `qualify.sh session` in its own container (`bunos-auto-nightly`): the ready marker, Helium, the Gemini web
   app, the Android window and screenshots;
3. checks the stream gateway (`:8794`) inside the session;
4. runs `qualify-gemini.ts --json` across the layers;
5. publishes the screenshots and results on the status page and posts the daily digest to the a2a `product` topic.

## Codex Luna sub-agents

Cheap, bounded routine work goes to Codex (`gpt-6-luna`, reasoning `medium`) workers that act like Claude sub-agents.
Source: `factory/codex-agent/` (`roles.ts`, `dispatch.ts`); CLI: `aphrody codex agent …` (or `bun factory/codex-agent/dispatch.ts …`).
Background and crate map: [CODEX.md](CODEX.md).

- **Services**: `aphrody-codex-app-server.service` (real `codex app-server`, `ws://127.0.0.1:4500`, loopback) and
  `aphrody-codex-agent.service` (the dispatcher). Both run in `build.slice` (CPUWeight 20, nice 10), `Restart=always`, so
  WebOS and the interactive units keep priority. Unit sources: `infra/config/host/systemd/aphrody/`.
- **Workers**: `codex exec -m gpt-6-luna -c model_reasoning_effort="medium" -s <sandbox> -C ~/src/bun-os --json --ephemeral -o <result>`
  in the single checkout. Editing roles use `workspace-write`; the dispatcher (not the sandboxed worker) then commits the
  files the worker changed, as `aphrody-dev`, pulls with rebase and pushes to `main` (never forced). Files that were
  already dirty before the task, or lie outside a declared file set, are left alone and reported.
- **Roles**: `reviewer` (read-only review), `fixer` (lint/format/small defects, commits), `doc-writer` (docs only, commits),
  `test-runner` (runs the VPS gate or a named check, no commits), `triage` (read-only failure triage). `aphrody codex agent roles` lists them.
- **Limits** (`~/apps/aphrody/shared/coord/codex-agent/config.json` or `CODEX_AGENT_*` env): 3 concurrent workers, 20 minutes
  per task, 30M tokens per day and 600M in total (the ChatGPT login has no per-call price, so the cap counts tokens; at the
  cap tasks end as `capped`). Committing tasks with overlapping file sets run one after the other; a committing task
  without a file set is exclusive. The push uses `BUNOS_GATE_STEPS=stale-overwrite,shell-syntax` so another agent's red
  `check`/`lint`/`format` step does not block a worker's own change; the nightly gate still judges main.
- **State and logs**: `~/apps/aphrody/shared/coord/codex-agent/{queue,running,done,results,logs}`, `ledger.jsonl` (tokens per task).
  `aphrody codex agent status` prints queue, running tasks, recent results and the budget.
- **Delegating**: `aphrody codex agent run --role fixer --files path1,path2 "task"` (waits), `… queue …` (returns an id),
  `--product-line N|text` adds a `docs/PRODUCT.md` line to the prompt, or send an a2a message to `codex-luna-<role>`
  (or `codex-luna` with a `role: <name>` line; optional `files: a,b` line). The short report comes back to the sender's inbox.
- **Automation hooks**: the dispatcher queues one `triage` task per red gate commit (reads `~/.local/state/bunos-sync/gate.json`,
  every 5 minutes); the coordinator can call `agent lint-sweep`, `agent doc-sync` and `agent gate-triage` for routine work
  before it spends a Codex/Claude peer run (`aphrody a2a invoke`) on it.

## Human gates removed

- `buncc store --run` submits as soon as the Partner Center credentials exist (exit 3 while it waits).
- The manual-only lock regeneration workflow is gone (`deps@locks` on the VPS replaces it).
- `deploy-sites.ts` builds through `release.sh` (the old `apps/webos/deploy.ts` entry no longer existed), and
  `--verify-only` no longer refuses when main moved.
- The tmux publish watcher is now a path unit.
- CI's Bun setup no longer fails inside the checkout.

What stays is real safety: no force push, secrets only in their stores, quarantine before deletion, cost caps.

## Owner consents (the only human steps)

The status page lists each consent with its state, and every flow that needs one proceeds by itself once it exists:

- Google consent (aphrody-bot impersonation and user OAuth);
- Play Store sign-in in Android 17;
- `az login`;
- admin-elevated Windows tasks;
- buying the new server.

## Workstation

The `BunOS-Sync` Scheduled Task (`bun factory/sync/install.ts` on Windows) runs `factory/sync/bunos-sync.ts` against
`C:\src\bun-os` every 10 minutes: hidden, no push, `refs/wip/workstation/<stamp>` snapshots once a tree has been idle
for the grace period. Status: `~\.local\state\bunos-sync\status.json`.

## Operating

```sh
systemctl --user list-timers 'bunos-*'
systemctl --user status bunos-auto-coordinator
bun factory/automation/auto.ts deliver --force     # redeploy the last green gate
bun factory/automation/auto.ts deps forks <name>   # refresh one fork now
bun factory/automation/auto.ts nightly --skip-build
cat ~/.local/state/bunos-auto/events.jsonl | tail
```
