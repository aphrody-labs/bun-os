> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

> Historical research and target-state analysis. For the current Rust-only WinClean runtime,
> transport limits, and subsystem wiring, see [the architecture overview](../ARCHITECTURE.md).
# Recherche Architecturale : Systèmes d'Exploitation Rust & Doctrine Aphrody OS

Ce document consigne les recherches approfondies, l'état de l'art technique, le fact-checking de l'écosystème Rust bare-metal / `no_std`, et la doctrine architecturale définitive régissant **Aphrody OS**.

---

## 1. Doctrine Fondatrice : Nature d'Aphrody OS

> [!IMPORTANT]
> **Aphrody OS ne s'exécutera JAMAIS depuis un firmware BIOS ou UEFI bare-metal.**
> Il ne remplace pas le noyau hôte Ring 0 de la machine physique.

Aphrody OS est conçu et implémenté comme un **méta-système d'exploitation en espace utilisateur (Ring-3 User-Space Control Plane & Desktop Shell)**, hautement autonome, privilégié et portable.

### La Triade d'Hébergement

Au lieu d'imposer un amorçage matériel dépendant de pilotes propriétaires non documentés, Aphrody OS s'exécute sur trois cibles :

1. **Windows 11 (Cible native principale)** :
   - API Win32, Job Objects, Named Pipes (`\\.\pipe\aphrody-os-<user>`).
   - Abstraction matérielle et d'administration via `aphrody-winclean` (diagnostics, profils d'énergie, UIA, capture d'écran, gestion de processus et fenêtres).
   - Élévation contrôlée via le binaire natif `C:\Windows\System32\sudo.exe`.
   - Rendu graphique via Wry (WebView2) et DirectComposition.

2. **Linux (Cible native Wayland / POSIX)** :
   - Appels système sûrs via `rustix` / libc, sockets de domaine Unix (`AF_UNIX`), `memfd_create`, cgroups v2.
   - Intégration Wayland native (Smithay / Wry WebKitGTK).
   - Compatibilité binaire Windows transparente via le module `aphrody-compat` pilotant Proton / Wine.

3. **Web / WASI (Cible minimale dans le navigateur)** :
   - Rendu direct dans Canvas HTML5 / WebGPU sans aucune installation.
   - Système de fichiers virtuel isolé via l'**Origin Private File System (OPFS)**.
   - Tâches asynchrones et commandes distribuées dans des `Web Workers`.
   - Communication et événements via `MessageChannel` et pont HTTP / JSON-RPC (`fetch("./rpc")`).

---

## 2. Analyse Critique de l'Écosystème Rust OS & Démystification du "Zero-C"

Une évaluation rigoureuse de la littérature et des dépôts open-source Rust bare-metal (`no_std`) révèle des impasses et des mythes qu'il convient de dissiper.

### A. Le mythe du "Zéro C" sur l'interface graphique (Wayland / libcosmic / Smithay)

- **Gestion des claviers et mappages (`xkbcommon`)** :
  L'affirmation selon laquelle un environnement Wayland en Rust pur peut se passer de bibliothèques C est erronée. Tout environnement Wayland complet (y compris `smithay`, `cosmic-comp` et `libcosmic`) s'appuie sur `xkbcommon-rs`, qui est un binding direct (`xkbcommon-sys`) vers la bibliothèque C **`libxkbcommon`**. Réécrire un parseur complet, conforme et maintenable de la spécification XKB en Rust pur représente un effort disproportionné non résolu à ce jour.
- **Rendu typographique et polices** :
  Bien que `cosmic-text` puisse s'appuyer sur `swash` ou `rustybuzz` (Rust pur), la découverte de polices système et l'internationalisation sous Linux continuent de solliciter `fontconfig` (`fontconfig-sys`) et `freetype` (`freetype-sys`).

### B. L'incomplétude du bytecode AML dans ACPI (`rust-osdev/acpi` & `aml`)

- Les crates Rust comme `acpi` permettent de parser efficacement les tables statiques (RSDP, MADT, FADT, SRAT).
- En revanche, la crate `aml` (interpréteur de bytecode ACPI Machine Language) reste incomplète et expérimentale. Sur matériel OEM moderne, le contrôle thermique, la mise en veille ACPI (S3/S5) et l'insertion dynamique de périphériques PCI échouent sans **ACPICA** (la bibliothèque de référence d'Intel écrite en C).

### C. Obsolescence d'outils historiques (`bootimage`)

