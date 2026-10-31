#!/usr/bin/env bash
# Serialize Aphrody Cargo work across agents and terminals, and bound rustc fan-out.
set -euo pipefail

if (($# == 0)); then
    echo "usage: scripts/aphrody/build/rust/cargo-serial.sh <cargo arguments...>" >&2
    exit 64
fi

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)"
factory_config="${APHRODY_FACTORY_CONFIG:-$source_root/tools/aphrody/config/build-factory.json}"
if [[ -n "${APHRODY_FACTORY_CONFIG:-}" && ( "$factory_config" != /* || ! -r "$factory_config" ) ]]; then
    echo "APHRODY_FACTORY_CONFIG must select a readable absolute configuration path" >&2
    exit 64
fi
cargo_command="${1#+}"
if [[ "$1" == +* ]]; then cargo_command="${2:-}"; fi
help_only=false
for arg in "$@"; do
    if [[ "$arg" == --help || "$arg" == -h ]]; then help_only=true; fi
done
case "$cargo_command" in
    build|b|check|c|test|t|clippy|rustdoc|doc|d|bench|run|r|install|rustc|nextest|xwin|zigbuild)
        # Cloud environments (Claude Code, APHRODY_CLOUD, CI, GitHub Actions, Codespaces, containers)
        # are themselves build hosts: they never route to the factory.
        # Both declared factory hosts run Cargo locally under their factory locks.
        is_cloud=false
        if [[ "${CLAUDE_CODE_REMOTE:-}" == true || "${APHRODY_CLOUD:-0}" == 1 || "${CI:-}" == true || "${GITHUB_ACTIONS:-}" == true || "${CODESPACES:-}" == true || -n "${GITPOD_WORKSPACE_ID:-}" || "${CLOUD_SHELL:-}" == true || -f /.dockerenv || "${CONTAINER:-}" == true ]]; then
            is_cloud=true
        fi
        if [[ "$help_only" == false && -f "$factory_config" && "${APHRODY_BUILD_HOST:-}" != vps && "${APHRODY_BUILD_HOST:-}" != dbfr && "${APHRODY_LOCAL_CARGO:-0}" != 1 && "$is_cloud" == false ]]; then
            # The Workspace build-factory owner interprets the factory contract.
            factory_route="$(bun "$source_root/packages/bun-workspace/src/automation/build-factory.ts" status --route)"
            if [[ "$factory_route" == factory ]]; then
                echo "Heavy Cargo never runs in WSL. Exact worktree state: bun scripts/aphrody/build/rust/vps-cargo.ts run -- <arguments>; pushed main revision: aphrody-ops build-factory run --repo aphrody --revision <full-sha> -- scripts/aphrody/build/rust/cargo-serial.sh <arguments>." >&2
                echo "APHRODY_LOCAL_CARGO=1 is only for an explicitly selected scoped diagnostic." >&2
                exit 64
            fi
        fi
        ;;
esac
# Only compilation is serialized; fetch, metadata and lockfile commands rely on Cargo's own package-cache lock.
case "$cargo_command" in
    build|b|check|c|test|t|clippy|rustdoc|doc|d|bench|run|r|install|rustc|nextest|xwin|zigbuild) ;;
    *) exec cargo "$@" ;;
esac

# This is the execution host's affinity, never the controller's or a different host's budget.
available_cpus="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
if [[ ! "$available_cpus" =~ ^[1-9][0-9]*$ ]]; then
    echo "Cannot determine the executing host's available CPUs" >&2
    exit 64
fi
default_jobs=4
if ((available_cpus < default_jobs)); then default_jobs="$available_cpus"; fi
jobs="${APHRODY_CARGO_JOBS:-$default_jobs}"
if [[ "$jobs" == auto ]]; then
    # Respect the host affinity and the owner's four-compiler limit per factory lane.
    # Keep the factory lease and shared Cargo lock; concurrent owners retain them.
    jobs="$default_jobs"
elif [[ ! "$jobs" =~ ^[1-4]$ ]]; then
    echo "APHRODY_CARGO_JOBS must be an integer from 1 through 4, or auto (at most four available CPUs)" >&2
    exit 64
fi
if ((jobs > available_cpus)); then
    echo "Cargo jobs exceed the executing host's available CPUs" >&2
    exit 64
fi

for arg in "$@"; do
    case "$arg" in
        -j*|--jobs|--jobs=*)
            echo "Do not override Cargo job count; set APHRODY_CARGO_JOBS=1..4 or auto instead" >&2
            exit 64
            ;;
    esac
done

# Heavy Cargo runs in a buncc lane (packages/buncc/src/cargo.ts): about one lane per four CPUs, at most four jobs per
# lane, one build/target directory per lane on the fast disk, shared sccache, a lane wait instead of a failure, and a
# no-progress watchdog instead of a hard 30-minute kill. The global factory lease is not taken for Cargo any more.
if [[ -n "${APHRODY_CARGO_TARGET_DIR:-}" ]]; then
    if [[ "$APHRODY_CARGO_TARGET_DIR" != /* ]]; then
        echo "APHRODY_CARGO_TARGET_DIR must be an absolute path" >&2
        exit 64
    fi
    for arg in "$@"; do
        case "$arg" in
            --target-dir|--target-dir=*)
                echo "Do not mix APHRODY_CARGO_TARGET_DIR with --target-dir" >&2
                exit 64
                ;;
        esac
    done
    export CARGO_TARGET_DIR="$APHRODY_CARGO_TARGET_DIR"
fi
if [[ "${APHRODY_CARGO_INCREMENTAL:-0}" == 1 ]]; then unset CARGO_INCREMENTAL; else export CARGO_INCREMENTAL=0; fi
export CARGO_BUILD_JOBS="$jobs" CARGO_TERM_COLOR=never
if command -v nice >/dev/null 2>&1; then exec nice -n 10 bun "$source_root/scripts/cargo.ts" exec -- "$@"; fi
exec bun "$source_root/scripts/cargo.ts" exec -- "$@"
