// SPDX-License-Identifier: Apache-2.0
/** Infra qualification without compiling Rust, building applications or crawling sites. */
/* eslint-disable no-await-in-loop -- Serialize bounded runtime probes and retain ordered private evidence. */
import { TOML, Transpiler } from "bun";
import { chmod, mkdir, realpath } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { discoverMonorepoGatePlan, executeMonorepoGate, type GateCheck } from "./monorepo-gate.ts";
import { loadFleet } from "./fleet.ts";
import { pipelineCatalog } from "./pipeline-catalog.ts";
import { infraExecutable } from "./runtime.ts";

type Manifest = {
  package?: { name?: string; version?: string };
  workspace?: { members?: string[]; exclude?: string[] };
  features?: Record<string, unknown>;
};
export type SourceProof = {
  path: string;
  sha256: string;
  syntax: "parsed" | "not-executed" | "failed";
  tests: number;
  imports?: string[];
  cfg?: string[];
  error?: string;
};
export type Service = {
  id: string;
  unit: string;
  health?: string;
  readiness?: string;
  status?: string;
  staged?: boolean;
  required?: boolean;
  workingDirectory?: string;
  additionalUpstreams?: string[];
};
export type Observation = {
  name: string;
  command: string[];
  exitCode: number | null;
  startedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
};
type HostSnapshot = {
  hostname?: string;
  observedAt?: string;
  units?: Array<{
    name: string;
    exitCode?: number | null;
    properties?: Record<string, string>;
  }>;
  health?: Array<{
    id: string;
    kind: string;
    url: string;
    status?: number;
    ok?: boolean;
  }>;
  paths?: Array<{ id: string; path: string; exists: boolean }>;
  failedUnits?: { exitCode?: number | null; units?: string[] };
  postgresqlReady?: { exitCode?: number | null };
  redis?: { exitCode?: number | null; stdout?: string };
};
export type HostQualification = {
  observed: boolean;
  healthy: boolean;
  failures: string[];
  optionalFailures: string[];
};

/** A successful SSH/Python exit only proves transport; qualify the collected facts separately. */
export function qualifyHost(
  host: "vps" | "dbfr" | "wsl",
  snapshot: HostSnapshot,
  services: Service[],
  exitCode: number | null,
): HostQualification {
  const failures: string[] = [];
  const optionalFailures: string[] = [];
  const observed = exitCode === 0 && Boolean(snapshot.hostname && snapshot.observedAt);
  if (!observed) failures.push("Host observation missing or transport failed");
  const selected = hostServices(services, host);
  const unitRequirements = new Map([
    ...["nginx.service", "postgresql.service", "redis-server.service"].map((name): [string, boolean] => [
      name,
      host !== "wsl",
    ]),
    ...selected.map((service): [string, boolean] => [service.unit, service.required !== false]),
  ]);
  const failure = (message: string, required: boolean) => (required ? failures : optionalFailures).push(message);
  for (const [name, required] of unitRequirements) {
    const unit = snapshot.units?.find(entry => entry.name === name);
    if (
      !unit ||
      unit.exitCode !== 0 ||
      unit.properties?.LoadState !== "loaded" ||
      unit.properties?.ActiveState !== "active"
    )
      failure(`Unit ${name} is unavailable or inactive`, required);
  }
  for (const service of selected) {
    for (const [kind, url] of [
      ["health", service.health],
      ["readiness", service.readiness],
      ...(service.additionalUpstreams ?? []).map(address => ["upstream", `tcp://${address}`]),
    ]) {
      if (!url) continue;
      const endpoint = snapshot.health?.find(
        entry => entry.id === service.id && entry.kind === kind && entry.url === url,
      );
      if (!endpoint?.ok || !endpoint.status || endpoint.status < 200 || endpoint.status >= 300)
        failure(`${service.id} ${kind} failed (${endpoint?.status ?? "not observed"})`, service.required !== false);
    }
    if (
      service.workingDirectory &&
      !snapshot.paths?.some(entry => entry.id === service.id && entry.path === service.workingDirectory && entry.exists)
    )
      failure(`${service.id} working directory is missing`, service.required !== false);
  }
  if (snapshot.failedUnits?.exitCode !== 0) failure("Failed-unit inventory unavailable", host !== "wsl");
  for (const name of snapshot.failedUnits?.units ?? []) failure(`Systemd unit ${name} is failed`, true);
  if (snapshot.postgresqlReady?.exitCode !== 0) failure("PostgreSQL readiness failed", host !== "wsl");
  if (snapshot.redis?.exitCode !== 0 || snapshot.redis?.stdout !== "PONG")
    failure("Redis readiness failed", host !== "wsl");
  return {
    observed,
    healthy: observed && failures.length === 0,
    failures,
    optionalFailures,
  };
}

