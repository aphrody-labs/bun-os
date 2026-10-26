// SPDX-License-Identifier: Apache-2.0
/** Origin CA bootstrap. Private key bytes never leave the protected owner store. */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";

const store = "/etc/aphrody/shenron-tls/live/dragonballfr-game";
const hosts = ["play.dragonballfr.com", "game-api.dragonballfr.com"];
function openssl(args: string[]) {
  const run = Bun.spawnSync(["openssl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0)
    throw new Error("Origin certificate validation failed");
  return new TextDecoder().decode(run.stdout);
}
function regular(path: string) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
    throw new Error("Regular owner file required");
}

export async function originTls(
  operation: "init" | "install",
  certificate?: string,
) {
  if (process.getuid?.() !== 0) throw new Error("Root owner required");
  process.umask(0o077);
  const parent = "/etc/aphrody/shenron-tls";
  if (realpathSync(parent) !== parent)
    throw new Error("TLS store must not be symlinked");
  const live = resolve(parent, "live");
  mkdirSync(live, { recursive: true, mode: 0o700 });
  if (realpathSync(live) !== live)
    throw new Error("TLS live store must not be symlinked");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  if (realpathSync(store) !== store)
    throw new Error("TLS lineage must not be symlinked");
  chmodSync(store, 0o700);
  const key = resolve(store, "privkey.pem");
  const request = resolve(store, "request.csr.pem");
  if (operation === "init") {
    if (!existsSync(key))
      openssl([
        "genpkey",
        "-algorithm",
        "RSA",
        "-pkeyopt",
        "rsa_keygen_bits:2048",
        "-out",
        key,
      ]);
    regular(key);
    if ((lstatSync(key).mode & 0o777) !== 0o600)
      throw new Error("Private key must be mode0600");
    if (existsSync(request)) regular(request);
    openssl([
      "req",
      "-new",
      "-key",
      key,
      "-out",
      request,
      "-subj",
      "/CN=play.dragonballfr.com",
      "-addext",
      "subjectAltName=" + hosts.map((h) => "DNS:" + h).join(","),
    ]);
    return { csr: await Bun.file(request).text(), hosts };
  }
  if (!certificate) throw new Error("Public certificate file required");
  regular(certificate);
  regular(key);
  if ((lstatSync(key).mode & 0o777) !== 0o600)
    throw new Error("Private key must be mode0600");
  for (const host of hosts)
    openssl(["x509", "-in", certificate, "-noout", "-checkhost", host]);
  openssl(["x509", "-in", certificate, "-noout", "-checkend", "86400"]);
  if (
    openssl(["x509", "-in", certificate, "-pubkey", "-noout"]) !==
    openssl(["pkey", "-in", key, "-pubout"])
  ) {
    throw new Error("Certificate does not match the protected key");
  }
  const destination = resolve(store, "fullchain.pem");
  if (existsSync(destination))
    throw new Error("An installed certificate must not be replaced silently");
  const staged = resolve(store, ".fullchain.stage.pem");
  if (existsSync(staged))
    throw new Error("Certificate staging file already exists");
  await Bun.write(staged, await Bun.file(certificate).bytes());
  chmodSync(staged, 0o644);
  renameSync(staged, destination);
  return {
    hosts,
    store,
    certificate: openssl([
      "x509",
      "-in",
      destination,
      "-noout",
      "-subject",
      "-issuer",
      "-dates",
      "-ext",
      "subjectAltName",
    ]),
    privateKeyMode: "0600",
  };
}

if (import.meta.main) {
  const [operation, certificate] = Bun.argv.slice(2);
  if (operation !== "init" && operation !== "install")
    throw new Error(
      "Usage: shenron-game-origin-tls.ts init|install [PUBLIC_CERT]",
    );
  console.log(JSON.stringify(await originTls(operation, certificate)));
}
