<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/bun-steam

Bun half of the Bun OS Steam owner. The Rust half is [`crates/bun-steam`](../../crates/bun-steam)
(VDF, discovery, Proton launch environment, depot client `bun-steam-depot`, Steamworks emulator).
Both read and write the same VDF dialects byte for byte.

`bun-steam` (also `re steam`) is the one command surface; every command accepts `--json`.

| Area          | Commands                                                                                                    | Module                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Client config | `client`, `client users`, `client autologin <account>`                                                      | `config.ts` (Windows registry through `reg.exe`, Linux `registry.vdf`, `loginusers.vdf`) |
| steamcmd      | `steamcmd status`, `steamcmd update <appid>`, `steamcmd run +cmd ...`                                       | `steamcmd.ts`                                                                            |
| Libraries     | `libraries`, `libraries games`, `libraries disks`, `libraries move <from> <to>`                             | `libraries.ts`                                                                           |
| Proton        | `proton list`, `catalog`, `latest`, `install`/`update <ge\|cachyos>`, `valve`, `runtimes`, `mapping`, `set` | `proton.ts`, `config.ts`                                                                 |
| Launch        | `launch env`, `launch options <appid>`, `launch run <appid>`                                                | `launch.ts`                                                                              |
| Remote Play   | `remoteplay`                                                                                                | `remoteplay.ts`                                                                          |
| VDF           | `vdf <file>`, `vdf write` (text, binary KV, `shortcuts.vdf`, `appinfo.vdf`, `packageinfo.vdf`)              | `vdf.ts`, `appinfo.ts`                                                                   |
| Depots        | `depot list\|download\|sync\|audit` (runs `bun-steam-depot`)                                                | `crates/bun-steam`                                                                       |
| API index     | `api sync`, `api search`, `api show`, `api diff`, `api sources`                                             | `apiindex.ts`                                                                            |
| Index         | `scan`, `stats`, `sql`, `store`, `openid`, `classify`, `remote-download`                                    | `scan.ts`, `db.ts`, `webapi.ts`, ...                                                     |

Credentials: steamcmd reuses the session the owner opened once interactively (`ConnectCache` key
`crc32(lowercase account)` in hex followed by `1`; only its presence is checked). Runs use
`@NoPromptForPassword 1` and a closed stdin, so a missing session fails instead of prompting, and
output lines mentioning passwords, tokens or guard codes are redacted. Nothing reads `local.vdf`,
`ConnectCache` values or passwords.

Writes (`client autologin`, `proton set`, `launch options --set`, `libraries move`) refuse while
Steam runs, accept `--dry-run`, and replace files atomically without backups.

Anti-cheat: only the official runtimes (Proton EasyAntiCheat Runtime 1826330, Proton BattlEye
Runtime 1161040, or the same runtimes from the Lutris index for umu/Heroic) are installed.

## Audit report

`bun-steam audit [--host local|vps] [--cell N] [--disk-mb N] [--library P]... [--out F]` measures
the host with Bun APIs only (`fetch`, `Bun.dns`, `Bun.connect` TCP/TLS, `Bun.udpSocket`,
`Bun.file`) and keeps each run in the `audit_run` table of the Steam index (`bun:sqlite`;
`--no-record` skips it). `--host vps` bundles the CLI, runs it read-only over `ssh` with `nice`,
removes the temporary file and records the report locally. Probes are bounded: `GET /` (an empty
object) per content server, one TCP connect per address family and port, one TLS handshake, and
`--disk-mb` MiB (default 256) read from the middle of the largest game file of each library.

Schema `bun-steam.audit/v1` (stable; new fields are only added):

