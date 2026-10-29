/**
 * `buncc dotnet publish -r <rid>`: the publish plan for a Linux target, with the rules Microsoft documents for NativeAOT
 * (https://learn.microsoft.com/dotnet/core/deploying/native-aot/cross-compile): no cross-OS compilation, cross-architecture
 * only with a target-capable linker (clang), C runtime and zlib objects of the target. Arguments come from the existing
 * dotnet provider (publishArgs / aotPublishArgs); this file only decides whether the combination is allowed.
 */
import { aotPublishArgs, CHANNELS, publishArgs, runtimeIdentifier, type AotProfile, type MsbuildProps } from "../providers/dotnet.ts";

export interface PublishRequest {
  project?: string;
  rid: string;
  aot?: boolean;
  nativeLib?: "Shared" | "Static";
  selfContained?: boolean;
  channel?: "10.0" | "11.0";
  output?: string;
  props?: MsbuildProps;
  /** Host RID; defaults to the running machine. Injectable for tests. */
  hostRid?: string;
}

export interface PublishPlan {
  ok: boolean;
  args: string[];
  /** Why the request cannot work (cross-OS NativeAOT, ...). */
  errors: string[];
  /** Tools the request needs beyond the SDK. */
  needs: string[];
}

const parts = (rid: string) => {
  const m = /^(win|osx|linux)(-musl)?-(x64|arm64|arm|x86)$/.exec(rid);
  if (!m) throw new Error(`unsupported runtime identifier ${rid}`);
  return { os: m[1]!, musl: !!m[2], arch: m[3]! };
};

export function publishPlan(req: PublishRequest): PublishPlan {
  const target = parts(req.rid);
  const host = parts(req.hostRid ?? runtimeIdentifier());
  const errors: string[] = [];
  const needs: string[] = [];
  const channel = CHANNELS[req.channel ?? "10.0"];
  const profile: AotProfile = channel.channel === "11.0" ? "aot-dotnet11" : "aot-dotnet10";

  if (req.aot || req.nativeLib) {
    if (target.os !== host.os)
      errors.push(
        `NativeAOT does not support cross-OS compilation (${host.os} host, ${target.os} target): build ${req.rid} on a Linux host, in a container or in CI`,
      );
    else {
      if (target.arch !== host.arch)
        needs.push(`cross toolchain for ${target.arch}: clang/lld, target C runtime and zlib objects (e.g. gcc-aarch64-linux-gnu zlib1g-dev:arm64)`);
      if (target.musl !== host.musl)
        needs.push(`${target.musl ? "musl" : "glibc"} C runtime for the target: use the matching SDK (${target.musl ? "linux-musl" : "linux"} tarball) in an ${target.musl ? "Alpine" : "glibc"} container instead of crossing libc`);
      if (target.os === "linux") needs.push("clang", "zlib development headers (zlib1g-dev / zlib-dev)");
    }
    return {
      ok: errors.length === 0,
      errors,
      needs,
      args: aotPublishArgs({
        project: req.project,
        profile,
        rid: req.rid,
        output: req.output,
        nativeLib: req.nativeLib,
        props: req.props,
      }),
    };
  }
  // Framework-dependent or self-contained publish needs only the runtime pack from NuGet and works across OS.
  const props: MsbuildProps = { SelfContained: !!req.selfContained, ...req.props };
  return {
    ok: true,
    errors,
    needs,
    args: publishArgs({ project: req.project, rid: req.rid, framework: channel.tfm, output: req.output, props }),
  };
}
