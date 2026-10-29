// SPDX-License-Identifier: Apache-2.0
import { test, expect } from "bun:test";
import { createGame, pointerAction, pointerDirection, step } from "./engine.js";
import { readGamepadInput } from "./gamepad.js";
import {
  DEFAULT_AVATAR,
  loadAvatar,
  normalizeAvatar,
  saveAvatar,
} from "./avatar.js";
import { buildMultiplayerSocketUrl } from "./multiplayer-url.js";
test("energy, transformation, cooldown and expiry", () => {
  const g = createGame();
  g.player.energy = 80;
  step(g, { transform: true }, 0.01);
  expect(g.player.transformed).toBe(8);
  expect(g.player.energy).toBeLessThan(1);
  for (let i = 0; i < 170; i++) step(g, {}, 0.05);
  expect(g.player.transformed).toBe(0);
});
test("combo and projectile damage with energy cost", () => {
  const g = createGame();
  g.wave = 1;
  g.enemies = [{ x: 210, y: 320, hp: 100, cooldown: 10 }];
  step(g, { punch: true }, 0.01);
  expect(g.enemies[0].hp).toBe(87);
  step(g, { punch: true }, 0.01);
  expect(g.enemies[0].hp).toBe(87);
  g.player.cooldown = 0;
  step(g, { blast: true }, 0.01);
  expect(g.player.energy).toBeLessThan(21);
  for (let i = 0; i < 10; i++) step(g, {}, 0.01);
  expect(g.enemies[0].hp).toBe(63);
});
test("five waves win, score only once per enemy", () => {
  const g = createGame();
  for (let wave = 1; wave <= 5; wave++) {
    step(g, {}, 0.05);
    expect(g.wave).toBe(wave);
    for (const e of g.enemies) e.hp = 0;
    step(g, {}, 0.05);
    for (let i = 0; i < 31; i++) step(g, {}, 0.05);
  }
  expect(g.status).toBe("won");
  expect(g.score).toBe(2000);
  const score = g.score;
  step(g, { blast: true }, 0.05);
  expect(g.score).toBe(score);
});
test("death ends game and pauses simulation", () => {
  const g = createGame();
  g.wave = 1;
  g.player.hp = 1;
  g.enemies = [{ x: 180, y: 320, hp: 50, cooldown: 0 }];
  step(g, {}, 0.01);
  expect(g.status).toBe("lost");
  const x = g.player.x;
  step(g, { right: true }, 0.05);
  expect(g.player.x).toBe(x);
});
test("jump, arena bounds and character differences", () => {
  const a = createGame(),
    b = createGame("speed");
  step(a, { right: true, jump: true }, 0.05);
  step(b, { right: true }, 0.05);
  expect(a.player.y).toBeLessThan(320);
  expect(b.player.x).toBeGreaterThan(a.player.x);
  for (let i = 0; i < 1000; i++) step(b, { right: true }, 0.05);
  expect(b.player.x).toBeLessThanOrEqual(936);
});

test("mouse pointer moves toward its target and stops within tolerance", () => {
  expect(pointerDirection(120, 200)).toBe("left");
  expect(pointerDirection(300, 200)).toBe("right");
  expect(pointerDirection(205, 200)).toBeNull();
  expect(pointerDirection(null, 200)).toBeNull();
  expect(pointerAction(2)).toBe("blast");
  expect(pointerAction(0)).toBeNull();
});

test("gamepad axes, buttons, start and disconnect map to game actions", () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  buttons[0].pressed = true;
  buttons[1].pressed = true;
  buttons[2].pressed = true;
  buttons[3].pressed = true;
  buttons[4].pressed = true;
  buttons[9].pressed = true;
  buttons[14].pressed = true;
  const state = readGamepadInput({ axes: [-0.8], buttons });
  expect(state.input).toEqual({
    left: true,
    right: false,
    jump: true,
    punch: true,
    blast: true,
    charge: true,
    transform: true,
  });
  expect(state.startPressed).toBe(true);
  expect(readGamepadInput({ axes: [0.8], buttons: [] }).input.right).toBe(true);
  expect(readGamepadInput(null)).toEqual({ input: {}, startPressed: false });
});

test("avatar creation validates and persists local character choices", () => {
  const values = {
    name: "  Nova  ",
    race: "namekian",
    skin: "#68b36a",
    hair: "#172216",
    outfit: "#e4a83d",
    hairstyle: "crest",
    build: "broad",
    height: 1.12,
  };
  const record = new Map();
  const storage = {
    getItem: (key) => record.get(key) || null,
    setItem: (key, value) => record.set(key, value),
  };
  expect(saveAvatar(storage, values)).toEqual({ ...values, name: "Nova" });
  expect(loadAvatar(storage)).toEqual({ ...values, name: "Nova" });
  expect(
    normalizeAvatar({ ...values, name: "", race: "alien", skin: "red" }),
  ).toEqual({
    ...DEFAULT_AVATAR,
    hair: values.hair,
    outfit: values.outfit,
    hairstyle: values.hairstyle,
    build: values.build,
    height: values.height,
  });
  expect(loadAvatar({ getItem: () => "{" })).toEqual(DEFAULT_AVATAR);
  for (const race of [
    "saiyan",
    "earthling",
    "namekian",
    "majin",
    "frieza",
    "android",
  ])
    expect(normalizeAvatar({ ...values, race }).race).toBe(race);
  expect(
    normalizeAvatar({ ...values, build: "slim", height: 0.85 }),
  ).toMatchObject({
    build: "slim",
    height: 0.85,
  });
  expect(
    normalizeAvatar({ ...values, build: "unknown", height: 1.5 }),
  ).toMatchObject({
    build: "athletic",
    height: 1.15,
  });
  expect(normalizeAvatar({ name: "Legacy" })).toMatchObject({
    name: "Legacy",
    build: "athletic",
    height: 1,
  });
});

test("multiplayer uses the local port in development and same-origin TLS in production", () => {
  expect(
    buildMultiplayerSocketUrl(new URL("http://localhost:4317/"), "test-room"),
  ).toBe("ws://localhost:4320/ws/test-room");
  expect(
    buildMultiplayerSocketUrl(
      new URL("https://game.example.com/"),
      "test-room",
    ),
  ).toBe("wss://game.example.com/ws/test-room");
  expect(
    buildMultiplayerSocketUrl(
      new URL("https://game.example.com/"),
      "test-room",
      "wss://socket.example.net/rooms",
    ),
  ).toBe("wss://socket.example.net/rooms/ws/test-room");
  expect(
    buildMultiplayerSocketUrl(
      new URL("https://game.example.com/"),
      "test-room",
      "/multiplayer",
    ),
  ).toBe("wss://game.example.com/multiplayer/ws/test-room");
  expect(() =>
    buildMultiplayerSocketUrl(new URL("https://game.example.com/"), "bad room"),
  ).toThrow();
  expect(() =>
    buildMultiplayerSocketUrl(
      new URL("https://game.example.com/"),
      "room",
      "https://socket.example.net",
    ),
  ).toThrow();
  expect(() =>
    buildMultiplayerSocketUrl(
      new URL("https://game.example.com/"),
      "room",
      "wss://user:password@socket.example.net",
    ),
  ).toThrow();
});
