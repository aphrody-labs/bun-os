# Bun OS Omarchy image inputs

The preferred Docker source is the official, signed-package-lock Omarchy
guest root filesystem from `try-omarchy-windows` release `v0.12.0`. This is a
complete upstream Omarchy rootfs, not a pacman-resolved partial candidate.
The exact release identity, package versions, asset hashes, and safe import
requirements are recorded in [SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md).
[`guest-inputs.json`](guest-inputs.json) and [`import.ts`](import.ts) now
implement the bounded, digest-verified ext4 import, including a metadata
receipt and generated Dockerfile. The root image builder still needs to invoke
the helper on the VPS under its shared factory lock and build the generated
`import.Containerfile`; no imported image has been built or qualified yet.

The generated Dockerfile exposes `imported-rootfs` and `c2w-terminal` targets
with `/bin/bash --login`. The c2w target is shell-only. The official release
also provides the Linux kernel and initramfs for a separate native QEMU/KVM
browser-desktop fallback; that guest launch path still requires factory
integration and qualification. The c2w conversion is a distinct experimental
target and does not imply that c2w supports a graphical desktop.

## Package-resolved candidate (superseded as the preferred input)

This earlier path is an explicitly unqualified source-candidate image built through the
root image factory from signed Arch/CachyOS and Omarchy pacman repositories.
It installs stable Omarchy 4.0.4 settings plus a deliberately small Hyprland
desktop package selection. Build-time `pacman -Q` output is retained inside
the image as a diagnostic receipt; it is not an immutable package lock or a
release receipt. This is not a full Bun OS `/usr` composition.

The `desktop` target starts the package-installed Omarchy Hyprland bootstrap
as an image-local non-root account, using a temporary XDG home and a small
`~/.config` override. It does not import a host home, copy `/etc/skel` into a
live home, run the Omarchy disk installer or migration, or enable host
services. Current Hyprland's documented `AQ_NO_KMS_REQUIREMENT=1` option and
software Mesa rendering are used for a headless experiment. Startup verifies
the actual Wayland socket and instance signature, checks for `HEADLESS-0`, and
starts WayVNC on `127.0.0.1:5900`. Every wait is bounded. Native Docker runtime,
input, screenshots, portals, audio and resource qualification are still
required before treating the desktop as supported.

The package-only candidate requires the stable Omarchy 4.0.4 `omarchy-settings` package
(including its packaging release) and derives `OMARCHY_PATH` from that
package's installed file list. It fails if the package version differs from
the 4.0.4 release or it does not ship `default/hypr/bootstrap.lua`. The package profile also
includes Hyprland, Quickshell, UWSM, portal/audio dependencies, WayVNC and
Mesa. Stable recipe source `omacom/omarchy` commit
`c668141e9c42b13c80c9ca4ea108e11708c5e8a5` is distinct from the `quattro`
manual/reference checkout; the two must not be mixed.

The official [Try Omarchy for Windows guest builder](https://github.com/omacom/try-omarchy-windows)
at commit `3b497519f5f4b320b33aa7bfaf8e3ec12ecb2b64` is a separate Omarchy
4.0.4 guest-build reference. Its `guest-build/source.lock.json` pins
`jorge-huxley/try-omarchy-win` commit
`aa009bd828037727de212c1412ccbe6ed7c95c7b` and applies a reviewed patch stack
with a package lock, headless session canary, and software-graphics fallback.
Use it as source and qualification evidence when completing the root candidate
closure. This image does not import the Windows launcher, QEMU guest
integration patches, user data, or its disk installer.

The prior root factory candidate hook calls
`planOmarchyCandidate(profile, usrManifest, integration)` from [stage.ts](stage.ts)
before its full `/usr` lock gate. It stages `pacman.conf`, the selected package
list, pinned bootstrap image and the repository signing keys from existing
manifests. Candidate resolution remains unqualified until the exact package
closure and runtime qualification are recorded.

The following commands describe only that package-resolved candidate path;
the official rootfs import requires the new import hook and manifest target
to be integrated by the root factory owner.

## Container targets

Use `bun factory image build bunos-omarchy --target source-candidate` to build
the package-only candidate, then `--target desktop` for the headless session.
The root owner must add the image manifest registration and the narrow staging
hook first. Run builds and qualification only on the configured Linux VPS
factory lane; no Windows/WSL build is supported.

The image binds WayVNC to loopback by default. If mapping it from Docker, bind
the host port to loopback and terminate authenticated TLS in a trusted host
proxy. Do not publish raw VNC. The health probe limits Hyprland IPC and port
checks to three seconds.

## Browser terminal conversion

`c2w-convert.sh` and [c2w-conversion.json](c2w-conversion.json) prepare an
experimental terminal-only browser bundle from the imported
`bunos-omarchy:imported-rootfs` image. The pinned Linux VPS binary, embedded
Dockerfile hash, and all 25 `nproc` compiler invocations are checked; each is
rewritten to `-j4`. A stable named BuildKit builder preserves its cache and
serializes build steps to one under the shared factory lock. The script exports
the complete image as an external OCI Image Layout, then invokes c2w with
`--external-bundle --to-js`. It separately checks out the exact v0.8.4 source
commit, builds the upstream Go imagemounter with parallelism capped at four,
and bundles the upstream xterm frontend using Bun. Resulting static assets are
assembled in `web/htdocs/`; serve that directory as the site root, with the OCI
layout at `/omarchy/`. The browser requires `COOP: same-origin`,
`COEP: require-corp`, and CORS-capable access to the OCI layout. The upstream
page loads xterm modules from CDNs, so cross-origin availability and browser
isolation remain runtime qualification gates. This is not a graphical desktop
claim. See the [upstream Emscripten example](https://github.com/container2wasm/container2wasm/tree/v0.8.4/examples/no-conversion-emscripten)
and [imagemounter guide](https://github.com/container2wasm/container2wasm/tree/v0.8.4/extras/imagemounter).

The conversion is prepared but not launched while the factory slot is busy.
After the imported Docker image is built and the shared factory lock is free,
the root owner should launch on the VPS with:

```sh
bash factory/images/bunos-omarchy/c2w-convert.sh \
  bunos-omarchy:imported-rootfs \
  /home/ubuntu/bun-os-images/bunos-omarchy-c2w-<unique-job> \
  /home/ubuntu/bun-os-images \
  <factoryConfig.lockPath>
```

Use a new private job directory and the exact lock path from the configured
factory; the script refuses existing output, leaves the default Docker builder
alone, and retains the stable `bunos-omarchy-c2w-j4` builder cache for future
conversions. The BuildKit config is installed once at
`$PRIVATE_ROOT/bunos-omarchy-c2w-buildkitd.toml`; a mismatch causes a safe stop.
The 2 GiB guest-memory setting is an experiment budget, not proof browsers can
allocate it. The frontend and imagemounter are packaged but the browser session,
network headers, memory pressure, and image boot remain unqualified. GUI output
remains unsupported. See [NOTICES.md](NOTICES.md) for converter pins and
third-party notices.
