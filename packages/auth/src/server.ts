// SPDX-License-Identifier: Apache-2.0
/**
 * Better Auth HTTP server route handlers on Bun native APIs.
 * Supports session cookies, passkeys (WebAuthn), multi-account switching, and owner verification.
 */

import { AuthDatabase } from "./database.ts";
import { MultiAccountManager } from "./multi-account.ts";
import {
  createPasskeyAuthOptions,
  createPasskeyRegistrationOptions,
  verifyPasskeyAuthResponse,
  verifyPasskeyRegistrationResponse,
  type ClientAuthResponse,
  type ClientRegistrationResponse,
} from "./passkey.ts";
import {
  createClearSessionCookie,
  createSessionCookie,
  extractSessionToken,
  SESSION_AUDIENCE,
  SESSION_ISSUER,
  signSessionToken,
  verifyOwnerIdentity,
} from "./session.ts";
import type { Session, User } from "./types.ts";

export interface BetterAuthServerOptions {
  db?: AuthDatabase;
  secret?: string;
  prefix?: string;
}

export function createBetterAuthServer(options: BetterAuthServerOptions = {}) {
  const db = options.db || new AuthDatabase();
  const secret = options.secret || process.env.APHRODY_WEBOS_SESSION_KEY || "bunos-sovereign-secret-key-32chars!";
  const prefix = options.prefix || "/api/auth";
  const accountManager = new MultiAccountManager(db);

  // In-memory challenge store for active passkey ceremonies
  const activeChallenges = new Map<string, { challenge: string; userId: string; expires: number }>();

  // Ensure default session exists for owner or active account
  const ensureDefaultSession = (req: Request): Session => {
    let token = extractSessionToken(req.headers);
    let session = token ? db.getSessionByToken(token) : null;

    if (!session) {
      const owner = db.getUserByEmail("owner@aphrody.com") || db.listUsers()[0];
      const now = Date.now();
      token = "sess_" + crypto.randomUUID().replace(/-/g, "");
      session = {
        id: "s_" + crypto.randomUUID().slice(0, 8),
        userId: owner.id,
        token,
        expiresAt: now + 7 * 86400 * 1000,
        activeAccountId: owner.id,
        isOwnerVerified: owner.isOwner,
        createdAt: now,
        updatedAt: now,
      };
      db.createSession(session);
    }
    return session;
  };

  return {
    db,
    accountManager,
    secret,
    routes: {
      [`${prefix}/session`]: async (req: Request) => {
        const session = ensureDefaultSession(req);
        const presence = accountManager.getPresence(session);
        const cookie = createSessionCookie(session.token);

        return Response.json(presence, {
          headers: {
            "Set-Cookie": cookie,
            "Content-Type": "application/json",
          },
        });
      },

      [`${prefix}/accounts`]: async (req: Request) => {
        const session = ensureDefaultSession(req);
        const presence = accountManager.getPresence(session);
        return Response.json({
          activeAccount: presence.activeAccount,
          accounts: presence.accounts,
        });
      },

      [`${prefix}/accounts/switch`]: async (req: Request) => {
        const session = ensureDefaultSession(req);
        const body = (await req.json().catch(() => ({}))) as { accountId?: string };
        if (!body.accountId) {
          return Response.json({ error: "Missing accountId" }, { status: 400 });
        }

        try {
          const presence = accountManager.switchActiveAccount(session.token, body.accountId);
          return Response.json(presence);
        } catch (e) {
          return Response.json({ error: String(e) }, { status: 400 });
        }
      },

      [`${prefix}/passkey/register-options`]: async (req: Request) => {
        const session = ensureDefaultSession(req);
        const user = db.getUserById(session.activeAccountId) || db.getUserById(session.userId);
        if (!user) return Response.json({ error: "User not found" }, { status: 404 });

        const opts = createPasskeyRegistrationOptions(user);
        activeChallenges.set(user.id, {
          challenge: opts.challenge,
          userId: user.id,
          expires: Date.now() + 60000,
        });

        return Response.json(opts);
      },

      [`${prefix}/passkey/register-verify`]: async (req: Request) => {
        const session = ensureDefaultSession(req);
        const user = db.getUserById(session.activeAccountId) || db.getUserById(session.userId);
        if (!user) return Response.json({ error: "User not found" }, { status: 404 });

        const stored = activeChallenges.get(user.id);
        if (!stored || stored.expires < Date.now()) {
          return Response.json({ error: "Challenge expired or invalid" }, { status: 400 });
        }
        activeChallenges.delete(user.id);

        const body = (await req.json().catch(() => ({}))) as ClientRegistrationResponse;
        const verification = verifyPasskeyRegistrationResponse(body, stored.challenge);

        if (!verification.ok) {
          return Response.json({ error: verification.error || "Verification failed" }, { status: 400 });
        }

        const now = Date.now();
        db.createPasskey({
          id: "pk_" + crypto.randomUUID().slice(0, 8),
          userId: user.id,
          credentialId: verification.credentialId,
          publicKey: verification.publicKey,
          counter: 0,
          deviceType: "platform",
          backedUp: true,
          createdAt: now,
          lastUsedAt: now,
        });

        return Response.json({ ok: true, message: "Passkey registered securely" });
      },

      [`${prefix}/passkey/auth-options`]: async (req: Request) => {
        const session = ensureDefaultSession(req);
        const user = db.getUserById(session.activeAccountId) || db.getUserById(session.userId);
        const passkeys = user ? db.getPasskeysByUserId(user.id) : [];

        const opts = createPasskeyAuthOptions(
          "aphrody.com",
          passkeys.map(pk => ({ id: pk.credentialId })),
        );

        const challengeKey = user?.id || "global_auth";
        activeChallenges.set(challengeKey, {
          challenge: opts.challenge,
          userId: challengeKey,
          expires: Date.now() + 60000,
        });

        return Response.json(opts);
      },

      [`${prefix}/passkey/auth-verify`]: async (req: Request) => {
        const session = ensureDefaultSession(req);
        const user = db.getUserById(session.activeAccountId) || db.getUserById(session.userId);
        const challengeKey = user?.id || "global_auth";

        const stored = activeChallenges.get(challengeKey);
        if (!stored || stored.expires < Date.now()) {
          return Response.json({ error: "Challenge expired or invalid" }, { status: 400 });
        }
        activeChallenges.delete(challengeKey);

        const body = (await req.json().catch(() => ({}))) as ClientAuthResponse;
        const passkey = db.getPasskeyByCredentialId(body.id);
        if (!passkey) {
          return Response.json({ error: "Unregistered passkey credential" }, { status: 400 });
        }

        const verification = verifyPasskeyAuthResponse(body, stored.challenge, passkey.publicKey);
        if (!verification.ok) {
          return Response.json({ error: verification.error || "Authentication failed" }, { status: 400 });
        }

        // Issue verified owner JWT token if user is owner
        let signedJwt: string | undefined;
        if (user?.isOwner) {
          signedJwt = await signSessionToken(
            {
              sub: user.email,
              iss: SESSION_ISSUER,
              aud: SESSION_AUDIENCE,
              role: user.role,
              is_owner: true,
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 7 * 86400,
            },
            secret,
          );
        }

        return Response.json({
          ok: true,
          verified: true,
          ownerVerified: Boolean(user?.isOwner),
          jwtToken: signedJwt,
        });
      },

      [`${prefix}/owner-status`]: async (req: Request) => {
        const verification = await verifyOwnerIdentity(req.headers, secret);
        return Response.json({
          isOwner: verification.isOwner,
          claims: verification.claims || null,
        });
      },

      [`${prefix}/logout`]: async (req: Request) => {
        const token = extractSessionToken(req.headers);
        if (token) {
          db.deleteSession(token);
        }
        return Response.json(
          { ok: true },
          {
            headers: {
              "Set-Cookie": createClearSessionCookie(),
              "Content-Type": "application/json",
            },
          },
        );
      },
    },
  };
}
