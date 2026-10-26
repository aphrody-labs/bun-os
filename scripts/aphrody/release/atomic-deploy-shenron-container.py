#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Sealed Shenron Docker activation; invoked by the canonical Infra adapter."""

import fcntl
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
import tempfile
from shenron_deployment_identity import require_release_name


class DeploymentError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise DeploymentError(message)


# The one compose project of the host (tools/config/host/host-policy.toml [layout] compose_project).
PROJECT = os.environ.get("APHRODY_COMPOSE_PROJECT", "aphrody")


# Host-owned compose overrides, kept across releases (they were systemd drop-ins before the host project).
OVERRIDES = ("shared/debate/guild-admission.override.json",)


def overrides(root):
    return [arg for name in OVERRIDES if (root / name).is_file() for arg in ("-f", str(root / name))]


def command(args):
    result = subprocess.run(
        args, capture_output=True, text=True, timeout=240, check=False
    )
    # Compose diagnostics can include interpolated private environment values.
    require(result.returncode == 0, "deployment command failed: " + args[0])
    return result.stdout


def file_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def allowed_mount(name, volume, release, root, manifest, rollback=False):
    source = pathlib.Path(volume.get("source", "/missing")).resolve()
    if name in ("postgres", "redis"):
        owned = root / "shared/state" / name
        return (
            source.is_relative_to(owned)
            and (root / "shared/state/VERIFIED.json").is_file()
        )
    if name == "chat":
        return (
            volume.get("read_only") is True
            and source.is_relative_to(root / "shared/models")
            and source.is_file()
        )
    if name != "gateway":
        return source.is_relative_to(root / "shared")
    if volume.get("read_only") is not True:
        return False
    target = volume.get("target", "")
    if target == "/var/www/shenron/50x.html":
        return (
            source == release / "public/50x.html"
            and source.is_file()
            and "public/50x.html" in manifest.get("files", {})
        )
    if target == "/etc/letsencrypt":
        return source == pathlib.Path("/etc/aphrody/shenron-tls").resolve()
    if target == "/etc/nginx/conf.d":
        files = manifest.get("files", {})
        sealed = {n for n in files if n.startswith("nginx/")}
        present = {str(p.relative_to(release)) for p in source.rglob("*") if p.is_file()}
        # A release being rolled back to may carry vhosts added after sealing; it must still hold every sealed file.
        extra = present - sealed
        return (
            source == release / "nginx"
            and bool(sealed)
            and (present >= sealed if rollback else (not extra or all(p.startswith("nginx/zz-") for p in extra)))
        )
    # Public media roots only. Never expose private bot data, conversations or home.
    public = {
        "/home/ubuntu/apps/shenron-cdn/wiki": root / "shared/site/wiki",
        "/home/ubuntu/apps/shenron-cdn/assets": root / "shared/bot/assets",
        "/home/ubuntu/apps/shenron-cdn/site-extra": root / "shared/site/public-extra",
        "/srv/shenron-cdn/wiki": root / "shared/site/wiki",
        "/srv/shenron-cdn/assets": root / "shared/bot/assets",
        "/srv/shenron-cdn/site-extra": root / "shared/site/public-extra",
    }
    if target in public:
        return source == public[target].resolve()
    # Sites migrated from the vps (vhosts zz-*.conf): public static roots and the HTTP-01 webroot.
    if target in (
        "/home/ubuntu/apps/creator",
        "/home/ubuntu/apps/downloads",
        "/srv/aphrody-creator",
        "/srv/aphrody-downloads",
        "/var/www/maintenance",
        "/var/www/letsencrypt",
    ):
        return source == pathlib.Path(target).resolve()
    if source.is_relative_to(release) and (
        volume.get("target", "").startswith("/home/ubuntu/apps/shenron-cdn/")
        or volume.get("target", "").startswith("/srv/shenron-cdn/")
    ):
        if source.is_file():
            return str(source.relative_to(release)) in manifest.get("files", {})
        return source.is_dir() and all(
            str(p.relative_to(release)) in manifest.get("files", {})
            for p in source.rglob("*")
            if p.is_file()
        )
    return False


