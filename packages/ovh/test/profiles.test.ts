// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectAuthMode } from "../src/client.js";
import { KNOWN_PROFILES, describeCredentials, loadCredentials, parseCredentialsText } from "../src/profiles.js";

describe("OVH Profiles and Credential Parsing", () => {
  it("parses bash export secrets format (.bash_secrets)", () => {
    const text = `
# Production secrets
export OVH_APPLICATION_KEY="ak_12345"
export OVH_APPLICATION_SECRET="as_secret_67890"
export OVH_CONSUMER_KEY="ck_consumer_abcde"
export OVH_ENDPOINT="ovh-eu"
`;
    const parsed = parseCredentialsText(text, ".bash_secrets");
    expect(parsed).not.toBeNull();
    expect(parsed?.applicationKey).toBe("ak_12345");
    expect(parsed?.applicationSecret).toBe("as_secret_67890");
    expect(parsed?.consumerKey).toBe("ck_consumer_abcde");
    expect(parsed?.endpoint).toBe("ovh-eu");
  });

  it("parses INI format (~/.ovh.conf)", () => {
    const text = `
[default]
; default section
[ovh-eu]
application_key = ini_ak_999
application_secret = ini_as_888
consumer_key = ini_ck_777
`;
    const parsed = parseCredentialsText(text, ".ovh.conf");
    expect(parsed).not.toBeNull();
    expect(parsed?.applicationKey).toBe("ini_ak_999");
    expect(parsed?.applicationSecret).toBe("ini_as_888");
    expect(parsed?.consumerKey).toBe("ini_ck_777");
  });

  it("parses Certbot dns_ovh_* prefix format", () => {
    const text = `
dns_ovh_application_key = cb_ak
dns_ovh_application_secret = cb_as
dns_ovh_consumer_key = cb_ck
`;
    const parsed = parseCredentialsText(text, "ovh-certbot.ini");
    expect(parsed).not.toBeNull();
    expect(parsed?.applicationKey).toBe("cb_ak");
    expect(parsed?.applicationSecret).toBe("cb_as");
    expect(parsed?.consumerKey).toBe("cb_ck");
  });

  it("includes the segregated infrastructure profile", () => {
    expect(KNOWN_PROFILES["aphrody.com"]).toBeDefined();

    expect(KNOWN_PROFILES["aphrody.com"].domains).toContain("aphrody.com");
  });
});

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ovh-profiles-"));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

describe("OVH authentication priority", () => {
  const OAUTH_ENV = {
    OVH_CLIENT_ID: "env-id",
    OVH_CLIENT_SECRET: "env-secret",
  };

  it("parses client_id / client_secret from bash exports and INI sections", () => {
    const bash = parseCredentialsText("export OVH_CLIENT_ID=id_b\nexport OVH_CLIENT_SECRET='secret_b'\n", "ovh.env");
    expect(bash?.clientId).toBe("id_b");
    expect(bash?.clientSecret).toBe("secret_b");
    expect(selectAuthMode(bash!)).toBe("oauth2");

    const ini = parseCredentialsText(
      "[ovh-eu]\napplication_key = ak\napplication_secret = as\nconsumer_key = ck\nclient_id = id_i\nclient_secret = secret_i\n",
      "aphrody.conf",
    );
    expect(ini?.clientId).toBe("id_i");
    expect(ini?.applicationKey).toBe("ak");
    expect(parseCredentialsText("export OVH_CLIENT_ID=lonely\n", "x")).toBeNull();
  });

  it("uses the environment service account first, for the aphrody account only", () => {
    const home = fixtureDir({});
    const creds = loadCredentials(undefined, { ...OAUTH_ENV }, home);
    expect(creds.authMode).toBe("oauth2");
    expect(creds.source).toBe("environment_variables");
    expect(creds.clientId).toBe("env-id");
    expect(creds.applicationKey).toBeUndefined();

    const tripletFile = join(
      fixtureDir({
        "rg.conf": "application_key=a\napplication_secret=b\nconsumer_key=c\n",
      }),
      "rg.conf",
    );
    expect(loadCredentials(tripletFile, { ...OAUTH_ENV }, home).authMode).toBe("application_key");
  });

  it("prefers a profile OAuth2 pair over its triplet and reads the service account file", () => {
    const both = join(
      fixtureDir({
        "p.conf":
          "[ovh-eu]\napplication_key=a\napplication_secret=b\nconsumer_key=c\nclient_id=pid\nclient_secret=psecret\n",
      }),
      "p.conf",
    );
    const resolved = loadCredentials(both, {}, fixtureDir({}));
    expect(resolved.authMode).toBe("oauth2");
    expect(resolved.clientId).toBe("pid");
    expect(resolved.source).toBe(both);

    const home = fixtureDir({
      ".config/aphrody/ovh.env": "export OVH_CLIENT_ID=fid\nexport OVH_CLIENT_SECRET=fsecret\n",
    });
    const fromFile = loadCredentials(undefined, {}, home);
    expect(fromFile.clientId).toBe("fid");
    expect(fromFile.source).toBe(join(home, ".config", "aphrody", "ovh.env"));
  });

  it("keeps the application key triplet when no service account exists", () => {
    const file = join(
      fixtureDir({
        "t.conf": "export OVH_APPLICATION_KEY=a\nexport OVH_APPLICATION_SECRET=b\nexport OVH_CONSUMER_KEY=c\n",
      }),
      "t.conf",
    );
    const resolved = loadCredentials(file, {}, fixtureDir({}));
    expect(resolved.authMode).toBe("application_key");
    expect(resolved.consumerKey).toBe("c");
    expect(resolved.clientId).toBeUndefined();
  });

  it("never prints secrets in its description or its failure", () => {
    const creds = loadCredentials(undefined, { ...OAUTH_ENV }, fixtureDir({}));
    expect(describeCredentials(creds)).toBe("oauth2 (ovh-eu) from environment_variables");
    expect(describeCredentials(creds)).not.toContain("env-secret");
    const missing = join(fixtureDir({}), "missing.conf");
    expect(() => loadCredentials(missing, { OVH_CLIENT_ID: "lonely-id" }, fixtureDir({}))).toThrow(
      /No valid OVH credentials/,
    );
    try {
      loadCredentials(missing, { OVH_CLIENT_ID: "lonely-id" }, fixtureDir({}));
    } catch (error) {
      expect(String(error)).not.toContain("lonely-id");
    }
  });
});
