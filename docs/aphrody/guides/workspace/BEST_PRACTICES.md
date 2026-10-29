> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Guide des Meilleures Pratiques d'Ingénierie : YOLO Polyglot Monorepo

Ce document détaille les standards d'architecture, de mémoire et de concurrence appliqués dans le monorepo **`YOLO`** pour faire converger Rust, Python (uv), Bun (TypeScript) et Tauri 3.

---

## 1. Architecture Rust : Cœur Neutre & FFI Découplée

### Principe de Responsabilité Unique
Le code de calcul intensif réside dans [yolo-core du SDK Bun épinglé](https://github.com/aphrody-labs/bun/tree/6181424bc2fca4349560832161c07ba85c33e8ef/packages/bun-runtime-sdk/crates/yolo-core). Cette crate ne possède **aucune adhérence** à Python (PyO3) ni à Bun (`bun:ffi`) :
- Pureté algorithmique : calculs vectorisés, `rayon::par_chunks()`.
- Immutabilité des tranches : passage par référence `&[f64]` plutôt que transfert d'allocation `Vec<f64>` quand c'est possible.
- Concurrence sûre : isolation des états modifiables via `parking_lot::RwLock` ou structures atomiques.

### Couche d'Export C-ABI (`crates/engine/yolo-runtime`)
Pour Bun et les runtimes externes :
```rust
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ffi_sum_squares(ptr: *const f64, len: usize) -> f64 {
    if ptr.is_null() || len == 0 {
        return 0.0;
    }
    // Respect strict de la sûreté des pointeurs Rust 2024
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    yolo_core::compute_sum_squares(slice)
}
```

---

## 2. Bindings PyO3 0.29 & Python Free-Threaded (PEP 703)

### Utilisation de `py.detach()` au lieu de `py.allow_threads()`
Dans PyO3 0.29+, pour les calculs lourds en Rust :
```rust
#[pyfunction]
fn parallel_sum_squares(py: Python<'_>, values: Vec<f64>) -> PyResult<f64> {
    // py.detach relâche le GIL immédiatement et vérifie à la compilation que
    // la fermeture satisfait le trait Ungil.
    let result = py.detach(move || {
        compute_sum_squares(&values)
    });
    Ok(result)
}
```

### Stubs Typés PEP 484 & PEP 561
- Toujours fournir [`py.typed`](../../../../packages/yolo-python/python/yolo/py.typed) à la racine du package Python pour signaler aux vérificateurs de types (`ty`, `mypy`, `pyright`) que le module est typé.
- Fournir un fichier de stubs [`.pyi`](../../../../packages/yolo-python/python/yolo/_yolo_native.pyi) reflétant exactement l'interface C-API compilée par PyO3.

---

## 3. Bun & Zero-Copy FFI (`bun:ffi`)

### Appel Direct sans Sérialisation
Dans [`packages/engine/runtime/src/compute.ts`](../../../../packages/runtime-sdk/src/compute.ts) :
- Éviter absolument de convertir des `Float64Array` en tableaux JavaScript natifs (`Array.from` ou `.map`).
- Passer directement le pointeur mémoire sous-jacent via `ptr(numbers)` :
```typescript
import { dlopen, FFIType, ptr } from "bun:ffi";

const { symbols } = dlopen(dylibPath, {
  ffi_sum_squares: {
    args: [FFIType.ptr, FFIType.usize],
    returns: FFIType.f64,
  },
});

export function fastSumSquares(numbers: Float64Array): number {
  if (numbers.length === 0) return 0;
  return symbols.ffi_sum_squares(ptr(numbers), numbers.length);
}
```

---

## 4. Remplacement des Linters par la Toolchain OXC & Ruff

### Vélocité et Légèreté
- Remplacer ESLint et Prettier par `oxlint` et `oxfmt` pour TypeScript/JavaScript.
- Utiliser Astral `ruff` pour le linting et le formatage sub-milliseconde du code Python.
- Exécution en **~20ms** au lieu de 5 à 15 secondes pour les outils basés sur Node.js conventionnels.

---

## 5. Tauri 3 Desktop : Sécurité & IPC

- Utiliser l'arborescence standardisée : `crates/ui/app` (`aphrody-app`, l’unique application desktop) avec `build.rs` invoquant `tauri_build::build()`.
- Déclarer les autorisations de commandes de manière explicite dans les schémas d'ACL.
- Servir l'interface utilisateur de manière réactive via un bundler Bun sans nécessiter de serveur lourd en développement.
