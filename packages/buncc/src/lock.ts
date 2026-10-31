import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface LockOptions {
  /** Give up after this long; the build is not started. */
  deadlineMs: number;
  /** A lock older than this whose owner is gone, or older than staleMs regardless of pid reuse, is broken. */
  staleMs?: number;
  pollMs?: number;
  onWait?: (holder: LockHolder | null) => void;
}

export interface LockHolder {
  pid: number;
  startedAt: number;
}

/** Per-user cache directory shared by the lock files, the vcvars cache and the compile-commands log. */
export function cacheDir(): string {
  const configured = Bun.env.BUNCC_CACHE_DIR;
  if (configured) return resolve(configured);
  if (process.platform === "win32") return join(Bun.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "buncc");
  return join(Bun.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "buncc");
}

export function lockPathFor(name: string, key: string): string {
  const hash = createHash("sha256").update(key.toLowerCase()).digest("hex").slice(0, 16);
  return join(cacheDir(), "locks", `${name}-${hash}.lock`);
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readHolder(path: string): LockHolder | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockHolder>;
    if (typeof value.pid === "number" && typeof value.startedAt === "number") return value as LockHolder;
  } catch {}
  return null;
}

/** Try once to take the lock. Returns a release function, or null when another live process holds it. */
export function tryAcquire(path: string, staleMs = 4 * 60 * 60_000, now = Date.now()): (() => void) | null {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: now } satisfies LockHolder));
      closeSync(fd);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          if (readHolder(path)?.pid === process.pid) rmSync(path, { force: true });
        } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = readHolder(path);
      const stale = !holder || !pidAlive(holder.pid) || now - holder.startedAt > staleMs;
      if (!stale) return null;
      try {
        rmSync(path, { force: true });
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Run `fn` while holding the lock file, waiting up to `deadlineMs` for the current holder. */
export async function withLock<T>(path: string, options: LockOptions, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + options.deadlineMs;
  const poll = options.pollMs ?? 500;
  let notified = false;
  for (;;) {
    const release = tryAcquire(path, options.staleMs);
    if (release) {
      try {
        return await fn();
      } finally {
        release();
      }
    }
    if (Date.now() >= deadline)
      throw new Error(`Lock ${path} stayed busy until the ${options.deadlineMs} ms deadline.`);
    if (!notified) {
      notified = true;
      options.onWait?.(readHolder(path));
    }
    await Bun.sleep(poll);
  }
}

/** Take one of `slots` global slots (BUNCC_SLOTS). Returns the slot index and the release function. */
export async function acquireSlot(
  slots: number,
  deadlineMs: number,
  onWait?: () => void,
): Promise<{ slot: number; release: () => void }> {
  const deadline = Date.now() + deadlineMs;
  let notified = false;
  for (;;) {
    for (let slot = 0; slot < slots; slot++) {
      // A lane is only free when its holder is gone: long builds keep their lane however long they run.
      const release = tryAcquire(lockPathFor("slot", String(slot)), Number.POSITIVE_INFINITY);
      if (release) return { slot, release };
    }
    if (Date.now() >= deadline) throw new Error(`All ${slots} buncc build slots stayed busy until the deadline.`);
    if (!notified) {
      notified = true;
      onWait?.();
    }
    await Bun.sleep(500);
  }
}
