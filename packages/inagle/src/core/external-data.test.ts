import { afterEach, expect, test } from "bun:test";
import { cfgbinPostgresEnabled, cfgbinPostgresLoadByPath } from "./cfgbin-db.js";

const keys = [
  "INAGLE_DATA_SOURCE",
  "IEVR_CFGBIN_POSTGRES",
  "DATABASE_URL",
  "ACHILLEA_DATABASE_URL",
  "NEXT_PUBLIC_ASSET_URL",
  "NIE_DATA_SOURCE",
] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

test("unrelated database configuration does not activate external game data", async () => {
  delete process.env.INAGLE_DATA_SOURCE;
  delete process.env.NIE_DATA_SOURCE;
  delete process.env.IEVR_CFGBIN_POSTGRES;
  for (const key of keys.slice(2, 6)) process.env[key] = "postgres://unused.invalid/test";
  expect(cfgbinPostgresEnabled()).toBe(false);
  await expect(cfgbinPostgresLoadByPath("data/common/gamedata/test.cfg.bin")).rejects.toThrow(
    "cfgbin-postgres: disabled",
  );
});

test("explicit PostgreSQL selection works and explicit opt-out wins", () => {
  delete process.env.NIE_DATA_SOURCE;
  process.env.INAGLE_DATA_SOURCE = "postgres";
  delete process.env.IEVR_CFGBIN_POSTGRES;
  expect(cfgbinPostgresEnabled()).toBe(true);
  process.env.IEVR_CFGBIN_POSTGRES = "0";
  expect(cfgbinPostgresEnabled()).toBe(false);
  process.env.INAGLE_DATA_SOURCE = "vfs";
  process.env.IEVR_CFGBIN_POSTGRES = "1";
  expect(cfgbinPostgresEnabled()).toBe(false);
  process.env.INAGLE_DATA_SOURCE = "auto";
  expect(cfgbinPostgresEnabled()).toBe(true);
});

test("asset paths default to the local origin without a remote mirror", async () => {
  delete process.env.NEXT_PUBLIC_ASSET_URL;
  const local = await import(`./paths.ts?local=${crypto.randomUUID()}`);
  expect(local.CDN_URL).toBe("");
  process.env.NEXT_PUBLIC_ASSET_URL = "https://assets.example.invalid///";
  const configured = await import(`./paths.ts?configured=${crypto.randomUUID()}`);
  expect(configured.CDN_URL).toBe("https://assets.example.invalid");
});
