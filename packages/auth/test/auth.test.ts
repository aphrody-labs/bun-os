// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  AuthDatabase,
  MultiAccountManager,
  SovereignQueryClient,
  authQueryKeys,
  createBetterAuthServer,
  createPasskeyAuthOptions,
  createPasskeyRegistrationOptions,
  createSessionCookie,
  getTranslation,
  signSessionToken,
  t,
  verifyOwnerIdentity,
  verifyPasskeyAuthResponse,
  verifyPasskeyRegistrationResponse,
  verifySessionToken,
} from "../src/index.ts";

describe("@aphrody/auth - Sovereign Better Auth Suite", () => {
  const secret = "test-secret-key-that-is-at-least-32-chars-long!";

  test("database seeds sovereign owner, developer, and guest accounts", () => {
    const db = new AuthDatabase(":memory:");
    const users = db.listUsers();
    expect(users.length).toBe(3);

    const owner = users.find(u => u.isOwner);
    expect(owner).toBeDefined();
    expect(owner?.email).toBe("owner@aphrody.com");
    expect(owner?.role).toBe("owner");

    const dev = users.find(u => u.role === "developer");
    expect(dev?.email).toBe("dev@bun-os.local");

    const guest = users.find(u => u.role === "guest");
    expect(guest?.email).toBe("guest@bun-os.local");
  });

  test("multi-account manager handles active account presence and switching", () => {
    const db = new AuthDatabase(":memory:");
    const manager = new MultiAccountManager(db);
    const owner = db.getUserByEmail("owner@aphrody.com")!;
    const dev = db.getUserByEmail("dev@bun-os.local")!;

    const session = {
      id: "sess_1",
      userId: owner.id,
      token: "tok_123",
      expiresAt: Date.now() + 3600_000,
      activeAccountId: owner.id,
      isOwnerVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.createSession(session);

    // Initial presence
    const presence1 = manager.getPresence(session);
    expect(presence1.activeAccount.id).toBe(owner.id);
    expect(presence1.isOwner).toBe(true);
    expect(presence1.accounts.length).toBe(3);

    // Switch to developer account
    const presence2 = manager.switchActiveAccount("tok_123", dev.id);
    expect(presence2.activeAccount.id).toBe(dev.id);
    expect(presence2.isOwner).toBe(false);
  });

  test("session token signing and owner identity verification", async () => {
    const claims = {
      sub: "owner@aphrody.com",
      iss: "aphrody.com" as const,
      aud: "bunos-webos" as const,
      role: "owner" as const,
      is_owner: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const token = await signSessionToken(claims, secret);
    expect(token.split(".").length).toBe(3);

    const verified = await verifySessionToken(token, secret);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe("owner@aphrody.com");
    expect(verified?.is_owner).toBe(true);

    // Test owner verification over HTTP headers
    const headers = new Headers();
    headers.set("cookie", `aphrody_session=${encodeURIComponent(token)}`);
    headers.set("origin", "https://aphrody.com");

    const ownerCheck = await verifyOwnerIdentity(headers, secret);
    expect(ownerCheck.isOwner).toBe(true);
    expect(ownerCheck.claims?.role).toBe("owner");
  });

  test("passkey registration and authentication options generation", () => {
    const db = new AuthDatabase(":memory:");
    const owner = db.getUserByEmail("owner@aphrody.com")!;

    const regOpts = createPasskeyRegistrationOptions(owner);
    expect(regOpts.challenge.length).toBeGreaterThan(20);
    expect(regOpts.rp.name).toContain("Bun OS");
    expect(regOpts.user.name).toBe("owner@aphrody.com");

    const authOpts = createPasskeyAuthOptions("aphrody.com", [{ id: "cred_123" }]);
    expect(authOpts.challenge.length).toBeGreaterThan(20);
    expect(authOpts.allowCredentials?.[0]?.id).toBe("cred_123");
  });

  test("bilingual internationalization (en/fr) provides correct labels", () => {
    expect(t("roleOwner", "en")).toBe("Sovereign Owner");
    expect(t("roleOwner", "fr")).toBe("Propriétaire Souverain");

    expect(t("passkey", "en")).toBe("Passkey");
    expect(t("passkey", "fr")).toBe("Clé d'accès (Passkey)");

    expect(t("filterAll", "en")).toBe("All");
    expect(t("filterAll", "fr")).toBe("Tous");

    expect(t("searchPlaceholder", "fr")).toContain("Rechercher fichiers locaux");
  });

  test("TanStack query client provides caching, subscriptions, and stale-while-revalidate", async () => {
    const queryClient = new SovereignQueryClient({ defaultStaleTime: 1000 });
    let notifications = 0;

    const unsubscribe = queryClient.subscribe(authQueryKeys.session(), data => {
      notifications++;
    });

    queryClient.setQueryData(authQueryKeys.session(), { user: "owner" });
    expect(queryClient.getQueryData(authQueryKeys.session())).toEqual({ user: "owner" });
    expect(notifications).toBe(1);

    // Fetch with cache
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount++;
      return { user: "fresh_user" };
    };

    const res1 = await queryClient.fetchQuery(authQueryKeys.session(), fetcher);
    // Should return cached since staleTime has not elapsed
    expect(res1).toEqual({ user: "owner" });
    expect(fetchCount).toBe(0);

    unsubscribe();
  });

  test("better auth HTTP server handles endpoints", async () => {
    const db = new AuthDatabase(":memory:");
    const authServer = createBetterAuthServer({ db, secret });

    // 1. Session endpoint
    const sessionReq = new Request("http://localhost/api/auth/session");
    const sessionRes = await authServer.routes["/api/auth/session"](sessionReq);
    expect(sessionRes.status).toBe(200);
    const sessionData = await sessionRes.json();
    expect(sessionData.activeAccount.email).toBe("owner@aphrody.com");
    expect(sessionRes.headers.get("Set-Cookie")).toContain("aphrody_session=");

    // 2. Accounts endpoint
    const accountsReq = new Request("http://localhost/api/auth/accounts");
    const accountsRes = await authServer.routes["/api/auth/accounts"](accountsReq);
    expect(accountsRes.status).toBe(200);
    const accountsData = await accountsRes.json();
    expect(accountsData.accounts.length).toBe(3);

    // 3. Switch account endpoint
    const dev = db.getUserByEmail("dev@bun-os.local")!;
    const switchReq = new Request("http://localhost/api/auth/accounts/switch", {
      method: "POST",
      body: JSON.stringify({ accountId: dev.id }),
    });
    const switchRes = await authServer.routes["/api/auth/accounts/switch"](switchReq);
    expect(switchRes.status).toBe(200);
    const switchData = await switchRes.json();
    expect(switchData.activeAccount.id).toBe(dev.id);
  });
});
