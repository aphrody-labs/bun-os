// SPDX-License-Identifier: Apache-2.0
import { MessageFlags, type CommandInteraction } from "discord.js";
import type { GuardFunction } from "discordx";

/**
 * Creates a DiscordX Guard that restricts commands exclusively to an authorized guild ID.
 * Helpful for private monorepo bots where execution outside production guild
 * must be rejected immediately.
 */
export function createMonoGuildGuard(targetGuildId: string): GuardFunction<unknown> {
  return async (arg, _client, next) => {
    const payload = Array.isArray(arg) ? arg[0] : arg;
    if (!payload || typeof payload !== "object") {
      await next();
      return;
    }

    const guildId =
      ("guildId" in payload && typeof payload.guildId === "string" ? payload.guildId : undefined) ??
      ("guild" in payload && (payload as { guild?: { id?: string } }).guild?.id);

    if (guildId && guildId !== targetGuildId) {
      if ("reply" in payload && typeof (payload as CommandInteraction).reply === "function") {
        try {
          await (payload as CommandInteraction).reply({
            content: "❌ Cette commande n'est autorisée que sur le serveur officiel.",
            flags: MessageFlags.Ephemeral,
          });
        } catch {
          // Silent if cannot reply
        }
      }
      return;
    }

    await next();
  };
}
