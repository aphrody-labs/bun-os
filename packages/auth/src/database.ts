// SPDX-License-Identifier: Apache-2.0
/**
 * SQLite Database store for Better Auth tables using native bun:sqlite with WAL mode.
 */

import { Database } from "bun:sqlite";
import type { Account, PasskeyCredential, Session, User } from "./types.ts";

export class AuthDatabase {
  public db: Database;

  constructor(dbPath: string | Database = "better_auth.db") {
    this.db = typeof dbPath === "string" ? new Database(dbPath) : dbPath;
    this.init();
  }

  private init() {
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA synchronous = NORMAL;");
    this.db.run("PRAGMA foreign_keys = ON;");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS better_auth_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL COLLATE NOCASE,
        name TEXT NOT NULL,
        avatar TEXT,
        role TEXT NOT NULL DEFAULT 'developer',
        is_owner INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS better_auth_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES better_auth_users(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        expires_at INTEGER,
        password_hash TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS better_auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES better_auth_users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        active_account_id TEXT NOT NULL,
        is_owner_verified INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS better_auth_passkeys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES better_auth_users(id) ON DELETE CASCADE,
        credential_id TEXT UNIQUE NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        device_type TEXT,
        backed_up INTEGER DEFAULT 0,
        transports TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS better_auth_verifications (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON better_auth_users(email);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON better_auth_sessions(token);
      CREATE INDEX IF NOT EXISTS idx_passkeys_user ON better_auth_passkeys(user_id);
    `);

    this.seedDefaults();
  }

  private seedDefaults() {
    const count = (this.db.query("SELECT COUNT(*) as c FROM better_auth_users").get() as { c: number }).c;
    if (count === 0) {
      const now = Date.now();
      const insertUser = this.db.prepare(`
        INSERT INTO better_auth_users (id, email, name, avatar, role, is_owner, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      `);

      // 1. Sovereign Owner
      insertUser.run(
        "user_owner",
        "owner@aphrody.com",
        "Byron Love (Sovereign Owner)",
        "https://cdn.aphrody.com/avatar/byron-love.webp",
        "owner",
        1,
        now,
        now,
      );

      // 2. Developer
      insertUser.run(
        "user_dev",
        "dev@bun-os.local",
        "Bun OS Core Developer",
        undefined,
        "developer",
        0,
        now,
        now,
      );

      // 3. Guest
      insertUser.run(
        "user_guest",
        "guest@bun-os.local",
        "Guest Explorer",
        undefined,
        "guest",
        0,
        now,
        now,
      );

      // Seed a sovereign passkey for owner
      this.db.prepare(`
        INSERT INTO better_auth_passkeys (id, user_id, credential_id, public_key, counter, device_type, created_at)
        VALUES ('pk_owner_default', 'user_owner', 'cred_aphrody_sovereign_fido2', 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...', 1, 'platform', ?1)
      `).run(now);
    }
  }

  // User CRUD
  public getUserById(id: string): User | null {
    const row = this.db.query("SELECT * FROM better_auth_users WHERE id = ?1").get(id) as Record<string, unknown> | null;
    return row ? this.mapUser(row) : null;
  }

  public getUserByEmail(email: string): User | null {
    const row = this.db.query("SELECT * FROM better_auth_users WHERE email = ?1 COLLATE NOCASE").get(email) as Record<string, unknown> | null;
    return row ? this.mapUser(row) : null;
  }

  public listUsers(): User[] {
    const rows = this.db.query("SELECT * FROM better_auth_users ORDER BY is_owner DESC, created_at ASC").all() as Record<string, unknown>[];
    return rows.map(r => this.mapUser(r));
  }

  // Session CRUD
  public createSession(session: Session): void {
    this.db.prepare(`
      INSERT INTO better_auth_sessions (id, user_id, token, expires_at, ip_address, user_agent, active_account_id, is_owner_verified, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `).run(
      session.id,
      session.userId,
      session.token,
      session.expiresAt,
      session.ipAddress || null,
      session.userAgent || null,
      session.activeAccountId,
      session.isOwnerVerified ? 1 : 0,
      session.createdAt,
      session.updatedAt,
    );
  }

  public getSessionByToken(token: string): Session | null {
    const row = this.db.query("SELECT * FROM better_auth_sessions WHERE token = ?1 AND expires_at > ?2").get(token, Date.now()) as Record<string, unknown> | null;
    return row ? this.mapSession(row) : null;
  }

  public updateSessionActiveAccount(token: string, accountId: string): void {
    this.db.prepare("UPDATE better_auth_sessions SET active_account_id = ?1, updated_at = ?2 WHERE token = ?3").run(accountId, Date.now(), token);
  }

  public deleteSession(token: string): void {
    this.db.prepare("DELETE FROM better_auth_sessions WHERE token = ?1").run(token);
  }

  // Passkey CRUD
  public getPasskeysByUserId(userId: string): PasskeyCredential[] {
    const rows = this.db.query("SELECT * FROM better_auth_passkeys WHERE user_id = ?1").all(userId) as Record<string, unknown>[];
    return rows.map(r => this.mapPasskey(r));
  }

  public getPasskeyByCredentialId(credentialId: string): PasskeyCredential | null {
    const row = this.db.query("SELECT * FROM better_auth_passkeys WHERE credential_id = ?1").get(credentialId) as Record<string, unknown> | null;
    return row ? this.mapPasskey(row) : null;
  }

  public createPasskey(passkey: PasskeyCredential): void {
    this.db.prepare(`
      INSERT INTO better_auth_passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, created_at, last_used_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `).run(
      passkey.id,
      passkey.userId,
      passkey.credentialId,
      passkey.publicKey,
      passkey.counter,
      passkey.deviceType || "platform",
      passkey.backedUp ? 1 : 0,
      passkey.transports ? JSON.stringify(passkey.transports) : null,
      passkey.createdAt,
      passkey.lastUsedAt || null,
    );
  }

  private mapUser(row: Record<string, unknown>): User {
    return {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      avatar: row.avatar ? String(row.avatar) : undefined,
      role: row.role as User["role"],
      isOwner: Boolean(row.is_owner),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapSession(row: Record<string, unknown>): Session {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      token: String(row.token),
      expiresAt: Number(row.expires_at),
      ipAddress: row.ip_address ? String(row.ip_address) : undefined,
      userAgent: row.user_agent ? String(row.user_agent) : undefined,
      activeAccountId: String(row.active_account_id),
      isOwnerVerified: Boolean(row.is_owner_verified),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapPasskey(row: Record<string, unknown>): PasskeyCredential {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      credentialId: String(row.credential_id),
      publicKey: String(row.public_key),
      counter: Number(row.counter),
      deviceType: row.device_type ? String(row.device_type) : undefined,
      backedUp: Boolean(row.backed_up),
      transports: row.transports ? (JSON.parse(String(row.transports)) as string[]) : undefined,
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at ? Number(row.last_used_at) : undefined,
    };
  }
}
