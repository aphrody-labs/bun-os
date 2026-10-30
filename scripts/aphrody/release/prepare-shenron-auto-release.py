#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Prepare a public Shenron release from verified production configuration."""

import argparse
import hashlib
import importlib.util
import json
import pathlib
import re
import shutil
import subprocess
import sys
from shenron_deployment_identity import deployment, release_name, require_release_name


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def public_path(name):
    path = pathlib.PurePosixPath(name)
    require(
        bool(name)
        and not path.is_absolute()
        and ".." not in path.parts
        and str(path) == name
        and "\\" not in name,
        "invalid manifest path",
    )
    require(
        name in ("compose.yaml", "deploy.env")
        or name.startswith(("nginx/", "public/", "cdn/_next/static/")),
        "manifest includes non-public files",
    )
    return path


def regular(path, root):
    require(path.is_relative_to(root), "path escapes root")
    require(
        not any(p.is_symlink() for p in (path, *path.parents)),
        "symlink refused",
    )
    require(path.is_file(), "regular public file required")


def load_stage(path):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("shenron_cdn_stage", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def public_preview_json_guards(text):
    """Extend only the two existing public CDN guards in a fresh sealed release."""
    old = r"publications/manga-catalogue/objects/[a-f0-9]{64}\.json"
    new = r"publications/(?:manga-catalogue|shueisha-official-previews)/objects/[a-f0-9]{64}\.json"
    guarded = False
    depth = 0
    lines = []
    for line in text.splitlines(keepends=True):
        if re.match(r"\s*location\s", line):
            guarded = bool(
                re.match(r"\s*location\s+@(?:cdn_worker|cdn_public_origin)\s*\{", line)
            )
            depth = 0
        if guarded and "if ($uri !~*" in line:
            require(old in line or new in line, "unrecognized public CDN path guard")
            line = line.replace(old, new)
        lines.append(line)
        if guarded:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                guarded = False
    return "".join(lines)


def public_vfs_gateway_candidate(previous, candidate, source_sha256):
    """Accept only a VFS gateway rendered from the currently sealed CDN config."""
    require(re.fullmatch(r"[a-f0-9]{64}", source_sha256), "invalid CDN source digest")
    require(
        hashlib.sha256(previous.encode()).hexdigest() == source_sha256,
        "CDN source digest differs from active sealed config",
    )
    include_lines = lambda value: re.findall(r"(?m)^\s*include\s+[^;]+;\s*$", value)
    require(
        include_lines(candidate) == include_lines(previous),
        "candidate changed sealed CDN includes",
    )
    cdn_fallbacks = len(re.findall(r"location\s+@cdn_(?:worker|public_origin)\s*\{", candidate))
    require(
        candidate.count("map $request_uri $shenron_vfs_asset_path {") == 1
        and candidate.count("location @vfs_asset {") >= 1
        and candidate.count("error_page 404 = @vfs_asset;") == cdn_fallbacks
        and cdn_fallbacks >= 1,
        "public VFS 404 gateway missing or duplicated",
    )
    require(
        "proxy_pass http://127.0.0.1:5011/api/v1/vfs/file?path=$shenron_vfs_asset_path;"
        in candidate
        and 'if ($shenron_vfs_asset_path = "") { return 404; }' in candidate
        and "proxy_pass_request_headers off;" in candidate
        and "proxy_pass_request_body off;" in candidate,
        "public VFS gateway target or request policy is invalid",
    )
    require(
        "$http_cookie" not in candidate
        and "$http_authorization" not in candidate
        and "shenron-vfs.sqlite" not in candidate,
        "public VFS gateway exposes a private credential or store",
    )
    return public_preview_json_guards(candidate)


def prepare(args):
    require(re.fullmatch(r"[a-f0-9]{40}", args.commit), "invalid commit")
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", args.image_id), "invalid image ID")
    root = args.root.resolve(strict=True)
    require(root != pathlib.Path("/"), "invalid release root")
    require(
        not args.previous.is_symlink(), "previous must be a resolved release directory"
    )
    previous = args.previous.resolve(strict=True)
    selected = deployment(json.loads(args.deployment.read_text()) if args.deployment else None, args.commit)
    release = root / "releases" / release_name(args.commit, selected)
    require(previous.parent == root / "releases", "previous outside release root")
    require(not release.exists() and not release.is_symlink(), "fresh release required")
    regular(previous / "release.json", previous)
    manifest = json.loads((previous / "release.json").read_text())
    require(
        manifest.get("schemaVersion") == 1
        and manifest.get("runtime") == "docker"
        and manifest.get("repository") == "shenron"
        and manifest.get("target") == "dbfr",
        "qualified DBFR Docker manifest required",
    )
    old_commit = manifest.get("commit", "")
    require(re.fullmatch(r"[a-f0-9]{40}", old_commit), "invalid previous commit")
    require_release_name(previous.name, old_commit, manifest.get("deployment"))
    files = manifest.get("files", {})
    require(
        isinstance(files, dict) and {"compose.yaml", "deploy.env"} <= files.keys(),
        "missing public manifest",
    )
    for name, sha in files.items():
        relative = public_path(name)
        require(re.fullmatch(r"[a-f0-9]{64}", sha), "invalid public digest")
        source = previous / relative
        regular(source, previous)
        require(digest(source) == sha, "previous public digest mismatch")
    # Reject undeclared files, symlinks and special entries instead of copying trees.
    for path in previous.rglob("*"):
        require(not path.is_symlink(), "previous release contains symlink")
        if path.is_dir():
            continue
        require(path.is_file(), "previous release contains special file")
        require(
            path.name == "release.json"
            and path.parent == previous
            or path.relative_to(previous).as_posix() in files,
            "previous release contains unsealed file",
        )
    vfs = pathlib.Path(manifest.get("publicVfs", {}).get("path", ""))
    require(
        vfs.is_absolute() and vfs.resolve().is_relative_to(root / "shared/server/data"),
        "VFS outside public store",
    )
    regular(vfs, root)
    require(
        digest(vfs) == manifest["publicVfs"].get("sha256"), "public VFS digest mismatch"
    )
    images = manifest.get("images", {})
    require(
        isinstance(images, dict) and "gateway" in images, "gateway identity required"
    )
    for role, identity in images.items():
        require(
            role in ("gateway", "postgres", "redis", "chat"),
            "unknown infrastructure role",
        )
        require(
            re.fullmatch(r"sha256:[a-f0-9]{64}", identity.get("id", ""))
            and re.fullmatch(r"[a-f0-9]{40}", identity.get("commit", "")),
            "invalid infrastructure identity",
        )
    compose = json.loads((previous / "compose.yaml").read_text())
    services = compose.get("services", {})
    require({"site", "bot", "gateway"} <= services.keys(), "site/bot/gateway required")
    for role in ("site", "bot"):
        require(
            services[role].get("image") == manifest.get("imageId"),
            "previous application image mismatch",
        )
        services[role]["image"] = args.image_id
    for role, identity in images.items():
        require(
            services.get(role, {}).get("image") == identity["id"],
            "infrastructure image mismatch",
        )
    for service in services.values():
        volumes = service.get("volumes", [])
        require(all(isinstance(v, dict) for v in volumes), "long-form mounts required")
        service["volumes"] = [
            v
            for v in volumes
            if not (
                service is services["gateway"]
                and v.get("type") == "bind"
                and str(v.get("target", "")).endswith("/shenron-cdn/_next")
            )
        ]
        for volume in service["volumes"]:
            if volume.get("type") == "bind":
                source = pathlib.Path(volume.get("source", ""))
                if source.is_relative_to(previous):
                    relative = source.relative_to(previous)
                    require(
                        relative.parts
                        and ".." not in relative.parts
                        and relative.parts[0] in ("public", "nginx"),
                        "non-public release bind",
                    )
                    volume["source"] = str(release / relative)
    require(not args.artifact.is_symlink(), "artifact symlink refused")
    artifact = args.artifact.resolve(strict=True)
    require(args.seal_helper.is_file(), "seal helper missing")
    stage = load_stage(args.stage_helper)
    require(stage.inventory(artifact / "site"), "empty public site artifact")
    new_chunks = stage.inventory(artifact / "_next/static")
    require(new_chunks, "empty chunk artifact")
    old_chunks = previous / "cdn/_next/static"
    if old_chunks.exists():
        for name, sha in stage.inventory(old_chunks).items():
            require(
                name not in new_chunks or new_chunks[name] == sha,
                "immutable chunk collision",
            )
    nginx_updates = {}
    vfs_name = "nginx/cdn-dragonballfr-ssl.conf"
    require(vfs_name in files, "sealed CDN config is not declared")
    candidate_path = artifact / vfs_name
    regular(candidate_path, artifact)
    source_hash_path = artifact / (vfs_name + ".source.sha256")
    regular(source_hash_path, artifact)
    source_hash = source_hash_path.read_text().strip()
    old_cdn_config = (previous / vfs_name).read_text()
    nginx_updates[vfs_name] = public_vfs_gateway_candidate(
        old_cdn_config, candidate_path.read_text(), source_hash
    )
    for name in files:
        if name != vfs_name and name.startswith("nginx/") and name.endswith((".conf", ".inc")):
            before = (previous / name).read_text()
            after = public_preview_json_guards(before)
            if after != before:
                nginx_updates[name] = after
    # Retain configuration provenance, which never grants access to private stores.
    result = {
        "release": str(release),
        "previous": str(previous),
        "commit": args.commit,
        "publicFiles": len(files),
        "apply": args.apply,
        "activated": False,
        "publicPreviewJsonGuardFiles": sorted(nginx_updates),
    }
    if not args.apply:
        return result
    release.mkdir(mode=0o755)
    for name in files:
        if name.startswith("cdn/"):
            continue
        target = release / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        if name in nginx_updates:
            target.write_text(nginx_updates[name])
        else:
            shutil.copyfile(previous / name, target)
        target.chmod(0o644)
    (release / "compose.yaml").write_text(json.dumps(compose, indent=2) + "\n")
    stage.stage(release, artifact, previous)
    command = [
        sys.executable,
        str(args.seal_helper),
        str(release),
        "--commit",
        args.commit,
        "--image-id",
        args.image_id,
        "--public-vfs",
        str(vfs),
        "--gateway-image-id",
        images["gateway"]["id"],
        "--gateway-commit",
        images["gateway"]["commit"],
    ]
    if args.deployment:
        command += ["--deployment", str(args.deployment)]
    for role, identity in images.items():
        if role != "gateway":
            command += ["--service-image", role, identity["id"], identity["commit"]]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    if "configurationProvenance" in manifest:
        output = release / "release.json"
        sealed = json.loads(output.read_text())
        sealed["configurationProvenance"] = manifest["configurationProvenance"]
        output.write_text(json.dumps(sealed, indent=2, sort_keys=True) + "\n")
    result["sealed"] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, required=True)
    parser.add_argument("--previous", type=pathlib.Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--deployment", type=pathlib.Path)
    parser.add_argument("--image-id", required=True)
    parser.add_argument("--artifact", type=pathlib.Path, required=True)
    here = pathlib.Path(__file__).resolve().parent
    parser.add_argument(
        "--stage-helper", type=pathlib.Path, default=here / "stage-shenron-cdn.py"
    )
    parser.add_argument(
        "--seal-helper",
        type=pathlib.Path,
        default=here / "seal-shenron-docker-release.py",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--plan", action="store_true", help="validate without writes (default)"
    )
    mode.add_argument(
        "--apply", action="store_true", help="prepare and seal; never activate"
    )
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args), sort_keys=True))
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError):
        parser.exit(
            2, "Public release preparation refused; inspect configuration privately.\n"
        )


if __name__ == "__main__":
    main()