def validate_public_game(service, declared):
    require(
        service.get("network_mode") == "host"
        and service.get("entrypoint") == ["/usr/local/bin/shenron-server"]
        and service.get("command") == ["serve", "--host", "127.0.0.1", "--port", "5013"]
        and not declared.get("env_file")
        and not service.get("volumes")
        and not service.get("ports"),
        "game workload must remain a public isolated loopback surface",
    )
    environment = service.get("environment", {})
    require(
        environment.get("SHENRON_PROFILE") == "public"
        and environment.get("SHENRON_SITE_SURFACE") == "game"
        and environment.get("SHENRON_HOME") == "/var/lib/shenron-game"
        and environment.get("SHENRON_SITE_URL") == "https://dragonballfr.com"
        and environment.get("SHENRON_PUBLIC_SITE_URL") == "https://dragonballfr.com"
        and environment.get("SHENRON_PUBLIC_GAME_URL") == "https://play.dragonballfr.com"
        and set(environment).issubset({"SHENRON_HOME", "SHENRON_PROFILE", "SHENRON_SITE_SURFACE", "SHENRON_SITE_URL", "SHENRON_PUBLIC_SITE_URL", "SHENRON_PUBLIC_GAME_URL", "PORT", "HOSTNAME", "NEXT_TELEMETRY_DISABLED"}),
        "game workload must not receive private application environment",
    )


