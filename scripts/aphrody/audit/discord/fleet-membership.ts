// SPDX-License-Identifier: Apache-2.0
import { loadCredentials, makeApi } from "@aphrody/discord-kit/lab";
import { DiscordRESTError } from "@aphrody/discord-kit/rest";

interface DiscordUser {
  id: string;
  bot?: boolean;
}

interface DiscordApplication {
  id: string;
  bot_public: boolean;
  bot_require_code_grant: boolean;
  owner?: { id: string };
  team?: { owner_user_id: string } | null;
}

interface DiscordGuild {
  id: string;
  owner_id: string;
}

interface DiscordMember {
  user?: DiscordUser;
  roles: string[];
  pending?: boolean;
}

interface DiscordRole {
  id: string;
  permissions: string;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--help")) {
    console.log("fleet-membership --env-file PATH --guild-id ID [--token-key KEY] [--member ID ...]");
    return;
  }
  const value = (name: string) => args[args.indexOf(name) + 1];
  const envFile = args.includes("--env-file") ? value("--env-file") : undefined;
  const guildId = args.includes("--guild-id") ? value("--guild-id") : undefined;
  const tokenKey = args.includes("--token-key") ? value("--token-key") : undefined;
  const members = args.flatMap((arg, index) => (arg === "--member" ? [args[index + 1]] : []));
  if (
    !envFile ||
    !guildId ||
    !/^\d{17,20}$/.test(guildId) ||
    (args.includes("--token-key") && (!tokenKey || !/^[A-Z_]+$/.test(tokenKey))) ||
    members.some(id => !id || !/^\d{17,20}$/.test(id))
  ) {
    console.log(JSON.stringify({ available: false, error: "invalid arguments" }));
    process.exitCode = 1;
    return;
  }
  let stage = "credentials";
  try {
    const credentials = await loadCredentials(envFile);
    const token = tokenKey
      ? credentials[tokenKey]
      : (credentials.DISCORD_BOT_TOKEN ?? credentials.DISCORD_TOKEN ?? credentials.TOKEN);
    if (!token) throw new Error("missing credential");
    const api = makeApi(token);
    stage = "bot";
    const bot = await api<DiscordUser>("/users/@me");
    stage = "application";
    const application = await api<DiscordApplication>("/applications/@me");
    const report: Record<string, unknown> = {
      bot: { id: bot.id, bot: bot.bot === true },
      application: {
        id: application.id,
        botPublic: application.bot_public,
        requiresCodeGrant: application.bot_require_code_grant,
        ownerId: application.owner?.id ?? application.team?.owner_user_id ?? null,
      },
    };
    stage = "guild";
    let guild: DiscordGuild;
    try {
      guild = await api<DiscordGuild>(`/guilds/${guildId}`);
    } catch (error) {
      report.guild = {
        id: guildId,
        available: false,
        status: error instanceof DiscordRESTError ? error.status : null,
      };
      console.log(JSON.stringify(report));
      return;
    }
    report.guild = { id: guild.id, available: true, ownerId: guild.owner_id };
    stage = "roles";
    const roles = await api<DiscordRole[]>(`/guilds/${guildId}/roles`);
    stage = "member";
    const membership = await Promise.all(
      [...new Set([bot.id, ...members])].map(async (id): Promise<Record<string, unknown>> => {
        try {
          const member = await api<DiscordMember>(`/guilds/${guildId}/members/${id}`);
          const permissions = roles
            .filter(role => role.id === guildId || member.roles.includes(role.id))
            .reduce((result, role) => result | BigInt(role.permissions), 0n);
          return {
            id,
            available: true,
            bot: member.user?.bot === true,
            pending: member.pending === true,
            roleCount: member.roles.length,
            canManageGuild: guild.owner_id === id || (permissions & (8n | 32n)) !== 0n,
          };
        } catch (error) {
          return {
            id,
            available: false,
            status: error instanceof DiscordRESTError ? error.status : null,
          };
        }
      }),
    );
    report.membership = membership;
    console.log(JSON.stringify(report));
  } catch (error) {
    console.log(
      JSON.stringify({
        available: false,
        stage,
        status: error instanceof DiscordRESTError ? error.status : null,
      }),
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
