# SPDX-License-Identifier: Apache-2.0
"""Deployment preflight and rollback tests; no Docker daemon or host mutations."""

import importlib.util
import json
import hashlib
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "container_adapter",
    pathlib.Path(__file__).with_name("atomic-deploy-shenron-container.py"),
)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class ContainerDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name).resolve()
        self.env = self.root / "etc"
        self.env.mkdir()
        self.env_file = self.env / "site.env"
        self.env_file.write_text("DATABASE_URL=private-fixture-value\n")
        self.env_file.chmod(0o600)
        self.share = self.root / "infra"
        self.share.mkdir()
        (self.share / "secrets-contract.json").write_text(
            json.dumps(
                {
                    "services": {
                        "shenron-site": {
                            "secrets": [{"name": "DATABASE_URL", "required": True}]
                        },
                        "shenron-bot": {"secrets": []},
                    }
                }
            )
        )
        self.addCleanup(patch.stopall)
        patch.dict(
            os.environ,
            SHENRON_ENV_ROOT=str(self.env),
            SHENRON_INFRA_SHARE=str(self.share),
        ).start()
        self.vfs = self.root / "shared/server/data/shenron-vfs.sqlite"
        self.vfs.parent.mkdir(parents=True)
        with sqlite3.connect(self.vfs) as db:
            db.executescript(
                "CREATE TABLE vfs_meta(key TEXT,value TEXT); INSERT INTO vfs_meta VALUES('profile','public');"
                "CREATE TABLE vfs_nodes(visibility TEXT); CREATE TABLE rag_doc_attrs(visibility TEXT);"
                "CREATE TABLE chunks(id INTEGER); INSERT INTO chunks VALUES(1);"
            )
        self.releases = []
        self.calls = []
        self.fail_up = None
        self.inspect_drift = False
        self.gateway = False
        self.infrastructure = []
        self.previous_stopped = set()
        patch.object(adapter, "command", side_effect=self.command).start()
        patch.object(
            adapter.subprocess, "run", return_value=subprocess.CompletedProcess([], 3)
        ).start()

    def release(self, digit):
        sha = digit * 40
        release = self.root / "releases" / ("docker-" + sha)
        release.mkdir(parents=True)
        (release / "compose.yaml").write_text("sealed-fixture-compose\n")
        (release / "deploy.env").write_text("SHENRON_IMAGE_TAG=" + sha + "\n")
        image_id = "sha256:" + digit * 64
        manifest = {
            "schemaVersion": 1,
            "runtime": "docker",
            "target": "dbfr",
            "repository": "shenron",
            "commit": sha,
            "imageId": image_id,
            "files": {
                name: adapter.file_digest(release / name)
                for name in ("compose.yaml", "deploy.env")
            },
            "publicVfs": {
                "path": str(self.vfs),
                "sha256": adapter.file_digest(self.vfs),
            },
        }
        (release / "release.json").write_text(json.dumps(manifest))
        self.releases.append((release, manifest))
        return release

    def test_runtime_release_suffix_preserves_the_real_source_revision(self):
        release = self.release("a")
        manifest = self.releases[-1][1]
        runtime = {"sha256": "b" * 64, "version": "1.4.5", "revision": "c" * 40,
                   "sourceUrl": "https://github.com/aphrody-labs/bun/releases/download/bun-v1.4.5/bun-linux-x64-full.zip"}
        fields = ["shenron-source-runtime/v1", manifest["commit"], *runtime.values()]
        identity = hashlib.sha256("\n".join(fields).encode()).hexdigest()
        manifest["deployment"] = {"schema": fields[0], "id": identity, "commit": manifest["commit"], "runtime": runtime}
        renamed = release.with_name(release.name + "-" + identity)
        release.rename(renamed)
        self.releases[-1] = (renamed, manifest)
        (renamed / "release.json").write_text(json.dumps(manifest))
        adapter.verify(renamed, self.root)
        self.assertEqual(manifest["commit"], "a" * 40)
        self.calls.clear()
        manifest["deployment"]["runtime"]["sha256"] = "d" * 64
        (renamed / "release.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(adapter.DeploymentError, "source/runtime identity"):
            adapter.verify(renamed, self.root)
        self.assertEqual(self.calls, [])

    def command(self, args):
        self.calls.append(args)
        if args[:3] == ["docker", "image", "inspect"]:
            if args[3] == "gateway:fixture":
                return json.dumps(
                    [
                        {
                            "Id": "sha256:" + "d" * 64,
                            "Os": "linux",
                            "Architecture": "amd64",
                            "Config": {
                                "Labels": {
                                    "org.opencontainers.image.revision": "e" * 40
                                }
                            },
                        }
                    ]
                )
            for _, manifest in self.releases:
                if args[3] in (manifest["imageId"], "shenron:" + manifest["commit"]):
                    return json.dumps(
                        [
                            {
                                "Id": manifest["imageId"],
                                "Os": "linux",
                                "Architecture": "amd64",
                                "Config": {
                                    "Labels": {
                                        "org.opencontainers.image.revision": manifest[
                                            "commit"
                                        ]
                                    }
                                },
                            }
                        ]
                    )
            raise AssertionError("unknown image")
        if args[:3] == ["docker", "container", "inspect"]:
            image = (
                self.releases[-1][1]["imageId"]
                if not self.inspect_drift
                else "sha256:" + "f" * 64
            )
            if args[3] in ("gateway", *self.infrastructure):
                image = "sha256:" + "d" * 64
            return json.dumps([{"Image": image}])
        release = pathlib.Path(args[args.index("-f") + 1]).parent
        manifest = next(m for r, m in self.releases if r == release)
        if "config" in args:
            service = {
                "image": "shenron:" + manifest["commit"],
                "restart": "unless-stopped",
                "read_only": True,
                "user": "1000:1000",
                "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "healthcheck": {"test": ["CMD", "health"]},
                "env_file": [{"path": str(self.env_file)}],
            }
            services = {"site": service, "bot": service}
            if self.gateway:
                gateway = dict(service)
                gateway.update(
                    image="gateway:fixture",
                    user="0:0",
                    cap_add=["NET_BIND_SERVICE", "SETUID", "SETGID"],
                )
                gateway.pop("env_file")
                services["gateway"] = gateway
            for role in self.infrastructure:
                state = dict(service)
                state.update(
                    image="gateway:fixture",
                    user="105:111" if role == "postgres" else "104:110",
                )
                state.pop("env_file")
                services[role] = state
            return json.dumps({"services": services})
        if "up" in args and release == self.fail_up:
            raise adapter.DeploymentError("fixture readiness failure")
        if "ps" in args:
            # Compose emits newline-delimited JSON, rather than an array, on some versions.
            return "\n".join(
                json.dumps(
                    {
                        "Service": name,
                        "State": "exited"
                        if (release, name) in self.previous_stopped
                        else "running",
                        "Health": ""
                        if (release, name) in self.previous_stopped
                        else "healthy",
                        "ID": name,
                    }
                )
                for name in (
                    (["site", "bot", "gateway"] if self.gateway else ["site", "bot"])
                    + self.infrastructure
                )
            )
        return ""

    def test_protected_database_pair_uses_sealed_infrastructure_image(self):
        self.infrastructure = ["postgres", "redis"]
        release = self.release("a")
        manifest = self.releases[-1][1]
        manifest["images"] = {
            name: {"id": "sha256:" + "d" * 64, "commit": "e" * 40}
            for name in self.infrastructure
        }
        (release / "release.json").write_text(json.dumps(manifest))
        adapter.activate(release, self.root)
        self.assertEqual(
            sum(call[:3] == ["docker", "container", "inspect"] for call in self.calls),
            4,
        )

    def test_incomplete_database_pair_rejected_before_activation(self):
        self.infrastructure = ["postgres"]
        release = self.release("a")
        with self.assertRaises(adapter.DeploymentError):
            adapter.activate(release, self.root)
        self.assertFalse(any("up" in call for call in self.calls))

    def test_gateway_activation_checks_distinct_image_and_source_revision(self):
        self.gateway = True
        release = self.release("a")
        manifest = self.releases[-1][1]
        manifest["images"] = {
            "gateway": {"id": "sha256:" + "d" * 64, "commit": "e" * 40}
        }
        (release / "release.json").write_text(json.dumps(manifest))
        adapter.activate(release, self.root)
        self.assertEqual(
            sum(call[:3] == ["docker", "container", "inspect"] for call in self.calls),
            3,
        )

    def test_gateway_rejects_private_and_writable_mounts(self):
        release = self.release("a")
        manifest = self.releases[-1][1]
        public = {
            "type": "bind",
            "source": str(self.root / "shared/site/wiki"),
            "target": "/home/ubuntu/apps/shenron-cdn/wiki",
            "read_only": True,
        }
        self.assertTrue(
            adapter.allowed_mount("gateway", public, release, self.root, manifest)
        )
        public["read_only"] = False
        self.assertFalse(
            adapter.allowed_mount("gateway", public, release, self.root, manifest)
        )
        public["read_only"] = True
        public["source"] = str(self.root / "shared/bot/data")
        self.assertFalse(
            adapter.allowed_mount("gateway", public, release, self.root, manifest)
        )
        public["source"] = "/etc/letsencrypt"
        public["target"] = "/etc/letsencrypt"
        self.assertFalse(
            adapter.allowed_mount("gateway", public, release, self.root, manifest)
        )

    def test_gateway_migrated_site_roots_are_read_only_and_identical(self):
        release = self.release("a")
        manifest = self.releases[-1][1]
        root = {
            "type": "bind",
            "source": "/home/ubuntu/apps/creator",
            "target": "/home/ubuntu/apps/creator",
            "read_only": True,
        }
        self.assertTrue(
            adapter.allowed_mount("gateway", root, release, self.root, manifest)
        )
        root["read_only"] = False
        self.assertFalse(
            adapter.allowed_mount("gateway", root, release, self.root, manifest)
        )
        root["read_only"] = True
        root["source"] = "/home/ubuntu/apps/lab"
        self.assertFalse(
            adapter.allowed_mount("gateway", root, release, self.root, manifest)
        )
        self.assertFalse(
            adapter.allowed_mount("bot", root, release, self.root, manifest)
        )

    def test_gateway_nginx_mount_allows_managed_vhosts_and_sealed_rollback(self):
        release = self.release("a")
        nginx = release / "nginx"
        nginx.mkdir()
        (nginx / "00.conf").write_text("a")
        manifest = self.releases[-1][1]
        manifest["files"]["nginx/00.conf"] = adapter.file_digest(nginx / "00.conf")
        (nginx / "zz-extra.conf").write_text("b")
        mount = {"source": str(nginx), "target": "/etc/nginx/conf.d", "read_only": True}
        self.assertTrue(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        (nginx / "unmanaged.conf").write_text("c")
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        self.assertTrue(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest, True)
        )
        (nginx / "00.conf").unlink()
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest, True)
        )

    def test_gateway_maintenance_mount_requires_exact_sealed_file(self):
        release = self.release("a")
        public = release / "public"
        public.mkdir()
        page = public / "50x.html"
        page.write_text("maintenance")
        manifest = self.releases[-1][1]
        mount = {
            "source": str(page),
            "target": "/var/www/shenron/50x.html",
            "read_only": True,
        }
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        manifest["files"]["public/50x.html"] = adapter.file_digest(page)
        self.assertTrue(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        mount["target"] = "/var/www/shenron/arbitrary.html"
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        mount["target"] = "/var/www/shenron/50x.html"
        mount["read_only"] = False
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        mount["read_only"] = True
        mount["source"] = str(self.env_file)
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )

    def test_gateway_nginx_mount_requires_every_file_sealed(self):
        release = self.release("a")
        nginx = release / "nginx"
        nginx.mkdir()
        route = nginx / "route.conf"
        route.write_text("fixture route")
        manifest = self.releases[-1][1]
        mount = {"source": str(nginx), "target": "/etc/nginx/conf.d", "read_only": True}
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        manifest["files"]["nginx/route.conf"] = adapter.file_digest(route)
        self.assertTrue(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )
        (nginx / "unsealed.conf").write_text("unexpected route")
        self.assertFalse(
            adapter.allowed_mount("gateway", mount, release, self.root, manifest)
        )

    def test_sealed_path_traversal_rejected_before_docker(self):
        release = self.release("a")
        manifest = self.releases[-1][1]
        manifest["files"]["../outside"] = "a" * 64
        (release / "release.json").write_text(json.dumps(manifest))
        with self.assertRaises(adapter.DeploymentError):
            adapter.verify(release, self.root)
        self.assertEqual(self.calls, [])

    def test_corrupt_package_has_no_activation(self):
        release = self.release("a")
        (release / "compose.yaml").write_text("tampered")
        with self.assertRaises(adapter.DeploymentError):
            adapter.activate(release, self.root)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / "current").exists())

    def test_private_vfs_rejected_even_when_checksum_is_sealed(self):
        with sqlite3.connect(self.vfs) as db:
            db.execute("INSERT INTO vfs_nodes VALUES('private')")
        release = self.release("a")
        with self.assertRaisesRegex(adapter.DeploymentError, "non-public"):
            adapter.activate(release, self.root)
        self.assertFalse(any("up" in call for call in self.calls))

    def test_environment_permissions_rejected_before_mutation(self):
        release = self.release("a")
        self.env_file.chmod(0o644)
        with self.assertRaisesRegex(adapter.DeploymentError, "0600"):
            adapter.activate(release, self.root)
        self.assertFalse(any("up" in call for call in self.calls))

    def test_success_checks_both_runtime_images(self):
        release = self.release("a")
        adapter.activate(release, self.root)
        self.assertEqual((self.root / "current").resolve(), release)
        self.assertEqual(
            sum(call[:3] == ["docker", "container", "inspect"] for call in self.calls),
            2,
        )
        up = next(call for call in self.calls if "up" in call)
        self.assertIn("--no-build", up)
        self.assertIn("never", up)

    def test_failed_readiness_stops_candidate_and_restores_previous(self):
        previous = self.release("a")
        candidate = self.release("b")
        (self.root / "current").symlink_to(previous)
        self.fail_up = candidate
        with self.assertRaisesRegex(adapter.DeploymentError, "readiness"):
            adapter.activate(candidate, self.root)
        self.assertEqual((self.root / "current").resolve(), previous)
        mutations = [call for call in self.calls if "up" in call or "stop" in call]
        self.assertEqual(
            ["up" if "up" in call else "stop" for call in mutations],
            ["up", "stop", "up"],
        )
        self.assertIn(str(previous / "compose.yaml"), mutations[-1])

    def test_running_image_drift_causes_rollback(self):
        release = self.release("a")
        self.inspect_drift = True
        with self.assertRaisesRegex(adapter.DeploymentError, "sealed image"):
            adapter.activate(release, self.root)
        self.assertFalse((self.root / "current").exists())

    def test_rollback_preserves_intentionally_stopped_bot(self):
        previous = self.release("a")
        candidate = self.release("b")
        (self.root / "current").symlink_to(previous)
        self.previous_stopped.add((previous, "bot"))
        self.fail_up = candidate
        with self.assertRaisesRegex(adapter.DeploymentError, "readiness"):
            adapter.activate(candidate, self.root)
        up = [call for call in self.calls if "up" in call][-1]
        self.assertEqual(up[-2:], ["--no-deps", "site"])
        record = next((self.root / "deploy-backups").glob("*/ROLLBACK.json"))
        self.assertEqual(
            json.loads(record.read_text())["previousActiveServices"], ["site"]
        )

    def test_rollback_does_not_start_an_inactive_previous_release(self):
        previous = self.release("a")
        candidate = self.release("b")
        (self.root / "current").symlink_to(previous)
        self.previous_stopped.update({(previous, "site"), (previous, "bot")})
        self.fail_up = candidate
        with self.assertRaisesRegex(adapter.DeploymentError, "readiness"):
            adapter.activate(candidate, self.root)
        self.assertEqual((self.root / "current").resolve(), previous)
        self.assertEqual(sum("up" in call for call in self.calls), 1)

    def test_rollback_rejects_undeclared_active_service_before_stop(self):
        previous = self.release("a")
        candidate = self.release("b")
        (self.root / "current").symlink_to(candidate)
        backup = self.root / "deploy-backups/fixture"
        backup.mkdir(parents=True)
        (backup / "ROLLBACK.json").write_text(
            json.dumps(
                {
                    "kind": "shenron-docker",
                    "target": str(candidate),
                    "previous": str(previous),
                    "previousActiveServices": ["unrelated"],
                }
            )
        )
        with self.assertRaisesRegex(adapter.DeploymentError, "active services"):
            adapter.restore_backup(backup, self.root)
        self.assertFalse(any("stop" in call or "up" in call for call in self.calls))

    def test_rollback_refuses_a_newer_current(self):
        previous = self.release("a")
        candidate = self.release("b")
        newer = self.release("c")
        (self.root / "current").symlink_to(newer)
        backup = self.root / "deploy-backups/fixture"
        backup.mkdir(parents=True)
        (backup / "ROLLBACK.json").write_text(
            json.dumps(
                {
                    "kind": "shenron-docker",
                    "target": str(candidate),
                    "previous": str(previous),
                }
            )
        )
        with self.assertRaisesRegex(adapter.DeploymentError, "newer activation"):
            adapter.restore_backup(backup, self.root)
        self.assertEqual(self.calls, [])


