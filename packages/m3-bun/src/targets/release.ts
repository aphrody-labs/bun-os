// SPDX-License-Identifier: Apache-2.0
// GitHub release workflow: on a `v*` tag, every runner installs upstream Bun with oven-sh/setup-bun at the version
// of the app, packages the app for each target with `m3-bun package` and attaches the archives and their
// SHA-256 to the GitHub release. The release scripts of the Bun repository (packages/bun-release) publish Bun
// itself and are not reused here.
import { GENERATED_NOTE } from "../util.ts";
import type { Target, TargetContext, TargetFile } from "./types.ts";

export const RELEASE_MATRIX = [
  { target: "linux-x64", os: "ubuntu-latest" },
  { target: "linux-x64-musl", os: "ubuntu-latest" },
  { target: "linux-arm64", os: "ubuntu-24.04-arm" },
  { target: "windows-x64", os: "ubuntu-latest" },
  { target: "darwin-arm64", os: "macos-latest" },
] as const;

export const releaseWorkflow = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Release ${c.name}: \`git tag v${c.version} && git push --tags\`. Copy to .github/workflows/release.yml.
name: release
on:
  push:
    tags: ["v*"]
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: release-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  package:
    strategy:
      fail-fast: false
      matrix:
        include:
${RELEASE_MATRIX.map(m => `          - { target: ${m.target}, os: ${m.os} }`).join("\n")}
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${c.bunVersion}
      - run: bun --revision
      - run: bun install --frozen-lockfile
      - run: bun test
        if: matrix.target == 'linux-x64'
      - name: Package \${{ matrix.target }}
        run: ${c.cli} package --target \${{ matrix.target }} --out release
      - uses: actions/upload-artifact@v4
        with:
          name: ${c.name}-\${{ matrix.target }}
          path: release/*
          if-no-files-found: error
  publish:
    needs: package
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: release
          merge-multiple: true
      - name: Checksums
        working-directory: release
        run: sha256sum $(ls | grep -v '\\.sha256$' | grep -v SHA256SUMS) > SHA256SUMS
      - name: GitHub release
        if: startsWith(github.ref, 'refs/tags/')
        run: gh release create "$GITHUB_REF_NAME" release/* --repo "$GITHUB_REPOSITORY" --title "${c.name} $GITHUB_REF_NAME" --generate-notes --verify-tag
        env:
          GH_TOKEN: \${{ github.token }}
`;

export const release: Target = {
  id: "release",
  title: "GitHub release",
  description:
    ".github/workflows/release.yml: fork Bun via install.sh, m3-bun package for each target, archives and SHA256SUMS on the GitHub release",
  generate(c): TargetFile[] {
    return [{ path: ".github/workflows/release.yml", content: releaseWorkflow(c) }];
  },
};
