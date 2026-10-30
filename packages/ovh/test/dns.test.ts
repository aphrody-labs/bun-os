// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { OvhClient } from "../src/client.js";
import { OvhDns, type DnsRecord } from "../src/dns.js";

// Mock client that intercepts requests
class MockOvhClient extends OvhClient {
  public recordsStore: DnsRecord[] = [
    {
      id: 5432864457,
      zone: "aphrody.com",
      subDomain: "",
      fieldType: "A",
      target: "51.77.147.152",
      ttl: 300,
    },
    {
      id: 5432881314,
      zone: "aphrody.com",
      subDomain: "n2b",
      fieldType: "A",
      target: "51.77.147.152",
      ttl: 300,
    },
    {
      id: 5432875215,
      zone: "aphrody.com",
      subDomain: "www",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
    {
      id: 5432878735,
      zone: "aphrody.com",
      subDomain: "nie",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
    {
      id: 5432875901,
      zone: "aphrody.com",
      subDomain: "api",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
    {
      id: 5432877451,
      zone: "aphrody.com",
      subDomain: "cdn",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
    {
      id: 5432877450,
      zone: "aphrody.com",
      subDomain: "mcp",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
    {
      id: 5432878734,
      zone: "aphrody.com",
      subDomain: "bxc",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
    {
      id: 5432875903,
      zone: "aphrody.com",
      subDomain: "downloads",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
    {
      id: 5432877452,
      zone: "aphrody.com",
      subDomain: "bot",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
    {
      id: 5432877453,
      zone: "aphrody.com",
      subDomain: "admin",
      fieldType: "CNAME",
      target: "aphrody.com.",
      ttl: 300,
    },
  ];

  constructor() {
    super({
      applicationKey: "mock_ak",
      applicationSecret: "mock_as",
      consumerKey: "mock_ck",
    });
  }

  public override async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    _body?: unknown,
  ): Promise<T> {
    if (method === "GET" && path === "/domain/zone") {
      return ["aphrody.com", "example.org"] as T;
    }
    if (method === "GET" && path === "/domain/zone/aphrody.com") {
      return {
        name: "aphrody.com",
        hasDnsAnycast: true,
        dnssecSupported: true,
        isSigned: true,
        nameServers: ["dns200.anycast.me", "ns200.anycast.me"],
        lastUpdate: "2026-09-07T12:00:00Z",
      } as T;
    }
    if (method === "GET" && path.startsWith("/domain/zone/aphrody.com/record")) {
      if (path.match(/\/record\/\d+$/)) {
        const id = Number(path.split("/").pop());
        const found = this.recordsStore.find(r => r.id === id);
        if (!found) throw new Error("Record not found");
        return found as T;
      }
      return this.recordsStore.map(r => r.id) as T;
    }
    if (method === "POST" && path === "/domain/zone/aphrody.com/refresh") {
      return null as T;
    }
    return {} as T;
  }
}

describe("OvhDns Engine", () => {
  it("lists managed zones", async () => {
    const mock = new MockOvhClient();
    const dns = new OvhDns(mock);
    const zones = await dns.listZones();
    expect(zones).toEqual(["aphrody.com", "example.org"]);
  });

  it("lists and sorts all records in a zone", async () => {
    const mock = new MockOvhClient();
    const dns = new OvhDns(mock);
    const records = await dns.listRecords("aphrody.com");
    expect(records.length).toBe(11);
    expect(records[0].fieldType).toBe("A");
  });

  it("audits aphrody.com 11 serving subdomains invariant", async () => {
    const mock = new MockOvhClient();
    const dns = new OvhDns(mock);
    const audit = await dns.auditZone("aphrody.com");
    expect(audit.dnssecActivated).toBe(true);
    expect(audit.hasDnsAnycast).toBe(true);
    expect(audit.totalRecords).toBe(11);
    expect(audit.aphrodyInvariants?.verified).toBe(true);
    expect(audit.aphrodyInvariants?.missingSubdomains).toHaveLength(0);
  });
});
