# SPDX-License-Identifier: Apache-2.0
"""One public source/runtime identity contract for sealing and Docker activation."""
import hashlib
import re


def deployment(value, commit):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"schema", "id", "commit", "runtime"}:
        raise ValueError("invalid source/runtime deployment receipt")
    runtime = value["runtime"]
    if not isinstance(runtime, dict) or set(runtime) != {"sha256", "version", "revision", "sourceUrl"}:
        raise ValueError("invalid qualified runtime pins")
    patterns = {"sha256": r"[a-f0-9]{64}", "version": r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?",
                "revision": r"[a-f0-9]{40}", "sourceUrl": r"https://github\.com/oven-sh/bun/releases/download/[^\s]+"}
    if value["schema"] != "shenron-source-runtime/v1" or value["commit"] != commit or not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("deployment source differs")
    if any(not isinstance(runtime[key], str) or not re.fullmatch(pattern, runtime[key]) for key, pattern in patterns.items()):
        raise ValueError("qualified runtime pins differ")
    identity = hashlib.sha256("\n".join([value["schema"], commit, runtime["sha256"], runtime["version"], runtime["revision"], runtime["sourceUrl"]]).encode()).hexdigest()
    if value["id"] != identity:
        raise ValueError("deployment digest differs")
    return value


def release_name(commit, value=None):
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("invalid source commit")
    selected = deployment(value, commit)
    return "docker-" + commit + ("-" + selected["id"] if selected else "")


def require_release_name(name, commit, value=None):
    if name != release_name(commit, value) and not (value is None and name == commit):
        raise ValueError("release name differs from source/runtime identity")
