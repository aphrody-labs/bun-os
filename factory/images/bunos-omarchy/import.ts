// SPDX-License-Identifier: MIT
// Materialize a verified official Omarchy rootfs as a Docker ADD layer input.
// This is a Linux VPS operation; it never builds or starts a container.
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

type Asset = {
  file: string;
  sha256: string;
  maxBytes?: number;
  sizeBytes?: number;
  expandedSha256?: string;
  expandedSizeBytes?: number;
};
type GuestInputs = {
  schemaVersion: number;
  release: {
    baseUrl: string;
    repository: string;
    tag: string;
    revision: string;
  };
  guestBuilder: { repository: string; revision: string; branch: string };
  omarchy: { repository: string; revision: string; version: string };
  assets: {
    guestManifest: Asset;
    packagesLock: Asset;
    rootfs: Asset;
  };
  limits: {
    downloadTimeoutSeconds: number;
    decompressionTimeoutSeconds: number;
    mountTimeoutSeconds: number;
    tarTimeoutSeconds: number;
    maxParallelJobs: number;
  };
};

const here = import.meta.dir;
const inputs = (await Bun.file(`${here}/guest-inputs.json`).json()) as GuestInputs;
const mebibyte = 1024 * 1024;
const gibibyte = 1024 * mebibyte;

async function sha256File(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function canonicalDirectory(path: string) {
  if (!isAbsolute(path)) throw new Error(`Expected an absolute path: ${path}`);
  const proc = Bun.spawn(["realpath", "-e", "--", path], {
    stdout: "pipe",
    stderr: "inherit",
    timeout: 10_000,
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout!).text(), proc.exited]);
  if (code !== 0) throw new Error(`Cannot resolve build directory: ${path}`);
  const result = stdout.trim();
  const stat = await Bun.file(result).stat();
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${path}`);
  return result;
}

async function run(argv: string[], timeoutSeconds: number, capture = false) {
  const proc = Bun.spawn(["timeout", "--signal=TERM", `${timeoutSeconds}s`, ...argv], {
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const output = capture ? await new Response(proc.stdout!).text() : "";
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${argv[0]} failed with exit code ${code}`);
  return output;
}

async function removeTemporary(path: string) {
  if (!(await Bun.file(path).exists())) return;
  const proc = Bun.spawn(["rm", "-f", "--", path], { stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error(`Could not remove ${path}`);
}

async function downloadAsset(asset: Asset, destination: string) {
  const finalPath = resolve(destination, asset.file);
  if (await Bun.file(finalPath).exists()) {
    const file = Bun.file(finalPath);
    const stat = await file.stat();
    const actual = await sha256File(finalPath);
    if ((asset.sizeBytes !== undefined && stat.size !== asset.sizeBytes) || actual !== asset.sha256)
      throw new Error(`Existing pinned source has wrong size or digest: ${finalPath}`);
    return {
      path: finalPath,
      sizeBytes: stat.size,
      sha256: actual,
      cached: true,
    };
  }

  const partPath = `${finalPath}.part`;
  if (await Bun.file(partPath).exists()) throw new Error(`Refusing to overwrite incomplete source state: ${partPath}`);
  const url = new URL(asset.file, inputs.release.baseUrl).href;
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(inputs.limits.downloadTimeoutSeconds * 1000),
    headers: { Accept: "application/octet-stream" },
  });
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const sourceHost = new URL(response.url).hostname;
  if (sourceHost !== "github.com" && sourceHost !== "release-assets.githubusercontent.com") {
    await response.body.cancel();
    throw new Error(`Unexpected release download host: ${sourceHost}`);
  }
  const byteLimit = asset.sizeBytes ?? asset.maxBytes;
  if (!byteLimit) throw new Error(`No download bound is declared for ${asset.file}`);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > byteLimit)
    throw new Error(`${asset.file} exceeds its declared download bound`);
  let count = 0;
  const boundedBody = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        count += chunk.byteLength;
        if (count > byteLimit) throw new Error(`${asset.file} exceeded its ${byteLimit}-byte download bound`);
        controller.enqueue(chunk);
      },
    }),
  );
  try {
    await Bun.write(partPath, boundedBody);
    const actual = await sha256File(partPath);
    const sizeBytes = (await Bun.file(partPath).stat()).size;
    if (actual !== asset.sha256 || (asset.sizeBytes !== undefined && sizeBytes !== asset.sizeBytes))
      throw new Error(`${asset.file} failed integrity verification (size ${sizeBytes}, sha256 ${actual})`);
    await run(["mv", "-T", "--", partPath, finalPath], 10);
    return { path: finalPath, sizeBytes, sha256: actual, cached: false };
  } catch (error) {
    await removeTemporary(partPath);
    throw error;
  }
}

