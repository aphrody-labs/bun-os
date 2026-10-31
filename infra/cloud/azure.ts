#!/usr/bin/env bun
// Idempotent Azure recipe for azure.json: resource group, storage account + containers, container registry and the
// "Bun OS" Microsoft Graph app registration (client secret stored in GCP Secret Manager, never printed).
//   bun infra/cloud/azure.ts            dry run (needs `az login`)
//   bun infra/cloud/azure.ts --apply    create what is missing
// One-time owner step on the host: `az login --use-device-code` (the owner confirms in their browser).
import { join } from "node:path";

interface Recipe {
  location: string;
  resourceGroup: string;
  storage: { account: string; sku: string; kind: string; containers: string[]; allowBlobPublicAccess: boolean };
  containerRegistry: { name: string; sku: string };
  graphApp: {
    displayName: string;
    signInAudience: string;
    redirectUris: { web: string[]; publicClient: string[] };
    delegatedPermissions: string[];
  };
}

const apply = process.argv.includes("--apply");
const r: Recipe = await Bun.file(join(import.meta.dir, "azure.json")).json();
const GRAPH = "00000003-0000-0000-c000-000000000000";

async function run(cmd: string[], input?: string) {
  const p = Bun.spawn(cmd, {
    stdin: input === undefined ? "ignore" : new Response(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return {
    code,
    out: out.trim(),
    err: err
      .trim()
      .split("\n")
      .filter(l => !l.startsWith("WARNING"))
      .join(" "),
  };
}
const az = (...a: string[]) => run(["az", ...a, "--only-show-errors", "-o", "tsv"]);

const acct = await az("account", "show", "--query", "name");
if (acct.code !== 0) {
  console.error("az is not signed in. One-time owner step on this host: az login --use-device-code");
  process.exit(2);
}
console.log(`subscription: ${acct.out}`);
let failed = false;
async function ensure(label: string, probe: string[], create: string[]) {
  if ((await az(...probe)).code === 0) return console.log(`${label}: present`);
  if (!apply) return console.log(`${label}: missing (--apply creates it)`);
  const c = await az(...create);
  console.log(`${label}: ${c.code === 0 ? "created" : `failed: ${c.err}`}`);
  failed ||= c.code !== 0;
}

await ensure(
  `resource group ${r.resourceGroup}`,
  ["group", "show", "-n", r.resourceGroup],
  ["group", "create", "-n", r.resourceGroup, "-l", r.location],
);
const s = r.storage;
await ensure(
  `storage ${s.account}`,
  ["storage", "account", "show", "-n", s.account, "-g", r.resourceGroup],
  [
    "storage",
    "account",
    "create",
    "-n",
    s.account,
    "-g",
    r.resourceGroup,
    "-l",
    r.location,
    "--sku",
    s.sku,
    "--kind",
    s.kind,
    "--allow-blob-public-access",
    String(s.allowBlobPublicAccess),
    "--min-tls-version",
    "TLS1_2",
  ],
);
for (const c of s.containers)
  await ensure(
    `  container ${c}`,
    ["storage", "container", "show", "-n", c, "--account-name", s.account, "--auth-mode", "login"],
    ["storage", "container", "create", "-n", c, "--account-name", s.account, "--auth-mode", "login"],
  );
const cr = r.containerRegistry;
await ensure(
  `registry ${cr.name}`,
  ["acr", "show", "-n", cr.name, "-g", r.resourceGroup],
  ["acr", "create", "-n", cr.name, "-g", r.resourceGroup, "--sku", cr.sku, "-l", r.location],
);

// Graph app registration.
const g = r.graphApp;
const found = await az("ad", "app", "list", "--display-name", g.displayName, "--query", "[0].appId");
let appId = found.code === 0 ? found.out : "";
if (!appId) {
  if (!apply) console.log(`graph app "${g.displayName}": missing (--apply creates it)`);
  else {
    const c = await az(
      "ad",
      "app",
      "create",
      "--display-name",
      g.displayName,
      "--sign-in-audience",
      g.signInAudience,
      "--web-redirect-uris",
      ...g.redirectUris.web,
      "--public-client-redirect-uris",
      ...g.redirectUris.publicClient,
      "--query",
      "appId",
    );
    appId = c.code === 0 ? c.out : "";
    console.log(`graph app "${g.displayName}": ${appId ? "created" : `failed: ${c.err}`}`);
    failed ||= !appId;
  }
} else console.log(`graph app "${g.displayName}": present (${appId})`);

if (apply && appId) {
  // Delegated Graph permissions by name -> scope ids from the Graph service principal.
  const sp = await run([
    "az",
    "ad",
    "sp",
    "show",
    "--id",
    GRAPH,
    "--query",
    "oauth2PermissionScopes[].{id:id,value:value}",
    "-o",
    "json",
    "--only-show-errors",
  ]);
  const scopes: { id: string; value: string }[] = sp.code === 0 ? JSON.parse(sp.out) : [];
  const ids = g.delegatedPermissions
    .map(n => scopes.find(x => x.value === n)?.id)
    .filter(Boolean)
    .map(id => `${id}=Scope`);
  if (ids.length) {
    const p = await az("ad", "app", "permission", "add", "--id", appId, "--api", GRAPH, "--api-permissions", ...ids);
    console.log(`  delegated permissions: ${p.code === 0 ? ids.length : `failed: ${p.err}`}`);
  }
  // Client secret straight into GCP Secret Manager (stdin), never printed.
  const have = await run(["gcloud", "secrets", "describe", "MICROSOFT_GRAPH_CLIENT_SECRET", "--project", "aphrody"]);
  if (have.code !== 0) {
    const sec = await az(
      "ad",
      "app",
      "credential",
      "reset",
      "--id",
      appId,
      "--display-name",
      "bun-os-backend",
      "--years",
      "2",
      "--query",
      "password",
    );
    if (sec.code === 0 && sec.out) {
      for (const [name, value] of [
        ["MICROSOFT_GRAPH_CLIENT_ID", appId],
        ["MICROSOFT_GRAPH_CLIENT_SECRET", sec.out],
        ["MICROSOFT_GRAPH_TENANT", "common"],
      ] as const) {
        const w = await run(
          [
            "gcloud",
            "secrets",
            "create",
            name,
            "--project",
            "aphrody",
            "--replication-policy=automatic",
            "--data-file=-",
          ],
          value,
        );
        console.log(`  secret ${name}: ${w.code === 0 ? "stored" : `failed: ${w.err}`}`);
      }
    } else console.log(`  client secret: failed: ${sec.err}`);
  } else console.log("  secret MICROSOFT_GRAPH_CLIENT_SECRET: present");
}
process.exit(failed ? 1 : 0);
