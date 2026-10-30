# SPDX-License-Identifier: Apache-2.0
"""Qualify training/fixture licenses, rebuilds and minimal installed imports."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import shutil
import tarfile
import tempfile
import zipfile
from email.parser import BytesParser
from pathlib import Path

from qualify_aphrody import PY_ROOT, REPOSITORY, dirty_paths, run

PACKAGES = {
    "aphrody-train": "packages/aphrody-train",
    "aphrody-embedding-fixtures": "packages/embedding-fixtures",
}
NOTICES = {
    "LICENSE": "a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9",
    "NOTICE": "8ada1e46ed5127386bf3816ce54513f175de5890a167893303d0d88b44c766f0",
}


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def wheel_notices(path: Path) -> dict:
    with zipfile.ZipFile(path) as wheel:
        names = wheel.namelist()
        assert len(names) == len(set(names)), "Duplicate wheel members"
        metadata = BytesParser().parsebytes(
            wheel.read(next(n for n in names if n.endswith("/METADATA")))
        )
        assert metadata["License-Expression"] == "Apache-2.0"
        assert set(metadata.get_all("License-File", [])) == set(NOTICES)
        for name, expected in NOTICES.items():
            member = next(n for n in names if n.endswith("/licenses/" + name))
            assert digest(wheel.read(member)) == expected, name
        record = next(n for n in names if n.endswith("/RECORD"))
        rows = list(csv.reader(io.StringIO(wheel.read(record).decode())))
        assert {row[0] for row in rows} == set(names)
        for name, sha, size in rows:
            if name == record:
                assert not sha and not size
                continue
            content = wheel.read(name)
            expected = base64.urlsafe_b64encode(hashlib.sha256(content).digest())
            assert sha == "sha256=" + expected.decode().rstrip("=")
            assert size == str(len(content))
    return {
        "license_expression": "Apache-2.0",
        "notice_sha256": NOTICES,
        "record": "passed",
    }


def qualify(work: Path, python: str) -> dict:
    env = os.environ.copy()
    for name in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT"):
        env.pop(name, None)
    env["SOURCE_DATE_EPOCH"] = "1727740800"
    clone = PY_ROOT
    report = {
        "schema_version": 1,
        "input_mode": "monorepo-in-place",
        "git_revision": run(["git", "rev-parse", "HEAD"], REPOSITORY, env),
        "dirty_paths": dirty_paths(),
        "source_notice_revision": "aphrody-ai@4a9e529fb721d5fb7a0ba87313a98928c2ab47a5",
        "uv_lock_sha256": digest((clone / "uv.lock").read_bytes()),
        "packages": {},
        "unqualified": [
            "Model generation/training",
            "CPU/CUDA full extras",
            "Windows/macOS release artifacts",
        ],
    }
    wheels = []
    for package, directory in PACKAGES.items():
        source = clone / directory
        stage = work / package
        shutil.copytree(source, stage)
        inputs = {
            str(p.relative_to(stage)): digest(p.read_bytes())
            for p in stage.rglob("*")
            if p.is_file()
        }
        direct = work / (package + "-direct")
        artifacts = work / (package + "-sdist")
        run(
            [
                "uv",
                "--no-config",
                "build",
                "--wheel",
                "--python",
                python,
                "--out-dir",
                str(direct),
                str(stage),
            ],
            work,
            env,
        )
        run(
            [
                "uv",
                "--no-config",
                "build",
                "--sdist",
                "--python",
                python,
                "--out-dir",
                str(artifacts),
                str(stage),
            ],
            work,
            env,
        )
        sdist = next(artifacts.glob("*.tar.gz"))
        with tarfile.open(sdist) as archive:
            for name, expected in NOTICES.items():
                member = next(n for n in archive.getnames() if n.endswith("/" + name))
                extracted = archive.extractfile(member)
                assert extracted is not None and digest(extracted.read()) == expected
        run(
            [
                "uv",
                "--no-config",
                "build",
                "--wheel",
                "--python",
                python,
                "--out-dir",
                str(artifacts),
                str(sdist),
            ],
            work,
            env,
        )
        wheel = next(direct.glob("*.whl"))
        rebuilt = next(artifacts.glob("*.whl"))
        evidence = wheel_notices(wheel)
        assert wheel_notices(rebuilt) == evidence
        assert wheel.read_bytes() == rebuilt.read_bytes(), "Wheel bytes differ"
        evidence.update(
            {
                "input_sha256": inputs,
                "wheel_sha256": digest(wheel.read_bytes()),
                "sdist_sha256": digest(sdist.read_bytes()),
                "rebuilt_wheel_sha256": digest(rebuilt.read_bytes()),
                "wheel_bytes_identical": True,
            }
        )
        report["packages"][package] = evidence
        wheels.append(str(rebuilt))
    requirements = work / "requirements.txt"
    run(
        [
            "uv",
            "export",
            "--locked",
            "--package",
            "aphrody-train",
            "--package",
            "aphrody-embedding-fixtures",
            "--no-default-groups",
            "--no-emit-local",
            "--no-header",
            "--no-annotate",
            "--output-file",
            str(requirements),
        ],
        clone,
        env,
    )
    venv = work / "venv"
    run(["uv", "--no-config", "venv", "--python", python, str(venv)], work, env)
    interpreter = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    run(
        [
            "uv",
            "--no-config",
            "pip",
            "install",
            "--python",
            str(interpreter),
            "--require-hashes",
            "-r",
            str(requirements),
        ],
        work,
        env,
    )
    run(
        [
            "uv",
            "--no-config",
            "pip",
            "install",
            "--python",
            str(interpreter),
            "--no-deps",
            *wheels,
        ],
        work,
        env,
    )
    run(["uv", "--no-config", "pip", "check", "--python", str(interpreter)], work, env)
    run(
        [
            str(interpreter),
            "-I",
            "-c",
            """
from pathlib import Path
import sys
import aphrody_train, aphrody_embedding_fixtures
from aphrody_train import GpuRagEngine, MultimodalDoc
from aphrody_embedding_fixtures import EmbeddingFixtureGenerator, RerankFixtureGenerator
for module in (aphrody_train, aphrody_embedding_fixtures):
    assert Path(module.__file__).is_relative_to(Path(sys.prefix))
assert 'torch' not in sys.modules and 'sentence_transformers' not in sys.modules
assert 'numpy' not in sys.modules
""",
        ],
        work,
        env,
    )
    for module in ("generate_reference", "generate_rerank_reference"):
        run(
            [
                str(interpreter),
                "-I",
                "-m",
                "aphrody_embedding_fixtures." + module,
                "--help",
            ],
            work,
            env,
        )
    report["installed_outside_checkout"] = True
    report["public_object_imports"] = (
        "passed without undeclared optional ML dependencies"
    )
    report["requirements_sha256"] = digest(requirements.read_bytes())
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", default="3.12")
    parser.add_argument("--report", type=Path, required=True)
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(
        prefix="aphrody-ai-resource-qualification-"
    ) as temp:
        report = qualify(Path(temp), options.python)
    options.report.parent.mkdir(parents=True, exist_ok=True)
    options.report.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                name: {k: v for k, v in package.items() if k != "input_sha256"}
                for name, package in report["packages"].items()
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