| Field                                                                                                                                                                  | Content                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`, `generatedAt`, `durationMs`, `host{name,platform,arch,bun}`, `steamRoot`                                                                                     | run identity                                                                                                                                                                                                             |
| `cell{override,usedByClient,queried[]}`                                                                                                                                | `CellIDServerOverride`, the cell the client logged, cells queried (configured and `0` = by IP)                                                                                                                           |
| `dns{servers[],resolverRttMs}`                                                                                                                                         | system resolvers, best of three UDP A queries                                                                                                                                                                            |
| `cms[]{endpoint,type,dc,load,weightedLoad,tcpMs}`                                                                                                                      | `ISteamDirectory/GetCMListForConnect` with TCP connect time                                                                                                                                                              |
| `contentServers[]{host,vhost,type,cellId,queriedCells[],load,weightedLoad,https,group,probe}`                                                                          | `IContentServerDirectoryService/GetServersForSteamPipe`; `probe{dns{a[],aaaa[],ms},tcp{v4_80,v4_443,v6_443},tls{handshakeMs,totalMs,error?},http,https}`, each HTTP timing `{status,ttfbMs,totalMs,bytes,server,error?}` |
| `logs.content{cellUsed,http2,stalls,hosts[]{host,type,bytes,seconds,mbps,hits,misses,samples,interfaces},rates{samples,maxMbps,last[]},phases{},errors[]{what,count}}` | `content_log.txt`                                                                                                                                                                                                        |
| `logs.connection{transports{},canConnect,ipv6{HTTP,UDP},connectivity,cmPings[]{host,ms,load}}`                                                                         | `connection_log.txt`                                                                                                                                                                                                     |
| `logs.remotePlay{sessions[]{at,peer,mode},disconnects{},streaming{codec,encoder,bitrate,packetLoss}}`                                                                  | `remote_connections.txt`, `streaming_log.txt`                                                                                                                                                                            |
| `config{steamDevCfg,downloadThrottleKbps,allowDownloadsDuringGameplay,recentDownloadRateBytes,shaderCache,remotePlay}`                                                 | `steam_dev.cfg`, `config.vdf`, `localconfig.vdf` `streaming_v2` switches (no device names)                                                                                                                               |
| `disk[]{library,freeBytes,totalBytes,sample,sampleBytes,readMBps}`                                                                                                     | library free space and read speed                                                                                                                                                                                        |
| `linux`                                                                                                                                                                | `net.core.{r,w}mem_{max,default}`, `tcp_{r,w}mem`, congestion control, default and active qdisc (`null` elsewhere)                                                                                                       |
| `findings[]{id,severity,message,evidence?}`                                                                                                                            | `info`, `warn`, `critical`                                                                                                                                                                                               |
| `recommendations[]{id,reason,apply?{file,key,value},manual?}`                                                                                                          | `apply` entries are what `bun-steam tune --apply` writes                                                                                                                                                                 |

`bun-steam tune [--report F] [--apply] [--force] [--only id,...]` writes only Steam's files:
`steam_dev.cfg` (`@nClientDownloadEnableHTTP2Platform*`, `@fDownloadRateImprovementToAddAnotherConnection`)
and `config.vdf` (`CellIDServerOverride`, `DownloadThrottleKbps`; Steam must be closed). Network,
system and Remote Play UI settings stay `manual`.

## API and product index

`bun-steam api sync` indexes public sources into the Steam index (`api_item`, one row per source
with its license; `api_source` keeps ETag / Last-Modified / GitHub sha per URL; `api_change`
records what each sync added, changed or removed). steamdb.info is never crawled.

| Source                                                                                         | License                      | Content                                                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `xPaw/SteamWebAPIDocumentation` `api.json`, `api_undocumented_methods.txt`                     | MIT                          | primary Web API map (interfaces, methods, versions, verbs, typed parameters, undocumented flag) |
| `ISteamWebAPIUtil/GetSupportedAPIList` (no key)                                                | Valve Web API terms          | public methods                                                                                  |
| `SteamTracking/SteamTracking` `API/*.json`                                                     | no license file (facts only) | Web API dumps                                                                                   |
| `SteamTracking/Protobufs` `steam/*.proto`                                                      | Unlicense                    | unified service RPCs (`IPlayerService/GetOwnedGames` -> request/response messages)              |
| `ISteamDirectory/GetCMListForConnect`, `IContentServerDirectoryService/GetServersForSteamPipe` | Valve Web API terms          | CMs and content servers                                                                         |
| store `api/appdetails`, `api/packagedetails`                                                   | store terms                  | metadata of locally known apps/packages (`--store-limit`, 1.5 s apart)                          |
| local `appinfo.vdf` / `packageinfo.vdf`                                                        | local cache                  | PICS apps, depots, branches/builds, packages                                                    |

`api search <term>`, `api show <Interface/Method>`, `api method <Interface/Method>` (merged view,
`public` when no source requires a key), `api call <Interface/Method> k=v...` (public methods only,
Bun fetch, Bun OS User-Agent, polite delay), `api diff [sync]`, `api sources`. A Web API key is only
read from `STEAM_WEB_API_KEY` for `--applist` and never stored.

## Search

`bun-steam search <term>` ranks exact app id and exact name first, then name prefix, then the FTS5
rank of the local `app_catalog`/`app_fts` index (PICS, store details, cached store search results),
then the live keyless `store.steampowered.com/api/storesearch`. Installed apps (`installed_app`,
`local` and remote hosts recorded by `search-index --host vps`) are flagged. `searchApps(db, term,
{ live, limit, cc, lang })` is the typed entry point for as-you-type callers. SteamDB's search
backend is never used.
