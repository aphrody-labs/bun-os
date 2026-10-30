# SPDX-License-Identifier: Apache-2.0
"""Exact public preview JSON namespace; existing private path guards stay intact."""
import importlib.util
import pathlib
import re
import unittest

spec = importlib.util.spec_from_file_location(
    "prepare", pathlib.Path(__file__).with_name("prepare-shenron-auto-release.py")
)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

RULE = r'  if ($uri !~* "^/(?:publications/manga-catalogue/objects/[a-f0-9]{64}\.json|publications/[a-z0-9-]+/index\.json)$") { return 404; }'
PRIVATE = '  if ($uri ~* "(?:^|/)(?:api|private|cookies)(?:/|$)") { return 404; }'


class PublicPreviewGatewayTests(unittest.TestCase):
    def test_both_guards_accept_only_the_two_reviewed_json_namespaces(self):
        source = "\n".join(
            "location @" + name + " {\n" + RULE + "\n" + PRIVATE + "\n}"
            for name in ("cdn_worker", "cdn_public_origin")
        )
        result = prepare.public_preview_json_guards(source)
        self.assertEqual(prepare.public_preview_json_guards(result), result)
        self.assertEqual(result.count(PRIVATE), 2)
        patterns = re.findall(r'if \(\$uri !~\* "([^"]+)"', result)
        self.assertEqual(len(patterns), 2)
        for pattern in patterns:
            for sha in (
                "5551f8d635bfcf8a1353217c6157923c23d4d2e6a51accfced6e515244963875",
                "8e40a881cd3bea137f96a98409744325be1bd189ec83eb77da5758fd65ff3944",
            ):
                self.assertRegex("/publications/shueisha-official-previews/objects/" + sha + ".json", pattern)
            self.assertRegex("/publications/manga-catalogue/objects/" + "a" * 64 + ".json", pattern)
            for path in (
                "/publications/shueisha-official-previews/objects/badsha.json",
                "/publications/shueisha-official-previews/objects/" + "g" * 64 + ".json",
                "/publications/unreviewed/objects/" + "a" * 64 + ".json",
                "/publications/shueisha-official-previews/private/" + "a" * 64 + ".json",
                "/private/" + "a" * 64 + ".json",
            ):
                self.assertIsNone(re.search(pattern, path), path)

    def test_unrelated_locations_are_unchanged_and_unknown_guard_fails_closed(self):
        unrelated = "location @unrelated {\n" + RULE + "\n}"
        self.assertEqual(prepare.public_preview_json_guards(unrelated), unrelated)
        with self.assertRaisesRegex(ValueError, "unrecognized"):
            prepare.public_preview_json_guards('location @cdn_worker {\n if ($uri !~* "^/unknown$") { return 404; }\n}')

    def test_vfs_candidate_is_bound_to_active_config_and_keeps_includes(self):
        previous = "include /etc/nginx/conf.d/zz-cdn-origin.locations.inc;\nlocation @cdn_worker { return 404; }"
        candidate = """include /etc/nginx/conf.d/zz-cdn-origin.locations.inc;
map $request_uri $shenron_vfs_asset_path {
    default "";
}
location @cdn_worker { error_page 404 = @vfs_asset; }
location @vfs_asset {
  if ($shenron_vfs_asset_path = "") { return 404; }
  proxy_pass http://127.0.0.1:5011/api/v1/vfs/file?path=$shenron_vfs_asset_path;
  proxy_pass_request_headers off;
  proxy_pass_request_body off;
}
"""
        source_digest = prepare.hashlib.sha256(previous.encode()).hexdigest()
        self.assertEqual(
            prepare.public_vfs_gateway_candidate(previous, candidate, source_digest), candidate
        )
        with self.assertRaisesRegex(ValueError, "active sealed config"):
            prepare.public_vfs_gateway_candidate(previous, candidate, "0" * 64)
        with self.assertRaisesRegex(ValueError, "includes"):
            prepare.public_vfs_gateway_candidate(
                previous,
                candidate.replace("zz-cdn-origin.locations.inc", "other.inc"),
                source_digest,
            )
        with self.assertRaisesRegex(ValueError, "target or request policy"):
            prepare.public_vfs_gateway_candidate(
                previous,
                candidate.replace("/api/v1/vfs/file", "/api/v1/vfs/list"),
                source_digest,
            )


if __name__ == "__main__":
    unittest.main()