- L'outil `bootimage` (`rust-osdev/bootimage`) est obsolète et lié à la version historique `bootloader 0.9.x`. Les architectures modernes exploitent soit des build scripts binaires UEFI directs, soit le standard **Limine** (protocole moderne en mode plat avec support natif du Higher-Half Direct Map).

---

## 3. Primitives et Correctifs Bare-Metal de Référence

> Recherche seulement : le code `no_std` de cette section n'existe pas dans le dépôt. L'image système Alpine et son [générateur initramfs](https://github.com/aphrody-labs/bun/blob/main/scripts/aphrody/initramfs.ts) appartiennent au fork Bun externe (chantiers U3 et V). Cette recherche ne qualifie pas un noyau Rust bare-metal.

Dans le cadre des recherches d'ingénierie système menées sur le socle Rust, plusieurs verrous de synchronisation et d'adressage mémoire ont été résolus et formalisés.

### A. `IrqSafeMutex<T>` : Élimination du danger `preserves_flags` & Mitigation TTAS

Dans un verrou sécurisé contre les interruptions matérielles, l'usage de l'assembleur inline x86_64 doit être rigoureux :

```rust
// arch/x86_64/sync.rs
#![no_std]

use core::cell::UnsafeCell;
use core::ops::{Deref, DerefMut};
use core::sync::atomic::{AtomicBool, Ordering};

pub struct IrqSafeMutex<T> {
    lock: AtomicBool,
    data: UnsafeCell<T>,
}

unsafe impl<T: Send> Sync for IrqSafeMutex<T> {}
unsafe impl<T: Send> Send for IrqSafeMutex<T> {}

pub struct IrqSafeMutexGuard<'a, T> {
    mutex: &'a IrqSafeMutex<T>,
    flags: usize,
}

impl<T> IrqSafeMutex<T> {
    pub const fn new(data: T) -> Self {
        Self {
            lock: AtomicBool::new(false),
            data: UnsafeCell::new(data),
        }
    }

    pub fn lock(&self) -> IrqSafeMutexGuard<'_, T> {
        let flags = disable_interrupts_and_save_flags();

        // Pattern Test-and-Test-and-Set (TTAS) :
        // La lecture relaxée maintient la ligne de cache en état Shared (S) dans MESI.
        // L'invalidation exclusive swap(Acquire) n'est tentée que lorsque le verrou est libre.
        while self.lock.swap(true, Ordering::Acquire) {
            while self.lock.load(Ordering::Relaxed) {
                core::hint::spin_loop();
            }
        }

        IrqSafeMutexGuard { mutex: self, flags }
    }
}

#[inline(always)]
fn disable_interrupts_and_save_flags() -> usize {
    let rflags: usize;
    unsafe {
        core::arch::asm!(
            "pushfq",
            "pop {0}",
            "cli",
            out(reg) rflags,
            options(nomem) // CRITIQUE : JAMAIS de preserves_flags car cli altère IF dans RFLAGS
        );
    }
    rflags
}

#[inline(always)]
fn restore_flags(flags: usize) {
    // Si IF (bit 9, masque 0x200) était armé à l'entrée, on réactive les IRQ
    if (flags & 0x200) != 0 {
        unsafe {
            core::arch::asm!("sti", options(nomem));
        }
    }
}

impl<'a, T> Deref for IrqSafeMutexGuard<'a, T> {
    type Target = T;
    #[inline(always)]
    fn deref(&self) -> &Self::Target {
        unsafe { &*self.mutex.data.get() }
    }
}

impl<'a, T> DerefMut for IrqSafeMutexGuard<'a, T> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut Self::Target {
        unsafe { &mut *self.mutex.data.get() }
    }
}

impl<'a, T> Drop for IrqSafeMutexGuard<'a, T> {
    #[inline(always)]
    fn drop(&mut self) {
        self.mutex.lock.store(false, Ordering::Release);
        restore_flags(self.flags);
    }
}
```

### B. Framebuffer Linéaire : Arithmétique d'Adressage en Octets

L'hypothèse selon laquelle `pitch / 4` donne un pas régulier en pixels est fausse sur de nombreux GPU réels et pilotes de virtualisation. Le `pitch` est un nombre d'**octets par scanline** :

$$\text{Offset Mémoire} = y \times \text{pitch\_bytes} + x \times (\text{bpp} / 8)$$

```rust
#[inline(always)]
pub fn write_pixel_32bpp(fb_base: *mut u8, pitch_bytes: usize, x: usize, y: usize, argb: u32) {
    let byte_offset = y * pitch_bytes + x * 4;
    unsafe {
        let pixel_ptr = fb_base.add(byte_offset) as *mut u32;
        core::ptr::write_volatile(pixel_ptr, argb);
    }
}
```

### C. Chaînage Mémoire Limine $\to$ PMM $\to$ Tas $\to$ `alloc`

Pour débloquer `alloc` (`Vec`, `Box`, `Arc`, `String`) en environnement `no_std` sans dépendre d'une libc :
1. **Limine HHDM (Higher-Half Direct Map)** : mappe l'intégralité de la RAM physique avec un offset virtuel constant.
2. **PMM (Physical Memory Manager)** : `buddy_system_allocator::LockedFrameAllocator` gère les pages physiques de 4 KiB identifiées comme `USABLE` via la `MemoryMapRequest`.
3. **Tas Noyau (Heap)** : Réservation d'un bloc physique contigu initial (ex: 32 MiB) projeté dans l'espace virtuel HHDM, revendiqué par **`talc::Talc`** configuré comme `#[global_allocator]`.

### D. Stratification de la Pile Clavier (Keyboard Input)

Pour préserver l'étanchéité du système :
- **Étage 0 (Kernel / Console de secours)** : Décodeur statique de scancodes PS/2 / VirtIO-Input en pur Rust `no_std`. Zéro allocation dynamique, zéro parsing de fichiers de configuration, zéro dépendance C.
- **Étage 1 (Serveur d'affichage Wayland / Ring 3)** : Confinement de `libxkbcommon` (via `xkbcommon-sys`) dans le processus utilisateur du compositeur d'affichage. Les risques de mémoire non sûre restent ainsi confinés hors du noyau.

---

## 4. Comparatif Architectural : Bare-Metal vs User-Space Control Plane

| Dimension | Approche Bare-Metal (Ring 0) | Approche Aphrody OS (Ring-3 Control Plane) |
| :--- | :--- | :--- |
| **Pilotes Matériels** | Nécessite l'écriture complète de pilotes GPU, Wi-Fi, NVMe, USB xHCI | Exploite directement les pilotes certifiés de l'hôte (Windows WDDM / Linux DRM) |
| **Accélération Graphique** | Blocage quasi-insurmontable sur GPU récents (Nvidia, AMD, Intel) | Accès immédiat et natif à DirectX 12, Vulkan, Metal et WebGPU |
| **Sécurité Mémoire** | Risque de panique noyau sur défaillance d'un pilote matériel | Isolation stricte de processus : crash d'un service supervisé sans panique système |
| **Portabilité** | Liée à une machine ou à un hyperviseur spécifique | Fonctionne sous Windows 11, distributions Linux et navigateur Web |
| **Vitesse de Déploiement** | Des années d'ingénierie bas niveau avant d'obtenir un bureau fluide | Immédiate : capitalisation intégrale sur l'existant Rust et Web |

---

## 5. Composants réels du plan de contrôle Ring-3

Correspondance vérifiée le 2026-10-09 avec les manifestes Cargo. Les noms `aphrody-systemd`, `aphrody-coreutils`, `aphrody-compat`, `aphrody-libaphrody`, `aphrody-shell` et `aphrody-browser` d'une version antérieure de ce document ne sont pas des crates : ce sont des modules de `aphrody-kernel` ou d'autres crates.

| Rôle | Emplacement réel |
| :--- | :--- |
| Hôte de contrôle, dispatch d'outils MCP, sous-systèmes | crate `aphrody-kernel` (`crates/os/kernel/core`) |
| Superviseur d'unités (DAG, journal) | module `systemd` de `aphrody-kernel` (`crates/os/kernel/core/src/systemd`) |
| Utilitaires POSIX natifs | module `coreutils` de `aphrody-kernel` (`crates/os/kernel/core/src/coreutils.rs`) |
| Wine / Proton, .NET, `pwsh` | module `compat` de `aphrody-kernel` (`crates/os/kernel/core/src/compat`) |
| Façades desktop et pont Wry | crate `aphrody-app` (`crates/ui/app`) |
| Shell Nushell | crate `aphrody-nu` (`crates/shell/nu`) |
| Navigateur Obscura | crate `aphrody-obscura` (`crates/web/obscura`) |
| Diagnostics et contrôle Windows / UIA | crate `aphrody-winclean` (`crates/os/kernel/comps/winclean`) |
| Bureau (TopBar, espaces de travail, réglages rapides) | `m3/packages/app-ui` |

Le confinement local de commandes n'a pas de crate dédié : l'ancien `aphrody-sandbox`, sans consommateur, a été retiré. Sous Linux, landlock et seccomp sont fournis par `bun:linux` dans le fork Bun.