function assertNoExistingOutputs(paths: string[]) {
  return Promise.all(
    paths.map(async path => {
      if (await Bun.file(path).exists()) throw new Error(`Refusing to overwrite build output: ${path}`);
    }),
  );
}

async function ensureDiskSpace(path: string) {
  const output = await run(["df", "-Pk", "--", path], 10, true);
  const lines = output.trim().split("\n");
  const fields = lines.at(-1)?.trim().split(/\s+/) ?? [];
  const availableKiB = Number(fields[3]);
  const required = 3 * inputs.assets.rootfs.expandedSizeBytes! + inputs.assets.rootfs.sizeBytes! + gibibyte;
  if (!Number.isFinite(availableKiB) || availableKiB * 1024 < required)
    throw new Error(
      `Insufficient free space: need at least ${required} bytes for verified rootfs expansion, tar, and Docker layer`,
    );
}

function containerfile() {
  return [
    "# syntax=docker/dockerfile:1.7",
    "# Imported official Omarchy rootfs; source identity is embedded below.",
    "FROM scratch AS imported-rootfs",
    "ADD import/rootfs.tar /",
    "COPY --chmod=0644 import/guest-manifest.json /usr/share/doc/bun-os-omarchy/guest-manifest.json",
    "COPY --chmod=0644 import/packages.lock.txt /usr/share/doc/bun-os-omarchy/packages.lock.txt",
    "COPY --chmod=0644 import/import-receipt.json /usr/share/doc/bun-os-omarchy/import-receipt.json",
    "COPY --chmod=0644 import/NOTICES.md /usr/share/doc/bun-os-omarchy/NOTICES.md",
    'LABEL org.opencontainers.image.source="https://github.com/omacom/omarchy"',
    'LABEL org.bun-os.omarchy.source-state="unqualified"',
    "ENV HOME=/root TERM=xterm-256color",
    "WORKDIR /root",
    'CMD ["/bin/bash", "--login"]',
    "",
    "# Shell-only conversion target; graphical support remains unqualified.",
    "FROM imported-rootfs AS c2w-terminal",
    "ENV BUNOS_C2W_TERMINAL=1",
    "",
  ].join("\n");
}