def verify(release, root, rollback=False):
    require(
        release.parent == root / "releases",
        "release must be directly under the release root",
    )
    manifest_path = release / "release.json"
    require(
        manifest_path.is_file() and not manifest_path.is_symlink(),
        "sealed Docker release.json required",
    )
    manifest = json.loads(manifest_path.read_text())
    revision = manifest.get("commit", "")
    require(
        manifest.get("schemaVersion") == 1
        and manifest.get("runtime") == "docker"
        and manifest.get("repository") == "shenron"
        and manifest.get("target") == "dbfr"
        and re.fullmatch(r"[a-f0-9]{40}", revision),
        "invalid Docker release identity",
    )
    try:
        require_release_name(release.name, revision, manifest.get("deployment"))
    except ValueError:
        require(False, "release source/runtime identity differs")
    require(
        set(manifest.get("files", {})) >= {"compose.yaml", "deploy.env"}
        and all(
            not pathlib.PurePosixPath(name).is_absolute()
            and ".." not in pathlib.PurePosixPath(name).parts
            for name in manifest.get("files", {})
        ),
        "release must seal Compose and deployment settings",
    )
    for name, digest in manifest["files"].items():
        path = release / name
        require(
            path.is_file()
            and not path.is_symlink()
            and path.resolve().is_relative_to(release)
            and not any(
                parent.is_symlink()
                for parent in path.parents
                if parent != release and parent.is_relative_to(release)
            )
            and file_digest(path) == digest,
            "release file integrity check failed",
        )
    image_id = manifest.get("imageId", "")
    require(
        re.fullmatch(r"sha256:[a-f0-9]{64}", image_id), "immutable image ID required"
    )
    image = json.loads(command(["docker", "image", "inspect", image_id]))[0]
    require(
        image["Id"] == image_id
        and image["Os"] == "linux"
        and image["Architecture"] == "amd64"
        and image.get("Config", {})
        .get("Labels", {})
        .get("org.opencontainers.image.revision")
        == revision,
        "image platform or source revision differs from release",
    )
    compose = [
        "docker",
        "compose",
        "--project-name",
        PROJECT,
        "--env-file",
        str(release / "deploy.env"),
        "-f",
        str(release / "compose.yaml"),
    ] + overrides(root)
    config = json.loads(command(compose + ["config", "--format", "json"]))
    services = config.get("services", {})
    require(
        {"site", "bot"}.issubset(services)
        and set(services).issubset(
            {"site", "bot", "game", "gateway", "postgres", "redis", "chat"}
        )
        and (("postgres" in services) == ("redis" in services)),
        "Docker release must contain site and bot and optionally gateway",
    )
    images = manifest.get("images", {})
    expected_images = {name: image_id for name in services}
    for role in set(services) - {"site", "bot", "game"}:
        gateway = images.get(role, {})
        require(
            re.fullmatch(r"sha256:[a-f0-9]{64}", gateway.get("id", ""))
            and re.fullmatch(r"[a-f0-9]{40}", gateway.get("commit", "")),
            "sealed infrastructure image identity required",
        )
        expected_images[role] = gateway["id"]
    env_root = pathlib.Path(os.environ.get("SHENRON_ENV_ROOT", "/etc")).resolve()
    share = pathlib.Path(
        os.environ.get("SHENRON_INFRA_SHARE", "/usr/local/share/aphrody-infra")
    )
    contract = json.loads((share / "secrets-contract.json").read_text()).get(
        "services", {}
    )
    try:
        # Assembled Compose is JSON. Read sealed declarations directly: Compose
        # 2.40.3 resolves env_file values even with --no-env-resolution alone.
        declared = json.loads((release / "compose.yaml").read_text())
    except json.JSONDecodeError:
        declared = json.loads(
            command(
                compose
                + [
                    "config",
                    "--no-env-resolution",
                    "--no-interpolate",
                    "--no-path-resolution",
                    "--format",
                    "json",
                ]
            )
        )
    for name, service in services.items():
        if name == "game":
            validate_public_game(service, declared["services"][name])
        tagged = json.loads(command(["docker", "image", "inspect", service["image"]]))[
            0
        ]
        require(
            tagged["Id"] == expected_images[name],
            "every workload must use its sealed image",
        )
        require(
            tagged["Os"] == "linux" and tagged["Architecture"] == "amd64",
            "workload image platform differs",
        )
        if name not in ("site", "bot", "game"):
            require(
                tagged.get("Config", {})
                .get("Labels", {})
                .get("org.opencontainers.image.revision")
                == images[name]["commit"],
                "infrastructure source revision differs",
            )
        user = str(service.get("user", ""))
        require(
            service.get("restart") == "unless-stopped"
            and service.get("read_only") is True
            and (
                user in ("0", "0:0")
                if name == "gateway"
                else re.fullmatch(r"[1-9][0-9]*(?::[0-9]+)?", user)
            )
            and (
                set(service.get("cap_add", []))
                == {"NET_BIND_SERVICE", "SETUID", "SETGID"}
                if name == "gateway"
                else not service.get("cap_add")
            )
            and not service.get("privileged")
            and "ALL" in service.get("cap_drop", [])
            and "no-new-privileges:true" in service.get("security_opt", [])
            and service.get("healthcheck", {}).get("test"),
            "invalid container runtime policy",
        )
        for volume in service.get("volumes", []):
            require(
                volume.get("type") == "bind"
                and allowed_mount(name, volume, release, root, manifest, rollback),
                "production mounts must stay inside the Shenron shared store",
            )
        if name not in ("site", "bot"):
            require(
                not declared["services"][name].get("env_file"),
                "infrastructure workloads must not receive application secrets",
            )
            continue
        # Inspect unexpanded env-file declarations without ever printing their values.
        env_files = declared["services"][name].get("env_file", [])
        require(env_files, "private runtime environment file required")
        keys = set()
        for entry in env_files:
            path = pathlib.Path(entry["path"] if isinstance(entry, dict) else entry)
            require(
                not path.is_symlink()
                and path.resolve().is_relative_to(env_root)
                and path.is_file()
                and path.stat().st_mode & 0o777 == 0o600,
                "runtime environment must be a contained private 0600 file",
            )
            for line in path.read_text().splitlines():
                line = line.strip().removeprefix("export ").strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    if value.strip().strip("\"'"):
                        keys.add(key.strip())
        policy = contract.get("shenron-" + name)
        require(policy is not None, "installed secrets contract lacks the workload")
        require(
            all(
                secret["name"] in keys
                for secret in policy.get("secrets", [])
                if secret.get("required")
            ),
            "private runtime environment lacks required secrets-contract keys",
        )
    asset = manifest.get("publicVfs", {})
    vfs = pathlib.Path(asset.get("path", "/missing"))
    require(
        not vfs.is_symlink()
        and vfs.is_file()
        and vfs.resolve().is_relative_to(root / "shared" / "server" / "data")
        and file_digest(vfs) == asset.get("sha256"),
        "qualified public VFS is missing or changed",
    )
    with sqlite3.connect(vfs.resolve().as_uri() + "?mode=ro", uri=True) as db:
        require(
            db.execute("PRAGMA quick_check").fetchone() == ("ok",),
            "VFS integrity check failed",
        )
        require(
            db.execute("SELECT value FROM vfs_meta WHERE key='profile'").fetchone()
            == ("public",),
            "only the public VFS profile may serve this release",
        )
        for table in ("vfs_nodes", "rag_doc_attrs"):
            require(
                db.execute(
                    f"SELECT count(*) FROM {table} WHERE visibility != 'public'"
                ).fetchone()[0]
                == 0,
                "VFS contains non-public content",
            )
        require(
            db.execute("SELECT count(*) FROM chunks").fetchone()[0] > 0,
            "public RAG corpus is empty",
        )
    return compose, expected_images


