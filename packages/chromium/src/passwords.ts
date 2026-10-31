// SPDX-License-Identifier: Apache-2.0
export interface ChromiumPasswordProvider {
  audit(): {
    records: number;
    supportedWebOrigins: number;
    credentialsWithPassword: number;
    unsupportedRecords: number;
  };
  withCredential(
    selector: { url: string; username?: string },
    consumer: (
      credential: Readonly<{ name: string; url: string; username: string; password: string }>,
    ) => void | Promise<void>,
  ): Promise<void>;
}

/** Reuse the explicitly allowlisted owner provider; this does not import credentials into a browser. */
export function createChromiumPasswordConnection(provider: ChromiumPasswordProvider) {
  if (!provider || typeof provider.audit !== "function" || typeof provider.withCredential !== "function")
    throw new TypeError("An explicit shared Chrome password provider is required");
  return Object.freeze({
    importPlan() {
      const audit = provider.audit();
      return Object.freeze({
        schemaVersion: 1 as const,
        source: "shared-chrome-password-provider" as const,
        destination: "chromium-device-password-store" as const,
        nativeManagerURL: "chrome://password-manager/settings" as const,
        requiresNativeFileSelection: true,
        imported: false,
        browserValidated: false,
        records: audit.records,
        supportedWebOrigins: audit.supportedWebOrigins,
        credentialsWithPassword: audit.credentialsWithPassword,
        unsupportedRecords: audit.unsupportedRecords,
      });
    },
    withCredential: provider.withCredential.bind(provider),
  });
}
