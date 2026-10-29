// SPDX-License-Identifier: Apache-2.0
/**
 * Diagnostic approfondi du lecteur USB Z: (Disque 1, General UDisk 2TB)
 * Utilise Bun amont (bun:ffi, wevtutil) via l'hôte Windows de @aphrody/winclean.
 */
import { readdirSync, statSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isElevated, windowsHost } from "@aphrody/winclean/windows-host";

/** Raw event XML records of a channel, newest first, filtered by an XPath expression (wevtutil). */
function queryEventLog(channel: string, options: { xpath: string; limit: number }): string[] {
  const result = Bun.spawnSync(
    ["wevtutil", "qe", channel, `/q:${options.xpath}`, `/c:${options.limit}`, "/rd:true", "/f:xml"],
    { stdout: "pipe", stderr: "pipe", windowsHide: true },
  );
  if (result.exitCode !== 0)
    throw new Error(result.stderr.toString().trim() || `wevtutil exited with ${result.exitCode}`);
  return result.stdout.toString().match(/<Event[ >][\s\S]*?<\/Event>/g) ?? [];
}

async function main() {
  console.log("=== DIAGNOSTIC AMOVIBLE Z: (HÔTE WINDOWS) ===\n");

  // 1. Hôte Windows
  if (process.platform !== "win32") {
    console.error("Ce diagnostic ne s'exécute que sous Windows.");
    process.exit(1);
  }
  const win = windowsHost();

  // 2. Privilèges et Système
  const elevated = isElevated();
  const sys = win.systemInfo as { computerName: string; userName: string };
  const memory = win.memory.status();
  console.log(
    `[Hôte] Machine: ${sys.computerName} | Utilisateur: ${sys.userName} | Élévation Admin: ${elevated ? "OUI" : "NON"}`,
  );
  console.log(
    `[Mémoire] RAM Totale: ${(memory.totalPhysical! / 1024 / 1024 / 1024).toFixed(2)} Go | Libre: ${(memory.availablePhysical! / 1024 / 1024 / 1024).toFixed(2)} Go (Charge: ${memory.memoryLoad}%)\n`,
  );

  // 3. Inspection des disques logiques
  const drives = win.storage.drives();
  console.log("[Lecteurs Détectés]");
  for (const d of drives) {
    const totalGB = (d.totalBytes / 1024 ** 3).toFixed(2);
    const freeGB = (d.freeBytes / 1024 ** 3).toFixed(2);
    console.log(`  - ${d.root} [${d.type}]: Total = ${totalGB} Go, Libre = ${freeGB} Go (${d.totalBytes} octets)`);
  }

  const targetDrive = drives.find(d => d.root.toUpperCase().startsWith("Z"));
  if (!targetDrive) {
    console.error("\n[ERREUR] Lecteur Z: non trouvé dans l'inventaire des disques !");
    process.exit(1);
  }

  console.log(`\n[Cible Identifiée] ${targetDrive.root}`);
  console.log(
    `  Capacité déclarée : ${(targetDrive.totalBytes / 1024 ** 4).toFixed(3)} To (${targetDrive.totalBytes.toLocaleString()} octets)`,
  );
  console.log(
    `  Espace libre      : ${(targetDrive.freeBytes / 1024 ** 4).toFixed(3)} To (${targetDrive.freeBytes.toLocaleString()} octets)`,
  );
  console.log(`  Espace utilisé    : ${((targetDrive.totalBytes - targetDrive.freeBytes) / 1024 ** 3).toFixed(2)} Go`);

  // 4. Examen du contenu à la racine de Z:\
  console.log(`\n[Contenu Racine Z:\\]`);
  try {
    const entries = readdirSync("Z:\\");
    if (entries.length === 0) {
      console.log("  (Racine vide)");
    } else {
      console.log(`  Total entrées trouvées: ${entries.length}`);
      for (const entry of entries.slice(0, 20)) {
        try {
          const full = join("Z:\\", entry);
          const st = statSync(full);
          const kind = st.isDirectory() ? "<DIR>" : `${st.size.toLocaleString()} B`;
          console.log(`   - ${entry.padEnd(30)} ${kind} (modifié: ${st.mtime.toISOString()})`);
        } catch (e: any) {
          console.log(`   - ${entry.padEnd(30)} [Erreur I/O: ${e.message}]`);
        }
      }
      if (entries.length > 20) {
        console.log(`   ... et ${entries.length - 20} autres éléments.`);
      }
    }
  } catch (err: any) {
    console.error(`  Impossible de lire la racine Z:\\: ${err.message}`);
  }

  // 5. Test I/O Sonde (Écriture + Lecture + Intégrité de hachage)
  console.log(`\n[Test I/O Sonde Z:\\]`);
  const probeFile = "Z:\\__aphrody_probe_test.tmp";
  const probeData = Buffer.alloc(1024 * 64); // 64 Ko
  for (let i = 0; i < probeData.length; i++) {
    probeData[i] = (i * 31 + 17) & 0xff;
  }
  const originalHash = createHash("sha256").update(probeData).digest("hex");

  try {
    const t0 = performance.now();
    writeFileSync(probeFile, probeData);
    const tWrite = performance.now() - t0;

    const t1 = performance.now();
    const readBack = readFileSync(probeFile);
    const tRead = performance.now() - t1;

    const readHash = createHash("sha256").update(readBack).digest("hex");
    const hashMatch = originalHash === readHash;

    console.log(`  Écriture 64 Ko : ${tWrite.toFixed(2)} ms (${(64 / 1024 / (tWrite / 1000)).toFixed(2)} Mo/s)`);
    console.log(`  Lecture  64 Ko : ${tRead.toFixed(2)} ms (${(64 / 1024 / (tRead / 1000)).toFixed(2)} Mo/s)`);
    console.log(`  Checksum SHA-256: ${hashMatch ? "OK (Correspondance exacte)" : "ÉCHEC (Corruption immédiate !)"}`);

    unlinkSync(probeFile);
    console.log("  Suppression du fichier sonde : Succès");
  } catch (err: any) {
    console.error(`  [ALERTE I/O] Le test sonde a échoué : ${err.message}`);
  }

  // 6. Analyse des événements Windows via wevtutil
  console.log(`\n[Événements Système Récents sur le stockage / Harddisk1]`);
  try {
    const rawEvents = queryEventLog("System", {
      xpath: "*[System[Provider[@Name='disk'] or Provider[@Name='USBSTOR'] or Provider[@Name='partmgr']]]",
      limit: 40,
    });

    let disk1Events = 0;
    for (const xml of rawEvents) {
      const isHarddisk1 = xml.includes("Harddisk1") || xml.includes("DR1");
      const eventIdMatch = xml.match(/<EventID[^>]*>(\d+)<\/EventID>/);
      const timeMatch = xml.match(/SystemTime='([^']+)'/);
      const providerMatch = xml.match(/Provider Name='([^']+)'/);
      const dataMatch = xml.match(/<Data>([^<]+)<\/Data>/);

      const eventId = eventIdMatch ? eventIdMatch[1] : "?";
      const time = timeMatch ? timeMatch[1] : "?";
      const provider = providerMatch ? providerMatch[1] : "?";
      const data = dataMatch ? dataMatch[1] : "";

      if (isHarddisk1 || provider === "USBSTOR") {
        disk1Events++;
        let label = "";
        if (eventId === "51") label = " [ERREUR I/O DE PAGINATION]";
        else if (eventId === "7") label = " [BLOC DÉFECTUEUX / BAD BLOCK]";
        else if (eventId === "153") label = " [I/O TIMEOUT / RETRY]";
        else if (eventId === "157") label = " [DISQUE DÉCONNECTÉ PAR SURPRISE]";
        else if (eventId === "140") label = " [ÉCHEC D'ÉCRITURE DIFFÉRÉE]";

        console.log(`  - ${time} | ${provider} | ID ${eventId}${label} -> ${data}`);
      }
    }

    if (disk1Events === 0) {
      console.log("  Aucun événement d'erreur récent spécifiquement enregistré sur Harddisk1.");
    }
  } catch (err: any) {
    console.error(`  Erreur lors de la lecture du journal d'événements: ${err.message}`);
  }

  console.log("\n=== FIN DU DIAGNOSTIC BUN:WINDOWS ===");
}

main().catch(err => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
