// SPDX-License-Identifier: Apache-2.0
import { basename } from "node:path";

export type SourceRuntimeDeployment = {
  schema: "shenron-source-runtime/v1";
  id: string;
  commit: string;
  runtime: {
    sha256: string;
    version: string;
    revision: string;
    sourceUrl: string;
  };
};
export type DeploymentSelection = {
  commit: string;
  id: string;
  releaseName: string;
  deployment?: SourceRuntimeDeployment;
};

function sourceRuntimeIdentity(commit: string, runtime: SourceRuntimeDeployment["runtime"]): SourceRuntimeDeployment {
  if (
    commit.length !== 40 ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    Object.values(runtime).some(value => typeof value !== "string" || /\s/.test(value)) ||
    !/^[a-f0-9]{64}$/.test(runtime.sha256) ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runtime.version) ||
    !/^[a-f0-9]{40}$/.test(runtime.revision) ||
    !/^https:\/\/github\.com\/oven-sh\/bun\/releases\/download\/[^\s]+$/.test(runtime.sourceUrl)
  )
    throw Error("Source/runtime deployment requires exact qualified runtime pins");
  const schema = "shenron-source-runtime/v1";
  const id = new Bun.CryptoHasher("sha256")
    .update([schema, commit, runtime.sha256, runtime.version, runtime.revision, runtime.sourceUrl].join("\n"))
    .digest("hex");
  return {
    schema,
    id,
    commit,
    runtime: {
      sha256: runtime.sha256,
      version: runtime.version,
      revision: runtime.revision,
      sourceUrl: runtime.sourceUrl,
    },
  };
}

/** Enable only with the qualified runtime pins and the matching canonical host adapter. */
export function deploymentSelection(
  commit: string,
  config: {
    deploymentIdentity?: string;
    runtimeSha256?: string;
    runtimeExpected?: {
      version?: string;
      revision?: string;
      sourceUrl?: string;
    };
  },
): DeploymentSelection {
  if (commit.length !== 40 || !/^[a-f0-9]{40}$/.test(commit)) throw Error("Invalid Shenron source commit");
  if (config.deploymentIdentity === undefined) return { commit, id: commit, releaseName: `docker-${commit}` };
  if (config.deploymentIdentity !== "source-runtime-v1") throw Error("Unknown deployment identity contract");
  const deployment = sourceRuntimeIdentity(commit, {
    sha256: config.runtimeSha256 ?? "",
    version: config.runtimeExpected?.version ?? "",
    revision: config.runtimeExpected?.revision ?? "",
    sourceUrl: config.runtimeExpected?.sourceUrl ?? "",
  });
  return {
    commit,
    id: deployment.id,
    releaseName: `docker-${commit}-${deployment.id}`,
    deployment,
  };
}

/** The path and receipt must describe the same immutable deployment; OCI revisions remain real Git commits. */
export function activeDeployment(value: {
  release: string;
  commit: string;
  deployment?: SourceRuntimeDeployment | null;
}) {
  let selected: DeploymentSelection;
  if (value.deployment !== undefined && value.deployment !== null) {
    const expected = sourceRuntimeIdentity(value.commit, value.deployment.runtime);
    if (!Bun.deepEquals(expected, value.deployment)) throw Error("Active deployment identity differs");
    selected = {
      commit: value.commit,
      id: expected.id,
      releaseName: `docker-${value.commit}-${expected.id}`,
      deployment: expected,
    };
  } else selected = deploymentSelection(value.commit, {});
  if (![selected.releaseName, ...(selected.deployment ? [] : [value.commit])].includes(basename(value.release)))
    throw Error("Active release name differs from its sealed identity");
  return { ...selected, release: value.release };
}

export function deploymentIsCurrent(active: { commit: string; id: string }, expected: DeploymentSelection) {
  return active.commit === expected.commit && active.id === expected.id;
}