def switch(root, release):
    current = root / "current"
    temporary = root / (".current.docker." + str(os.getpid()))
    if temporary.is_symlink():
        temporary.unlink()
    temporary.symlink_to(release)
    os.replace(temporary, current)


def publish_compose(compose, root):
    """~/apps/shenron/compose.yaml, included by ~/apps/compose.yaml, follows the active release."""
    text = command(compose + ["config", "--format", "json"])
    temporary = root / (".compose.yaml." + str(os.getpid()))
    temporary.write_text(
        "# Generated from current/compose.yaml by atomic-deploy-shenron-container.py; included by ~/apps/compose.yaml.\n"
        + text
    )
    temporary.chmod(0o640)
    os.replace(temporary, root / "compose.yaml")


def compose_states(compose):
    # The host project also runs the other apps of ~/apps/compose.yaml: only this release's services count.
    output = command(compose + ["ps", "--all", "--orphans=false", "--format", "json"])
    try:
        states = json.loads(output or "[]")
    except json.JSONDecodeError:
        states = [json.loads(line) for line in output.splitlines() if line.strip()]
    return [states] if isinstance(states, dict) else states


def restore_backup(backup, root):
    require(
        backup.parent == root / "deploy-backups",
        "rollback record outside deployment backups",
    )
    record = json.loads((backup / "ROLLBACK.json").read_text())
    require(record.get("kind") == "shenron-docker", "not a Docker rollback record")
    target = pathlib.Path(record["target"]).resolve(strict=True)
    require(target.parent == root / "releases", "rollback target outside releases")
    current = root / "current"
    require(
        current.is_symlink() and current.resolve() == target,
        "rollback refuses to replace a newer activation",
    )
    previous = (
        pathlib.Path(record["previous"]).resolve(strict=True)
        if record.get("previous")
        else None
    )
    if previous == target:
        print("same immutable release; current pointer preserved")
        return
    previous_config = verify(previous, root, True) if previous else None
    previous_services = record.get("previousActiveServices")
    if previous_services is not None:
        require(
            isinstance(previous_services, list)
            and all(isinstance(name, str) for name in previous_services)
            and len(previous_services) == len(set(previous_services))
            and set(previous_services).issubset(
                previous_config[1] if previous_config else {}
            ),
            "rollback active services differ from previous sealed release",
        )
    compose = [
        "docker",
        "compose",
        "--project-name",
        PROJECT,
        "--env-file",
        str(target / "deploy.env"),
        "-f",
        str(target / "compose.yaml"),
    ] + overrides(root)
    command(compose + ["stop"])
    if previous:
        switch(root, previous)
        if previous_services is None or previous_services:
            command(
                previous_config[0]
                + [
                    "up",
                    "--detach",
                    "--no-build",
                    "--pull",
                    "never",
                    "--wait",
                    "--wait-timeout",
                    "180",
                ]
                + (
                    ["--no-deps", *previous_services]
                    if previous_services is not None
                    else []
                )
            )
        publish_compose(previous_config[0], root)
    else:
        current.unlink()
    print("Docker rollback verified")