/** Download, verify and safely archive the official guest into a fresh image context. */
export async function prepareOmarchyRootfsImport(workspaceInput: string, allowedRootInput: string) {
  if (inputs.schemaVersion !== 1) throw new Error("Unsupported guest input schema");
  const allowedRoot = await canonicalDirectory(allowedRootInput);
  const workspace = await canonicalDirectory(workspaceInput);
  const rel = relative(allowedRoot, workspace);
  if (!rel || rel === "." || rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(sep) || isAbsolute(rel))
    throw new Error("Import workspace must be a direct child of the private factory build root");
  if (basename(workspace).length < 8)
    throw new Error("Import workspace does not look like a generated factory job directory");

  const contextDir = resolve(workspace, "context");
  if (
    !(await Bun.file(contextDir)
      .stat()
      .then(stat => stat.isDirectory())
      .catch(() => false))
  )
    throw new Error(`Expected an existing Docker context directory: ${contextDir}`);
  const importDir = resolve(contextDir, "import");
  const sourceDir = resolve(workspace, "omarchy-source-v0.12.0");
  await run(["mkdir", "-p", "--", importDir], 10);
  await run(["mkdir", "-p", "--", sourceDir], 10);

  const outputTar = resolve(importDir, "rootfs.tar");
  const partialTar = `${outputTar}.part`;
  const expanded = resolve(workspace, "omarchy-rootfs.ext4");
  const mountDir = resolve(workspace, "omarchy-rootfs-mount");
  const receiptPath = resolve(importDir, "import-receipt.json");
  await assertNoExistingOutputs([outputTar, partialTar, expanded, receiptPath]);
  await run(["mkdir", "-p", "--", mountDir], 10);

  let mounted = false;
  const failures: unknown[] = [];
  let result:
    | {
        context: string;
        containerfile: string;
        receipt: Record<string, unknown>;
      }
    | undefined;
  try {
    await ensureDiskSpace(workspace);
    const downloaded = {
      guestManifest: await downloadAsset(inputs.assets.guestManifest, sourceDir),
      packagesLock: await downloadAsset(inputs.assets.packagesLock, sourceDir),
      rootfs: await downloadAsset(inputs.assets.rootfs, sourceDir),
    };
    const manifestData = await Bun.file(downloaded.guestManifest.path).json();
    if (!manifestData || typeof manifestData !== "object")
      throw new Error("Verified guest manifest is not a JSON object");

    await run(
      ["zstd", "--decompress", "--memory=512MB", "--force", "-o", expanded, downloaded.rootfs.path],
      inputs.limits.decompressionTimeoutSeconds,
    );
    const expandedStat = await Bun.file(expanded).stat();
    const expandedDigest = await sha256File(expanded);
    if (
      expandedStat.size !== inputs.assets.rootfs.expandedSizeBytes ||
      expandedDigest !== inputs.assets.rootfs.expandedSha256
    )
      throw new Error(`Expanded ext4 integrity mismatch (size ${expandedStat.size}, sha256 ${expandedDigest})`);

    await run(
      ["sudo", "-n", "mount", "-o", "loop,ro,noload,nodev,nosuid", "--", expanded, mountDir],
      inputs.limits.mountTimeoutSeconds,
    );
    mounted = true;
    await run(
      [
        "sudo",
        "-n",
        "tar",
        "--create",
        `--file=${partialTar}`,
        "--directory",
        mountDir,
        "--numeric-owner",
        "--xattrs",
        "--xattrs-include=*",
        "--acls",
        "--selinux",
        "--sparse",
        "--one-file-system",
        ".",
      ],
      inputs.limits.tarTimeoutSeconds,
    );
    await run(["sudo", "-n", "umount", "--", mountDir], 30);
    mounted = false;

    const partialStat = await Bun.file(partialTar).stat();
    if (partialStat.size === 0) throw new Error("Imported rootfs archive is empty");
    const partialSha256 = await sha256File(partialTar);
    await run(["mv", "-T", "--", partialTar, outputTar], 10);
    await removeTemporary(expanded);

    const tarStat = await Bun.file(outputTar).stat();
    const tarSha256 = await sha256File(outputTar);
    if (tarStat.size !== partialStat.size || tarSha256 !== partialSha256)
      throw new Error("Final Docker archive changed during atomic publication");
    const receipt = {
      schemaVersion: 1,
      state: "unqualified",
      createdAt: new Date().toISOString(),
      release: inputs.release,
      guestBuilder: inputs.guestBuilder,
      omarchy: inputs.omarchy,
      assets: {
        guestManifest: {
          sha256: downloaded.guestManifest.sha256,
          sizeBytes: downloaded.guestManifest.sizeBytes,
        },
        packagesLock: {
          sha256: downloaded.packagesLock.sha256,
          sizeBytes: downloaded.packagesLock.sizeBytes,
        },
        compressedRootfs: {
          sha256: downloaded.rootfs.sha256,
          sizeBytes: downloaded.rootfs.sizeBytes,
        },
        expandedRootfs: {
          sha256: expandedDigest,
          sizeBytes: expandedStat.size,
        },
        dockerArchive: { sha256: tarSha256, sizeBytes: tarStat.size },
      },
      packageLockDigestVerified: true,
      packageClosureOrigin: "verified official v0.12.0 package-lock asset",
      repositorySignaturesRecheckedDuringImport: false,
      importedAsBunOsUsr: false,
      desktopQualified: false,
      browserQualified: false,
      resourcePolicy: {
        maxParallelJobs: inputs.limits.maxParallelJobs,
        sharedFactoryLockRequired: true,
      },
      importMethod:
        "read-only ext4 loop mount; GNU tar numeric owners, xattrs, ACLs, SELinux labels, sparse files and hard links",
      imageCommand: ["/bin/bash", "--login"],
    };
    await Bun.write(resolve(importDir, "guest-manifest.json"), Bun.file(downloaded.guestManifest.path));
    await Bun.write(resolve(importDir, "packages.lock.txt"), Bun.file(downloaded.packagesLock.path));
    await Bun.write(resolve(importDir, "NOTICES.md"), Bun.file(`${here}/NOTICES.md`));
    await Bun.write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await Bun.write(resolve(contextDir, "import.Containerfile"), containerfile());
    result = {
      context: contextDir,
      containerfile: resolve(contextDir, "import.Containerfile"),
      receipt,
    };
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (mounted) await run(["sudo", "-n", "umount", "--", mountDir], 30);
      await run(["rmdir", "--", mountDir], 10);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Omarchy rootfs import failed");
  if (!result) throw new Error("Omarchy import did not produce a receipt");
  return result;
}

if (import.meta.main) {
  const [action, workspace, allowedRoot] = Bun.argv.slice(2);
  if (action !== "prepare" || !workspace || !allowedRoot)
    throw new Error("Usage: bun import.ts prepare <factory-job-dir> <private-factory-build-root>");
  console.log(JSON.stringify(await prepareOmarchyRootfsImport(workspace, allowedRoot), null, 2));
}
