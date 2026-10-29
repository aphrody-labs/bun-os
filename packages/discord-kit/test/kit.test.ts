// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, mock } from "bun:test";
import { MessageFlags } from "discord.js";
import type { Client } from "discordx";

import {
  assertDiscordTokenMatchesProfile,
  clearGuildCommandsSafe,
  createMonoGuildGuard,
  createProductionCacheOptions,
  extractUserFromPayload,
  FALLBACK_INTENTS,
  FULL_INTENTS,
  initApplicationCommandsSafe,
  NotBot,
  PRIVILEGED_GRANT_BITS,
  resolveGrantedIntents,
  safeExecuteInteraction,
} from "../src/index";

describe("Preflight intent & token checks", () => {
  it("returns all desired intents when all privileged flags are granted", async () => {
    const allBits =
      PRIVILEGED_GRANT_BITS.members[0] | PRIVILEGED_GRANT_BITS.presence[0] | PRIVILEGED_GRANT_BITS.messageContent[0];

    const mockFetch = mock(async () => new Response(JSON.stringify({ flags: allBits }), { status: 200 }));

    const intents = await resolveGrantedIntents("token_ok", {
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(intents).toEqual([...FULL_INTENTS]);
  });

  it("filters out privileged intents when flags are 0", async () => {
    const mockFetch = mock(async () => new Response(JSON.stringify({ flags: 0 }), { status: 200 }));

    const warnings: string[] = [];
    const intents = await resolveGrantedIntents("token_restricted", {
      fetchImpl: mockFetch as unknown as typeof fetch,
      logger: { warn: msg => warnings.push(msg) },
    });

    expect(intents).toEqual([...FALLBACK_INTENTS]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("GuildMembers");
    expect(warnings[0]).toContain("GuildPresences");
    expect(warnings[0]).toContain("MessageContent");
  });

  it("falls back to non-privileged intents on fetch network failure", async () => {
    const mockFetch = mock(async () => {
      throw new Error("Network unreachable");
    });

    const warnings: string[] = [];
    const intents = await resolveGrantedIntents("token_err", {
      fetchImpl: mockFetch as unknown as typeof fetch,
      logger: { warn: msg => warnings.push(msg) },
    });

    expect(intents).toEqual([...FALLBACK_INTENTS]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("Gateway 4014");
  });

  it("falls back to non-privileged intents when Discord rejects the preflight", async () => {
    const mockFetch = mock(async () => new Response("unavailable", { status: 503 }));
    const intents = await resolveGrantedIntents("token_err", {
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(intents).toEqual([...FALLBACK_INTENTS]);
  });

  it("asserts token matches configured client profile", async () => {
    const mockFetch = mock(
      async () =>
        new Response(JSON.stringify({ id: "123456789", name: "Aphrody Bot" }), {
          status: 200,
        }),
    );

    await expect(
      assertDiscordTokenMatchesProfile(
        "token_valid",
        { clientId: "123456789", name: "Aphrody Bot" },
        { fetchImpl: mockFetch as unknown as typeof fetch },
      ),
    ).resolves.toBeUndefined();

    await expect(
      assertDiscordTokenMatchesProfile(
        "token_invalid",
        { clientId: "999999999", name: "Aphrody Bot" },
        { fetchImpl: mockFetch as unknown as typeof fetch },
      ),
    ).rejects.toThrow("does NOT match");
  });
});

describe("Production cache options", () => {
  it("builds standard cache limits and sweepers for Bun long-running services", () => {
    const cache = createProductionCacheOptions();
    expect(cache.makeCache).toBeDefined();
    expect(cache.sweepers).toBeDefined();
    expect(cache.sweepers.messages).toEqual({ interval: 3600, lifetime: 1800 });
    expect(cache.sweepers.threads).toEqual({ interval: 3600, lifetime: 3600 });
  });

  it("allows overriding specific sweeper intervals", () => {
    const cache = createProductionCacheOptions({
      messageSweeperInterval: 1800,
      messageSweeperLifetime: 900,
    });
    expect(cache.sweepers.messages).toEqual({ interval: 1800, lifetime: 900 });
  });
});

describe("Safe interaction execution", () => {
  it("ignores non-repliable interactions such as autocomplete", async () => {
    const mockClient = {
      executeInteraction: mock(async () => {}),
    } as unknown as Client;

    const interaction = {
      isRepliable: () => false,
      reply: mock(async () => {}),
    };

    await safeExecuteInteraction(mockClient, interaction as any);
    expect(mockClient.executeInteraction).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("uses editReply when interaction is already deferred and command throws", async () => {
    const mockClient = {
      executeInteraction: mock(async () => {
        throw new Error("Database timeout");
      }),
    } as unknown as Client;

    const editReply = mock(async () => {});
    const reply = mock(async () => {});
    const interaction = {
      isRepliable: () => true,
      replied: false,
      deferred: true,
      editReply,
      reply,
    };

    await safeExecuteInteraction(mockClient, interaction as any, {
      logger: { error: () => {} },
    });

    expect(editReply).toHaveBeenCalledWith({
      content: "❌ La commande a rencontré une erreur interne.",
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it("treats falsy thrown values as command failures", async () => {
    const mockClient = {
      executeInteraction: mock(async () => {
        throw undefined;
      }),
    } as unknown as Client;
    const reply = mock(async () => {});
    await safeExecuteInteraction(
      mockClient,
      {
        isRepliable: () => true,
        replied: false,
        deferred: false,
        reply,
      } as any,
      { logger: { error: () => {} } },
    );
    expect(reply).toHaveBeenCalledWith({
      content: "❌ La commande a rencontré une erreur interne.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("replies with ephemeral message when interaction is unreplied and command throws", async () => {
    const mockClient = {
      executeInteraction: mock(async () => {
        throw new Error("Command failed");
      }),
    } as unknown as Client;

    const reply = mock(async () => {});
    const interaction = {
      isRepliable: () => true,
      replied: false,
      deferred: false,
      reply,
    };

    await safeExecuteInteraction(mockClient, interaction as any, {
      logger: { error: () => {} },
    });

    expect(reply).toHaveBeenCalledWith({
      content: "❌ La commande a rencontré une erreur interne.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("logs reply failures other than an expired interaction", async () => {
    const mockClient = {
      executeInteraction: mock(async () => {}),
    } as unknown as Client;
    const reply = mock(async () => {
      throw Object.assign(new Error("Missing Access"), { code: 50001 });
    });
    const warnings: string[] = [];
    await safeExecuteInteraction(
      mockClient,
      {
        isRepliable: () => true,
        replied: false,
        deferred: false,
        reply,
      } as any,
      { logger: { warn: (...args) => warnings.push(args.join(" ")) } },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Missing Access");
  });

  it("silently ignores Discord's expired interaction response", async () => {
    const mockClient = {
      executeInteraction: mock(async () => {}),
    } as unknown as Client;
    const reply = mock(async () => {
      throw Object.assign(new Error("Unknown interaction"), { code: 10062 });
    });
    const warnings: string[] = [];
    await safeExecuteInteraction(
      mockClient,
      {
        isRepliable: () => true,
        replied: false,
        deferred: false,
        reply,
      } as any,
      { logger: { warn: (...args) => warnings.push(args.join(" ")) } },
    );
    expect(warnings).toHaveLength(0);
  });
});

describe("Guards: NotBot & MonoGuild", () => {
  it("extractUserFromPayload resolves user correctly", () => {
    expect(extractUserFromPayload({ user: { id: "1", bot: false } })).toEqual({
      id: "1",
      bot: false,
    } as any);
    expect(extractUserFromPayload({ author: { id: "2", bot: true } })).toEqual({
      id: "2",
      bot: true,
    } as any);
    expect(extractUserFromPayload([{ member: { user: { id: "3", bot: false } } }])).toEqual({
      id: "3",
      bot: false,
    } as any);
  });

  it("NotBot guard prevents bot execution", async () => {
    const next = mock(async () => {});
    await NotBot({ user: { id: "bot_1", bot: true } } as any, {} as any, next, {});
    expect(next).not.toHaveBeenCalled();

    await NotBot({ user: { id: "human_1", bot: false } } as any, {} as any, next, {});
    expect(next).toHaveBeenCalled();
  });

  it("createMonoGuildGuard restricts to target guild", async () => {
    const guard = createMonoGuildGuard("guild_prod");
    const next = mock(async () => {});

    // Unauthorized guild
    const replied = mock(async () => {});
    await guard({ guildId: "guild_other", reply: replied } as any, {} as any, next, {});
    expect(next).not.toHaveBeenCalled();
    expect(replied).toHaveBeenCalled();

    // Authorized guild
    await guard({ guildId: "guild_prod" } as any, {} as any, next, {});
    expect(next).toHaveBeenCalled();
  });
});

describe("Commands registration and cleanup", () => {
  it("initApplicationCommandsSafe catches error and logs rawError payload", async () => {
    const mockClient = {
      initApplicationCommands: mock(async () => {
        const error: any = new Error("Invalid Form Body");
        error.rawError = { errors: { 0: { description: "Invalid option" } } };
        throw error;
      }),
    } as unknown as Client;

    const loggedErrors: string[] = [];
    const ok = await initApplicationCommandsSafe(mockClient, {
      logger: { error: (...args) => loggedErrors.push(args.join(" ")) },
    });

    expect(ok).toBe(false);
    expect(loggedErrors.length).toBe(1);
    expect(loggedErrors[0]).toContain("Invalid option");
  });

  it("clearGuildCommandsSafe cleans only joined guilds", async () => {
    const clearMock = mock(async () => {});
    const mockClient = {
      guilds: {
        cache: new Map([
          ["guild_1", { id: "guild_1" }],
          ["guild_2", { id: "guild_2" }],
        ]),
      },
      clearApplicationCommands: clearMock,
    } as unknown as Client;

    const cleanedCount = await clearGuildCommandsSafe(mockClient, ["guild_1", "guild_missing_3"], {
      logger: {},
    });

    expect(cleanedCount).toBe(1);
    expect(clearMock).toHaveBeenCalledWith("guild_1");
  });
});