/** Supplied results remain historical, including leaf gates still present in the current plan. */
export function classifyGateEvidence(
  prior: {
    results?: Array<{
      name?: string;
      command?: string[];
      cwd?: string;
      status?: string;
    }>;
  },
  checks: GateCheck[],
) {
  const historicalResults = prior.results ?? [];
  const present = (result: (typeof historicalResults)[number]) =>
    checks.some(
      check =>
        check.name === result.name &&
        check.cwd === result.cwd &&
        JSON.stringify(check.command) === JSON.stringify(result.command),
    );
  return {
    historical: true,
    qualifiesCurrentSource: false,
    results: historicalResults,
    matchingCurrentCommands: historicalResults.filter(present).length,
    excludedFromCurrentPlan: historicalResults.filter(result => !present(result)),
  };
}

export function evidenceOutsideRoot(root: string, evidence: string): boolean {
  const location = relative(root, evidence);
  return location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location);
}
const sha256 = (bytes: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Track streams concurrently, bound the command and retain a nonzero exit's output. */
export async function observeCommand(
  name: string,
  command: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<Observation> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  try {
    const executable = basename(command[0] ?? "").toLowerCase();
    if (/^(?:cargo(?:\.exe)?|cargo-serial\.sh)$/.test(executable) && !["fmt", "metadata"].includes(command[1] ?? ""))
      throw new Error("Cargo execution is excluded; only formatting and metadata are allowed");
    if (/^next(?:\.exe)?$/.test(executable) && command.includes("build")) throw new Error("Next builds are excluded");
    const child = Bun.spawn(command, {
      windowsHide: true,
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: {
        ...process.env,
        PATH: `${join(cwd, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
        APHRODY_NO_BUILD: "1",
        APHRODY_INFRA_BUILD_FROM_SOURCE: "0",
        APHRODY_NATIVE_TEST_ROOT: "",
        APHRODY_NATIVE_TEST_ARTIFACT: "",
      },
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return {
      name,
      command,
      startedAt,
      exitCode,
      stdout,
      stderr,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      name,
      command,
      startedAt,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: Math.round(performance.now() - start),
      error: String(error),
    };
  }
}

export function hostServices(services: Service[], host: "vps" | "dbfr" | "wsl"): Service[] {
  // The catalog describes the VPS workload plane. dbfr has its own DB role;
  // absent application units there are not deployment failures.
  return host === "vps" ? services.filter(service => service.status !== "retired" && !service.staged) : [];
}

/** One bounded read-only SSH command per host, one request per catalog health URL. */
export function hostProbeCommand(host: "vps" | "dbfr" | "wsl", services: Service[]): string {
  const selected = hostServices(services, host);
  const python = `import json,os,platform,shutil,socket,subprocess,time,urllib.request,urllib.error
from datetime import datetime,timezone
services=json.loads(${JSON.stringify(JSON.stringify(selected))})
deadline=time.monotonic()+90
def run(args):
 try:
  remaining=deadline-time.monotonic()
  if remaining<=0:return {'exitCode':None,'error':'ProbeDeadlineExceeded'}
  p=subprocess.run(args,capture_output=True,text=True,timeout=min(8,remaining))
  return {'exitCode':p.returncode,'stdout':p.stdout.strip()}
 except (OSError,subprocess.TimeoutExpired) as e:return {'exitCode':None,'error':type(e).__name__}
def unit(name,user=False):
 p=run(['systemctl']+(['--user'] if user else [])+['show',name,'--no-page','--property=LoadState,ActiveState,SubState,Result,NRestarts,WorkingDirectory'])
 p['name']=name;p['properties']=dict(x.split('=',1) for x in p.pop('stdout','').splitlines() if '=' in x);return p
units=[unit(x) for x in ['nginx.service','postgresql.service','redis-server.service']]+[unit(s['unit']) for s in services]
failed=run(['systemctl','--failed','--plain','--no-legend','--no-pager']);failed['units']=[line.split()[0] for line in failed.pop('stdout','').splitlines() if line.strip()]
http=[]
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None
opener=urllib.request.build_opener(NoRedirect)
for service in services:
 endpoints=[(kind,service.get(kind)) for kind in ['health','readiness']]+[('upstream','tcp://'+address) for address in service.get('additionalUpstreams',[])]
 for kind,url in endpoints:
  if not url:continue
  item={'id':service['id'],'kind':kind,'url':url};start=time.monotonic()
  try:
   remaining=deadline-time.monotonic()
   if remaining<=0:raise TimeoutError('ProbeDeadlineExceeded')
   if url.startswith('tcp://'):
    address,port=url[6:].rsplit(':',1)
    with socket.create_connection((address,int(port)),timeout=min(4,remaining)):item['status']=200
   else:
    with opener.open(url,timeout=min(4,remaining)) as response:item['status']=response.status
  except urllib.error.HTTPError as e:item['status']=e.code
  except (OSError,ValueError) as e:item['status']=0;item['error']=type(e).__name__
  item['ok']=200<=item['status']<300;item['durationMs']=round((time.monotonic()-start)*1000);http.append(item)
paths=[]
for s in services:
 path=s.get('workingDirectory')
 if path:paths.append({'id':s['id'],'path':path,'exists':os.path.isdir(path),'resolved':os.path.realpath(path)})
disk=shutil.disk_usage('/');versions={}
for name,args in {'bun':['--version'],'rustc':['--version'],'uv':['--version'],'git':['--version']}.items():
 if shutil.which(name):versions[name]=run([name]+args)
clusters=run(['pg_lsclusters','--json'])
try:clusters['clusters']=json.loads(clusters.pop('stdout','[]') or '[]') if clusters['exitCode']==0 else []
except ValueError:clusters['clusters']=[];clusters['error']='InvalidClusterJSON'
userUnits=[unit(name,True) for name in ['aphrody-kernel.service','aphrody-web.service']] if ${host === "wsl" ? "True" : "False"} else []
print(json.dumps({'observedAt':datetime.now(timezone.utc).isoformat(),'hostname':socket.gethostname(),'kernel':platform.release(),'load':os.getloadavg(),'disk':{'totalBytes':disk.total,'freeBytes':disk.free,'usedPercent':round(disk.used/disk.total*100,1)},'units':units,'userUnits':userUnits,'failedUnits':failed,'health':http,'paths':paths,'versions':versions,'postgresql':clusters,'postgresqlReady':run(['pg_isready','-t','3']),'redis':run(['redis-cli','ping'])}))
`;
  return `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(python).toString("base64")}"))'`;
}

export async function sourceInventory(root: string) {
  const manifests = TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as Manifest;
  const members = new Set<string>();
  const exclusions = (manifests.workspace?.exclude ?? []).map(pattern => new Bun.Glob(pattern));
  for (const pattern of manifests.workspace?.members ?? [])
    for await (const path of new Bun.Glob(`${pattern}/Cargo.toml`).scan({
      cwd: root,
      onlyFiles: true,
    })) {
      const directory = path.slice(0, -"/Cargo.toml".length);
      if (!exclusions.some(glob => glob.match(directory))) members.add(directory);
    }
  const crates = [];
  for (const path of [...members].toSorted()) {
    const text = await Bun.file(join(root, path, "Cargo.toml")).text();
    const manifest = TOML.parse(text) as Manifest;
    crates.push({
      path,
      name: manifest.package?.name,
      version: manifest.package?.version,
      manifestSha256: sha256(text),
      features: manifest.features ?? {},
      qualification: "manifest-parsed; source compilation/tests/features excluded",
    });
  }
  const infraSources: SourceProof[] = [];
  const transpiler = new Transpiler({ loader: "ts" });
  for (const family of ["crates/infra", "packages/infra"])
    for await (const path of new Bun.Glob(`${family}/**/*.{ts,tsx,js,rs}`).scan({
      cwd: root,
      onlyFiles: true,
    })) {
      if (/\/(?:node_modules|dist|target|docs)\//.test(path) || path.endsWith(".d.ts")) continue;
      const text = await Bun.file(join(root, path)).text();
      const rust = path.endsWith(".rs");
      const proof: SourceProof = {
        path,
        sha256: sha256(text),
        syntax: rust ? "not-executed" : "parsed",
        tests: rust
          ? (text.match(/#\[test\]|#\[tokio::test[^\]]*\]/g) ?? []).length
          : (text.match(/\b(?:test|it)\s*(?:\.\w+)?\s*\(/g) ?? []).length,
      };
      if (rust) proof.cfg = [...text.matchAll(/#\[cfg\(([^\n]+)\)\]/g)].map(match => match[1]!);
      else
        try {
          const parser = path.endsWith(".tsx") ? new Transpiler({ loader: "tsx" }) : transpiler;
          parser.transformSync(text);
          proof.imports = parser.scan(text).imports.map(entry => entry.path);
        } catch (error) {
          proof.syntax = "failed";
          proof.error = String(error);
        }
      infraSources.push(proof);
    }
  const scripts = [];
  for await (const path of new Bun.Glob("scripts/**/*.{sh,ts,mts,cts,js,mjs,cjs,py,nu,ps1}").scan({
    cwd: root,
    onlyFiles: true,
  })) {
    const text = await Bun.file(join(root, path)).text();
    const proof: {
      path: string;
      sha256: string;
      qualification: string;
      heavyAdapter: boolean;
      error?: string;
    } = {
      path,
      sha256: sha256(text),
      qualification: "inventoried; not executed automatically",
      heavyAdapter: /cargo\s+(?:build|check|test|clippy|run)|next\s+build|playwright|crawl/i.test(text),
    };
    if (/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(path)) {
      try {
        transpiler.transformSync(text);
        transpiler.scan(text);
        proof.qualification = "syntax-parsed; adapter not executed";
      } catch (error) {
        proof.qualification = "syntax-failed";
        proof.error = String(error);
      }
    } else if (path.endsWith(".sh") || path.endsWith(".py")) {
      const command = path.endsWith(".sh")
        ? ["bash", "-n", join(root, path)]
        : [
            "python3",
            "-c",
            "import ast,pathlib,sys;ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig'))",
            join(root, path),
          ];
      const result = await observeCommand(`Syntax ${path}`, command, root, 10_000);
      proof.qualification = result.exitCode === 0 ? "syntax-parsed; adapter not executed" : "syntax-failed";
      if (result.exitCode !== 0) proof.error = result.error ?? result.stderr.slice(-1000);
    } else proof.qualification = "inventoried; optional Nushell/PowerShell parser not executed";
    scripts.push(proof);
  }
  return {
    crates,
    infraSources: infraSources.toSorted((a, b) => a.path.localeCompare(b.path)),
    scripts,
  };
}

export async function runInfraAudit(args: string[]): Promise<number> {
  let root = process.cwd(),
    output = "",
    evidence = "",
    gateReport = "";
  let live = false,
    run = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--root", "--output", "--evidence", "--gate-report"].includes(arg ?? "")) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--root") root = value;
      else if (arg === "--output") output = value;
      else if (arg === "--evidence") evidence = value;
      else gateReport = value;
    } else if (arg === "--live") live = true;
    else if (arg === "--run") run = true;
    else if (arg === "--help") {
      console.log(
        "Usage: yolo ops infra-audit [--root path] [--run] [--live] [--output report.json] [--evidence private-directory] [--gate-report prior-report.json]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (run && gateReport) throw new Error("--run and --gate-report are mutually exclusive");
  root = await realpath(resolve(root));
  if (!evidence) throw new Error("--evidence requires a private directory for raw runtime evidence");
  evidence = resolve(evidence);
  if (!evidenceOutsideRoot(root, evidence)) throw new Error("Raw evidence must stay outside the repository");
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  evidence = await realpath(evidence);
  if (!evidenceOutsideRoot(root, evidence)) throw new Error("Raw evidence resolves inside the repository");
  await chmod(evidence, 0o700);
  const observations: Array<
    Omit<Observation, "stdout" | "stderr"> & {
      stdoutSha256: string;
      stderrSha256: string;
      required: boolean;
    }
  > = [];
  async function observe(name: string, command: string[], cwd = root, timeout = 120_000, required = true) {
    console.error(`Infra audit: ${name}`);
    const result = await observeCommand(name, command, cwd, timeout);
    const id = String(observations.length + 1).padStart(3, "0");
    await Bun.write(join(evidence, `${id}.stdout`), result.stdout);
    await Bun.write(join(evidence, `${id}.stderr`), result.stderr);
    const { stdout, stderr, ...summary } = result;
    observations.push({
      ...summary,
      required,
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(stderr),
    });
    return result;
  }
  const inventory = await sourceInventory(root);
  const sourceState = await observeCommand("Git source provenance", ["git", "status", "--porcelain=v1"], root);
  const sourceHead = await observeCommand("Git source HEAD", ["git", "rev-parse", "HEAD"], root);
  const plan = await discoverMonorepoGatePlan(root, undefined, true);
  const fleet = await loadFleet(root);
  const pipeline = await pipelineCatalog(root);
  const gate = run
    ? await executeMonorepoGate(
        plan,
        async (check: GateCheck) => (await observe(check.name, check.command, check.cwd)).exitCode ?? 1,
      )
    : undefined;
  const priorGate = gateReport ? await Bun.file(resolve(gateReport)).json() : undefined;
  if (priorGate && resolve(priorGate.root ?? "") !== root) throw new Error("Gate report belongs to another root");
  const gateEvidence = gateReport
    ? {
        path: resolve(gateReport),
        sha256: sha256(await Bun.file(resolve(gateReport)).bytes()),
        qualification: "supplied prior gate execution; source changes since that run require scoped revalidation",
        ...classifyGateEvidence(priorGate, plan.checks),
      }
    : null;
  const services = (await Bun.file(join(root, "infra/config/service-catalog.json")).json()).services as Service[];
  const hosts: Record<string, unknown> = {};
  const hostQualifications: Record<string, HostQualification> = {};
  if (live) {
    const binary = await infraExecutable(root, {
      ...process.env,
      APHRODY_INFRA_BUILD_FROM_SOURCE: "0",
    });
    for (const commandArgs of [
      ["validate", "--json"],
      ["doctor", "--strict", "--json"],
      ["git", "--repo", root, "--json"],
      ["quality", "plan", "--json"],
      ["pipeline", "--stage", "plan", "--json"],
    ])
      await observe(`Native ${commandArgs.slice(0, 2).join(" ")}`, [...binary, "--root", root, ...commandArgs]);
    await observe(
      "Native VPN status (optional WSL capability)",
      [...binary, "--root", root, "vpn", "status", "--json"],
      root,
      120_000,
      false,
    );
    await observe("Native YOLO doctor", [
      join(process.env.HOME ?? "", ".local/bin/aphrody-yolo"),
      "--root",
      root,
      "--json",
      "doctor",
    ]);
    // OVH belongs to the Rust Infra owner (`aphrody ovh` = `aphrody infra ovh`).
    await observe("Native OVH profiles", [...binary, "--root", root, "ovh", "profiles"]);
    for (const profile of ["aphrody.com"])
      await observe(
        `Native OVH API ${profile}`,
        [...binary, "--root", root, "ovh", "status", "--profile", profile],
        root,
        45_000,
      );
    for (const commandArgs of [
      ["workspace-layout"],
      ["docs-gen", "--root", root, "--check", "--skip-ecosystem"],
      ["bun-workspace", "--json"],
      ["automation-inventory", "--root", root, "--json"],
      ["repository-state", "--root", root, "--json"],
      ["imports-exports", "--json"],
    ])
      await observe(`Bun ${commandArgs[0]}`, [
        process.execPath,
        "packages/yolo-cli/src/index.ts",
        "ops",
        ...commandArgs,
      ]);
    await observe("Infra source/config contracts", [process.execPath, "scripts/aphrody/tools/infra/check-infra.ts"]);
    for (const host of ["wsl", "vps", "dbfr"] as const) {
      const command = hostProbeCommand(host, services);
      const result = await observe(
        `Live ${host}`,
        host === "wsl"
          ? ["bash", "-c", command]
          : [
              join(process.env.HOME ?? "", ".local/bin/aphrody-ssh"),
              "--json",
              "exec",
              "--host",
              host,
              "--cmd",
              command,
            ],
        root,
      );
      try {
        const envelope = JSON.parse(result.stdout);
        hosts[host] = typeof envelope.stdout === "string" ? JSON.parse(envelope.stdout) : envelope;
      } catch {
        hosts[host] = {
          observed: false,
          exitCode: result.exitCode,
          evidence: observations.length,
        };
      }
      hostQualifications[host] = qualifyHost(host, hosts[host] as HostSnapshot, services, result.exitCode);
    }
  }
  const bunManifests = await Promise.all(
    plan.packages
      .toSorted((a, b) => a.path.localeCompare(b.path))
      .map(async pkg => ({
        path: `${pkg.path}/package.json`,
        sha256: sha256(await Bun.file(join(root, pkg.path, "package.json")).bytes()),
      })),
  );
  const controlFiles = [];
  for (const path of [
    "Cargo.toml",
    "Cargo.lock",
    "package.json",
    "bun.lock",
    "infra/config/service-catalog.json",
    "config/fleet.json",
    "infra/config/pipeline.json",
  ]) {
    const file = Bun.file(join(root, path));
    if (await file.exists()) controlFiles.push({ path, sha256: sha256(await file.bytes()) });
  }
  const sourceFingerprint = sha256(
    JSON.stringify({
      controlFiles,
      crates: inventory.crates.map(crate => [crate.path, crate.manifestSha256]),
      bunManifests,
      infraSources: inventory.infraSources.map(source => [source.path, source.sha256]),
      scripts: inventory.scripts
        .toSorted((a, b) => a.path.localeCompare(b.path))
        .map(script => [script.path, script.sha256]),
    }),
  );
  const requiredFailures = observations.filter(item => item.required && item.exitCode !== 0).map(item => item.name);
  const failedHosts = Object.entries(hostQualifications)
    .filter(([, qualification]) => !qualification.healthy)
    .map(([host]) => host);
  const failed =
    sourceHead.exitCode !== 0 ||
    sourceState.exitCode !== 0 ||
    requiredFailures.length > 0 ||
    failedHosts.length > 0 ||
    inventory.infraSources.some(item => item.syntax === "failed") ||
    inventory.scripts.some(item => item.qualification === "syntax-failed") ||
    Boolean(gate?.results.some(item => item.status === "failed"));
  const incomplete = !gate || !live || !gate.passed || plan.gaps.length > 0 || Boolean(plan.deferred?.length);
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    root,
    source: {
      head: sourceHead.stdout.trim(),
      dirty: Boolean(sourceState.stdout.trim()),
      statusSha256: sha256(sourceState.stdout),
      observedAt: sourceState.startedAt,
      inventorySha256: sourceFingerprint,
      bunManifests,
      controlFiles,
    },
    restrictions: {
      cargoCompilation: false,
      nextBuild: false,
      browsers: false,
      crawlers: false,
      liveMutations: false,
      rustSourceExecution: "Excluded; installed binaries do not qualify changed Rust source",
    },
    inventory,
    fleet,
    pipeline,
    plan,
    gate,
    gateEvidence,
    observations,
    hosts,
    hostQualifications,
    qualification: {
      status: failed ? "failed" : incomplete ? "incomplete" : "passed",
      requiredFailures,
      failedHosts,
      optionalFailures: observations.filter(item => !item.required && item.exitCode !== 0).map(item => item.name),
      currentGateExecuted: Boolean(gate),
      liveHostsObserved: live,
      historicalGateQualifiesCurrentSource: false,
    },
    coverage: {
      rustCrates: inventory.crates.length,
      infraRustCrates: inventory.crates.filter(c => c.path.startsWith("crates/infra/")).length,
      bunPackages: plan.packages.length,
      infraSourceFiles: inventory.infraSources.length,
      scripts: inventory.scripts.length,
      unexecutedChecks: plan.deferred?.length,
      missingGates: plan.gaps.length,
    },
    deploymentQualified: false,
    limits: [
      "Manifest/features/module inventory is not runtime coverage",
      "Only reviewed leaf gates are executed",
      "Native Rust tests/features/GPU inference and release builds excluded",
      "Snapshots do not qualify the current source as the deployed release",
    ],
  };
  if (output) await Bun.write(resolve(output), JSON.stringify(report, null, 2) + "\n");
  else console.log(JSON.stringify(report, null, 2));
  return failed || incomplete ? 1 : 0;
}

if (import.meta.main) process.exit(await runInfraAudit(process.argv.slice(2)));