class PublicGamePolicyTests(unittest.TestCase):
    def fixture(self):
        return {
            "network_mode": "host", "entrypoint": ["/usr/local/bin/shenron-server"],
            "command": ["serve", "--host", "127.0.0.1", "--port", "5013"],
            "environment": {"SHENRON_PROFILE": "public", "SHENRON_SITE_SURFACE": "game", "SHENRON_HOME": "/var/lib/shenron-game", "SHENRON_SITE_URL": "https://dragonballfr.com", "SHENRON_PUBLIC_SITE_URL": "https://dragonballfr.com", "SHENRON_PUBLIC_GAME_URL": "https://play.dragonballfr.com"},
        }

    def test_public_game_is_accepted_without_private_environment(self):
        service = self.fixture()
        adapter.validate_public_game(service, service)

    def test_game_cannot_receive_secrets_or_private_mounts(self):
        for change in ({"env_file": ["/etc/private.env"]}, {"volumes": [{"source": "/srv/shenron/shared"}]}, {"ports": ["5013:5013"]}, {"command": ["serve", "--host", "0.0.0.0"]}):
            service = self.fixture()
            service.update(change)
            with self.assertRaises(adapter.DeploymentError):
                adapter.validate_public_game(service, service)
        service = self.fixture()
        service["environment"]["DATABASE_URL"] = "private-fixture"
        with self.assertRaises(adapter.DeploymentError):
            adapter.validate_public_game(service, service)


if __name__ == "__main__":
    unittest.main()
