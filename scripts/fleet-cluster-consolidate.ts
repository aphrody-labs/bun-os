import fleetToml from "../infra/fleet/fleet.toml";

const FACTORY_HOSTS = ["vps", "bunos", "prod"];

async function sshRun(host: string, command: string) {
  const p = Bun.spawn(["ssh", host, "bash -s"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  p.stdin.write(command + "\n");
  p.stdin.end();
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const code = await p.exited;
  return { code, out: out.trim(), err: err.trim() };
}

console.log("==================================================");
console.log("⚡ STARTING CLUSTER UNIFICATION & CONSOLIDATION ⚡");
console.log("==================================================");

// STEP 1: BUNOS CONSOLIDATION
console.log("\n[1/4] Consolidating BUNOS (10.200.77.3)...");
// 1. Remove legacy ~/src/aphrody
console.log("  -> Removing legacy ~/src/aphrody (1.5 GB)...");
await sshRun("bunos", "rm -rf ~/src/aphrody");

// 2. Clean and fast-forward ~/src/bun-os
console.log("  -> Fast-forwarding ~/src/bun-os to origin/main...");
const bunosGit = await sshRun("bunos", `
  cd ~/src/bun-os
  git reset --hard HEAD
  git fetch origin main
  git checkout main
  git pull origin main
  git status -s
`);
console.log("  -> bunos git status:", bunosGit.out);

// STEP 2: PROD CONSOLIDATION
console.log("\n[2/4] Consolidating PROD (10.200.77.5)...");
console.log("  -> Fast-forwarding ~/src/bun-os to origin/main...");
const prodGit = await sshRun("prod", `
  cd ~/src/bun-os
  git reset --hard HEAD
  git fetch origin main
  git checkout main
  git pull origin main
  git status -s
`);
console.log("  -> prod git status:", prodGit.out);

// STEP 3: VPS CONSOLIDATION
console.log("\n[3/4] Consolidating VPS (10.200.77.1)...");
// 1. Remove duplicate and sleepy containers
console.log("  -> Removing duplicate sleepy_cori container...");
await sshRun("vps", "docker rm -f sleepy_cori 2>/dev/null || true");

// 2. Fast-forward ~/src/bun-os
console.log("  -> Cleaning and fast-forwarding ~/src/bun-os to origin/main...");
const vpsGit = await sshRun("vps", `
  cd ~/src/bun-os
  git clean -f -d crates/bun-ui-web/apps/cosmic-calculator/
  git fetch origin main
  git checkout main
  git pull origin main
  git status -s
`);
console.log("  -> vps git status:", vpsGit.out);

// 3. Purge obsolete non-bun-os repos from ~/src/
console.log("  -> Purging obsolete clones from ~/src/ (preserving ONLY bun-os)...");
const purgeReposCmd = `
  cd ~/src
  for dir in aphrody-boot aquamarine brave-core bun bun-edge bun-edge-build bun-glibc bun-hypr bun-libraries bun-os-aosp bun-perf bun-ui bun-upstream edk2 filmcraft Hyprland hyprland-protocols hyprutils hyprwayland-scanner hyprwire linux-v7.3-upstream microsoft-wsl-kernel-current qemu-wasm rosegriffon smithay typesafe-sdk-js typesafe-sdk-python wayland wayland-protocols; do
    if [ -d "$dir" ]; then
      echo "Removing $dir..."
      rm -rf "$dir"
    fi
  done
`;
const purgeRes = await sshRun("vps", purgeReposCmd);
console.log("  -> Purge results:\n", purgeRes.out);

// 4. Clean Docker dangling caches
console.log("  -> Pruning reclaimable Docker caches on VPS...");
const dockerPrune = await sshRun("vps", "docker system prune -f; docker builder prune -af");
console.log("  -> Docker prune done.");

// STEP 4: VERIFY RECLAIMED DISK & STATUS ACROSS ALL 3 NODES
console.log("\n[4/4] Verifying cluster resource state...");
for (const host of FACTORY_HOSTS) {
  const df = await sshRun(host, "df -h / | tail -n 1");
  const src = await sshRun(host, "ls -d ~/src/* 2>/dev/null || ls -d /root/src/* 2>/dev/null");
  console.log(`\n--- Host: ${host} ---`);
  console.log(`Disk usage: ${df.out}`);
  console.log(`Checkouts in src:\n${src.out}`);
}

console.log("\n✅ Cluster Unification & Cleanup Complete!");