def activate(release, root):
    compose, expected_images = verify(release, root)
    current = root / "current"
    require(
        not current.exists() or current.is_symlink(),
        "current must be a release symlink",
    )
    previous = current.resolve() if current.is_symlink() else None
    previous_services = []
    if previous and previous != release:
        previous_compose, previous_images = verify(previous, root, True)
        states = compose_states(previous_compose)
        require(
            all(
                entry.get("Service") in previous_images
                and entry.get("State") in ("running", "exited", "created")
                and (
                    entry.get("State") != "running" or entry.get("Health") == "healthy"
                )
                for entry in states
            ),
            "previous release has undeclared or unqualified active containers",
        )
        previous_services = sorted(
            entry["Service"] for entry in states if entry["State"] == "running"
        )
    units = ["shenron-site.service", "shenron-bot.service", "shenron-mcp-http.service"]
    if "postgres" in expected_images:
        units.extend(["postgresql@18-main.service", "redis-server.service"])
    if "gateway" in expected_images:
        units.append("nginx.service")
    if "chat" in expected_images:
        units.append("aphrody-llama-shenron-chat.service")
    for unit in units:
        active = subprocess.run(
            ["systemctl", "is-active", "--quiet", unit],
            capture_output=True,
            check=False,
        )
        require(
            active.returncode in (3, 4),
            "legacy writer or systemd availability prevents Docker activation",
        )
    backup_root = root / "deploy-backups"
    backup_root.mkdir(mode=0o700, exist_ok=True)
    backup = pathlib.Path(tempfile.mkdtemp(prefix="docker-", dir=backup_root))
    (backup / "ROLLBACK.json").write_text(
        json.dumps(
            {
                "kind": "shenron-docker",
                "previous": str(previous) if previous else None,
                "target": str(release),
                "images": expected_images,
                "previousActiveServices": previous_services,
            }
        )
        + "\n"
    )
    mutated = False
    try:
        # Docker restart policy supplies boot activation; one Compose project owns both workloads.
        switch(root, release)
        mutated = True
        command(
            compose
            + [
                "up",
                "--detach",
                "--no-build",
                "--pull",
                "never",
                "--wait",
                "--wait-timeout",
                "180",
            ]
        )
        states = compose_states(compose)
        require(
            {entry["Service"] for entry in states} == set(expected_images)
            and all(
                entry.get("Health") == "healthy" and entry.get("State") == "running"
                for entry in states
            ),
            "all production containers must be running and healthy",
        )
        for entry in states:
            runtime = json.loads(
                command(["docker", "container", "inspect", entry["ID"]])
            )[0]
            require(
                runtime["Image"] == expected_images[entry["Service"]],
                "running container differs from sealed image",
            )
    except Exception:
        if mutated:
            restore_backup(backup, root)
        raise
    publish_compose(compose, root)
    print("Docker activation verified; rollback=" + str(backup))


def main():
    require(os.geteuid() == 0, "run as root")
    args = sys.argv[1:]
    mode, target = (
        ("activate", args[0])
        if len(args) == 1
        else args
        if len(args) == 2
        else (None, None)
    )
    require(
        mode in ("activate", "verify", "restore"),
        "usage: adapter [activate|verify] RELEASE | restore BACKUP",
    )
    root = pathlib.Path(
        os.environ.get("SHENRON_RELEASE_ROOT", "/home/ubuntu/apps/shenron")
    ).resolve()
    release = pathlib.Path(target).resolve(strict=True)
    with (root / ".docker-deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if mode == "restore":
            restore_backup(release, root)
        elif mode == "verify":
            verify(release, root)
            print("sealed Docker release verified")
        else:
            activate(release, root)


if __name__ == "__main__":
    try:
        main()
    except (
        DeploymentError,
        OSError,
        ValueError,
        KeyError,
        sqlite3.Error,
        subprocess.TimeoutExpired,
    ) as error:
        # Unexpected parser/database errors can expose runtime values; keep them out of logs.
        print(
            str(error)
            if isinstance(error, DeploymentError)
            else "Docker deployment validation failed",
            file=sys.stderr,
        )
        sys.exit(2)
