// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BEGIN,
  END,
  type GatewayConfig,
  candidateText,
  gatewayModel,
  hostPath,
  httpClosing,
  liveSite,
  render,
  stripOwnedBlock,
  validateConfig,
} from "./site-gateway.ts";
import { processStartedAt } from "./win32-net.ts";

const windows = process.platform === "win32";

const config: GatewayConfig = {
  home: "C:/Users/owner/.aphrody",
  sourceConfig: "C:/aphrody/deploy/docker/compose-gateway.nginx.conf",
  registry: "C:/ProgramData/Aphrody/site/run/native-services/site.json",
  container: "aphrody-gateway",
  serverNames: ["localhost", "aphrody.local"],
};

const gateway = `worker_processes auto;
events { worker_connections 1024; }
http {
    # a } in a comment and "a { in quotes" are not structure
    map $http_upgrade $connection_upgrade { default upgrade; '' close; }
    server { listen 80; server_name gateway.local; location / { return 204; } }
}
`;

describe("configuration", () => {
  test("accepts the documented host configuration", () => {
    expect(validateConfig(config)).toEqual(config);
  });

  test("rejects relative paths, unsafe names and incomplete TLS", () => {
    expect(() => validateConfig({ ...config, registry: "site.json" })).toThrow("registry");
    expect(() => validateConfig({ ...config, container: "-x" })).toThrow("conteneur");
    expect(() => validateConfig({ ...config, serverNames: [] })).toThrow("noms");
    expect(() => validateConfig({ ...config, serverNames: ["a b"] })).toThrow("invalide");
    const tls = {
      enabled: true,
      directory: "C:/tls",
      containerDirectory: "/etc/aphrody-local-tls",
      certificateSha256: "a".repeat(64),
      privateKeySha256: "b".repeat(64),
    };
    expect(validateConfig({ ...config, tls }).tls).toEqual(tls);
    expect(() =>
      validateConfig({
        ...config,
        tls: { ...tls, containerDirectory: "../x" },
      }),
    ).toThrow("TLS");
    expect(() => validateConfig({ ...config, tls: { ...tls, privateKeySha256: "" } })).toThrow("SHA-256");
  });
});

describe("gateway text", () => {
  test("finds the brace closing the single http block", () => {
    const closing = httpClosing(gateway);
    expect(gateway[closing]).toBe("}");
    expect(gateway.slice(closing + 1).trim()).toBe("");
  });

  test("refuses trailing blocks, nested or missing http and unbalanced braces", () => {
    expect(() => httpClosing(`${gateway}stream { }\n`)).toThrow("terminée");
    expect(() => httpClosing("events { }\n")).toThrow("http");
    expect(() => httpClosing("x {\nhttp {\n}\n}\n")).toThrow("premier niveau");
    expect(() => httpClosing("http {\n}\n}\n")).toThrow("accolades");
  });

  test("inserting twice is idempotent and keeps the existing routes", () => {
    const rendered = "upstream aphrody_native_site {\n    server host.docker.internal:36515;\n}";
    const once = (source: string) => {
      const { base } = stripOwnedBlock(source);
      return candidateText(base, httpClosing(base), rendered);
    };
    const first = once(gateway);
    expect(first).toContain("server_name gateway.local;");
    expect(first).toContain(`${BEGIN}\n${rendered}\n${END}\n}`);
    expect(stripOwnedBlock(first).marked).toBe(1);
    expect(once(first)).toBe(first);
    expect(stripOwnedBlock(first).base).toBe(gateway);
  });

  test("ambiguous markers are refused", () => {
    expect(() => stripOwnedBlock(`${BEGIN}\nhttp {}\n`)).toThrow("marqueurs");
    expect(() => stripOwnedBlock(`${BEGIN}\n${END}\n${BEGIN}\n${END}\n`)).toThrow("marqueurs");
  });

  test("Docker Desktop bind sources map back to host paths", () => {
    expect(hostPath("/run/desktop/mnt/host/c/aphrody/deploy/x.conf")).toBe("c:/aphrody/deploy/x.conf");
    expect(hostPath("C:\\aphrody\\x.conf")).toBe("C:\\aphrody\\x.conf");
  });
});

describe("model", () => {
  test("plain HTTP proxies every declared name to the native site", () => {
    const model = gatewayModel(config, 36515);
    expect(model.upstreams[0]!.targets[0]!.target).toBe("host.docker.internal:36515");
    expect(model.servers).toHaveLength(1);
    expect(model.servers[0]!.server_names).toEqual(config.serverNames);
  });

  test("local TLS adds HTTP/2, and HTTP/3 when QUIC is declared", () => {
    const tls = {
      enabled: true,
      directory: "C:/tls",
      containerDirectory: "/etc/aphrody-local-tls",
      quic: true,
      certificateSha256: "a".repeat(64),
      privateKeySha256: "b".repeat(64),
    };
    const servers = gatewayModel({ ...config, tls }, 1).servers;
    expect(servers).toHaveLength(2);
    expect(servers[1]!.listen_ports).toContain("[::]:443 quic reuseport");
    expect(servers[1]!.custom_directives).toContain("http3 on");
    expect(servers[1]!.ssl_certificate_key).toBe("/etc/aphrody-local-tls/leaf-key.pem");
  });

  const aphrody = [process.env.APHRODY_BIN, join(process.env.LOCALAPPDATA ?? "", "Aphrody", "bin", "aphrody.exe")].find(
    path => path && existsSync(path),
  );
  test.skipIf(!aphrody)("renders through aphrody infra nginx render", () => {
    const text = render(gatewayModel(config, 36515), aphrody!);
    expect(text).toContain("upstream aphrody_native_site {");
    expect(text).toContain("server host.docker.internal:36515;");
    expect(text).toContain('proxy_set_header Connection "";');
    expect(text).toContain("server_name localhost aphrody.local;");
  });
});

describe.skipIf(!windows)("native site registry", () => {
  test("a live record is proven by start time and its single loopback listener", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null),
    });
    try {
      const record = {
        pid: process.pid,
        processStartedAt: processStartedAt(process.pid)!,
        address: "127.0.0.1",
        port: server.port!,
      };
      expect(liveSite(record)).toBe(true);
      expect(
        liveSite({
          ...record,
          processStartedAt: "2000-01-01T00:00:00.0000000Z",
        }),
      ).toBe(false);
      expect(liveSite({ ...record, port: record.port === 1 ? 2 : 1 })).toBe(false);
      expect(() => liveSite({ ...record, address: "0.0.0.0" })).toThrow("loopback");
    } finally {
      server.stop(true);
    }
  });
});
