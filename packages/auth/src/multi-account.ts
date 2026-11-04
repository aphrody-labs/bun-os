// SPDX-License-Identifier: Apache-2.0
/**
 * Multi-account presence manager for Bun OS Better Auth.
 * Handles active account state, account switching, and multi-user presence.
 */

import type { AuthDatabase } from "./database.ts";
import type { MultiAccountPresence, Session, User } from "./types.ts";

export class MultiAccountManager {
  constructor(private db: AuthDatabase) {}

  public getPresence(session: Session): MultiAccountPresence {
    const activeAccount = this.db.getUserById(session.activeAccountId) || this.db.getUserById(session.userId);
    if (!activeAccount) {
      throw new Error(`Account not found for session ${session.id}`);
    }

    const accounts = this.db.listUsers();
    const passkeys = this.db.getPasskeysByUserId(activeAccount.id);

    return {
      activeAccount,
      accounts,
      session,
      isOwner: activeAccount.isOwner,
      hasPasskey: passkeys.length > 0,
    };
  }

  public switchActiveAccount(sessionToken: string, targetUserId: string): MultiAccountPresence {
    const session = this.db.getSessionByToken(sessionToken);
    if (!session) {
      throw new Error("Invalid or expired session");
    }

    const targetUser = this.db.getUserById(targetUserId);
    if (!targetUser) {
      throw new Error(`Target user ${targetUserId} not found`);
    }

    this.db.updateSessionActiveAccount(sessionToken, targetUserId);
    session.activeAccountId = targetUserId;

    return this.getPresence(session);
  }
}
