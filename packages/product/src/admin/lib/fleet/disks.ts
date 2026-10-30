// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function cygwinPath(path: string): string {
  const match = /^([a-z]):[\\/](.+)$/i.exec(path);
  if (!match || /[\r\n\0]/.test(path)) throw new Error("absolute Windows filesystem path required");
  return `/cygdrive/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}`;
}

export function diskCommand(peer: string, letter: string, home: string, programFiles: string) {
  if (peer !== "omar" && peer !== "aphro-pc") throw new Error("undeclared disk peer");
  if (!/^[D-Z]:$/.test(letter)) throw new Error("select an unused D: through Z: drive");
  const address = peer === "omar" ? "10.200.77.10" : "10.200.77.4";
  const user = peer === "omar" ? "omara" : "aphro";
  return [
    join(programFiles, "SSHFS-Win", "bin", "sshfs-win.exe"),
    "cmd",
    `${user}@${address}:/C:/`,
    letter,
    "-f",
    `--VolumePrefix=\\sshfs.kr\\${user}@${address}\\C:`,
    "-o",
    "ssh_command=/bin/ssh.exe -F /dev/null",
    "-o",
    `IdentityFile=${cygwinPath(join(home, ".ssh", "id_ed25519_aphrody"))}`,
    "-o",
    `UserKnownHostsFile=${cygwinPath(join(home, ".ssh", "known_hosts_aphrody"))}`,
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "reconnect",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    `volname=${peer === "omar" ? "Omar" : "Aphrody"}-C`,
  ];
}

export async function diskMain(argv: string[]) {
  if (process.platform !== "win32") throw new Error("Explorer mounts require Windows");
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at < 0 ? undefined : argv[at + 1];
  };
  const peer = flag("--peer");
  if (!peer) throw new Error("disk requires --peer omar|aphro-pc");
  const letter = flag("--letter") ?? (peer === "omar" ? "O:" : "P:");
  const { knownFolder } = await import("./windows.ts");
  if (existsSync(letter + "/")) throw new Error("drive already mounted; inspect before replacing it");
  const command = diskCommand(peer, letter, flag("--home") ?? homedir(), knownFolder("ProgramFiles"));
  if (!existsSync(command[0]!)) throw new Error("declared WinFsp/SSHFS installation required");
  // Foreground owner: the existing mesh/psmux session owns persistence and exit.
  const child = Bun.spawn(command, {
    windowsHide: true,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const stop = () => child.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await child.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
